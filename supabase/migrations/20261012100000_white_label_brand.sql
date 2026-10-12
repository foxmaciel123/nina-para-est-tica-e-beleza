-- White label, etapa 1: marca padrão da plataforma (editável pelo dono) e
-- remoção do nome "Nina" de tudo que aparece para quem usa o sistema.
-- A tabela já nasce preparada para as próximas etapas (marca da agência e
-- marca própria da clínica), mas por enquanto só existe a marca da plataforma.

-- 1. Marcas ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform', 'agency', 'organization')),
  owner_id uuid,                       -- agência ou clínica dona da marca (null na plataforma)
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  tagline text CHECK (tagline IS NULL OR length(tagline) <= 80),
  logo_url text,
  icon_url text,
  accent_color text CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  support_email text,
  support_whatsapp text,
  domain text,                         -- endereço próprio (etapa das agências)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'platform') = (owner_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS brands_platform_unique ON public.brands (scope) WHERE scope = 'platform';
CREATE UNIQUE INDEX IF NOT EXISTS brands_owner_unique ON public.brands (scope, owner_id) WHERE owner_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS brands_domain_unique ON public.brands (lower(domain)) WHERE domain IS NOT NULL;

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brands FROM anon, authenticated;
GRANT ALL ON public.brands TO service_role;

INSERT INTO public.brands (scope, name, tagline, accent_color)
SELECT 'platform', 'Pixel Pro', 'Atendimento com IA para clínicas', '#0A4F95'
WHERE NOT EXISTS (SELECT 1 FROM public.brands WHERE scope = 'platform');

CREATE OR REPLACE FUNCTION public.brand_json(b public.brands)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'name', b.name,
    'tagline', b.tagline,
    'logo_url', b.logo_url,
    'icon_url', b.icon_url,
    'accent_color', b.accent_color,
    'support_email', b.support_email,
    'support_whatsapp', b.support_whatsapp
  );
$$;

-- Marca mostrada na tela de login e no painel. Pública (a tela de login ainda
-- não tem usuário), devolve só dados de vitrine. Endereço próprio vence; senão,
-- a marca da plataforma.
CREATE OR REPLACE FUNCTION public.public_brand(p_host text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.brand_json(b)
  FROM public.brands b
  WHERE (p_host IS NOT NULL AND b.domain IS NOT NULL AND lower(b.domain) = lower(p_host))
     OR b.scope = 'platform'
  ORDER BY (b.scope = 'platform')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.public_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_brand(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.brand_json(public.brands) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_update_platform_brand(
  p_name text,
  p_tagline text,
  p_logo_url text,
  p_icon_url text,
  p_accent_color text,
  p_support_email text,
  p_support_whatsapp text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_brand public.brands;
BEGIN
  PERFORM public.assert_platform_owner();
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Informe o nome da marca' USING ERRCODE = '22023';
  END IF;
  IF p_accent_color IS NOT NULL AND p_accent_color !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'Cor inválida' USING ERRCODE = '22023';
  END IF;

  UPDATE public.brands
  SET name = btrim(p_name),
      tagline = nullif(btrim(p_tagline), ''),
      logo_url = nullif(btrim(p_logo_url), ''),
      icon_url = nullif(btrim(p_icon_url), ''),
      accent_color = nullif(btrim(p_accent_color), ''),
      support_email = nullif(btrim(p_support_email), ''),
      support_whatsapp = nullif(btrim(p_support_whatsapp), ''),
      updated_at = now()
  WHERE scope = 'platform'
  RETURNING * INTO v_brand;

  PERFORM public.owner_log(NULL, 'platform_brand_updated', public.brand_json(v_brand));
  RETURN public.brand_json(v_brand);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_update_platform_brand(text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_platform_brand(text, text, text, text, text, text, text) TO authenticated, service_role;

-- 2. Imagens da marca (logo e ícone) --------------------------------------
-- Leitura pública (aparecem na tela de login); só o dono envia/troca.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('brand-assets', 'brand-assets', true, 1048576,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO UPDATE
SET public = true, file_size_limit = 1048576,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

DROP POLICY IF EXISTS "brand assets owner insert" ON storage.objects;
DROP POLICY IF EXISTS "brand assets owner update" ON storage.objects;
DROP POLICY IF EXISTS "brand assets owner delete" ON storage.objects;
CREATE POLICY "brand assets owner insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brand-assets' AND public.is_platform_owner());
CREATE POLICY "brand assets owner update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'brand-assets' AND public.is_platform_owner());
CREATE POLICY "brand assets owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'brand-assets' AND public.is_platform_owner());

-- 3. Sem "Nina" nas mensagens do servidor ---------------------------------
-- Reescreve as funções que mostram "Nina" em alertas e avisos de erro.

DO $$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('owner_update_clinic_agent', 'owner_update_clinic_hours', 'owner_alerts', 'owner_update_clinic_whatsapp')
      AND p.prosrc LIKE '%Nina%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def, 'configuração da Nina', 'configuração da assistente');
    v_def := replace(v_def, 'a Nina não responde', 'a assistente não responde');
    v_def := replace(v_def, 'Nina falhou ao responder', 'Assistente falhou ao responder');
    v_def := replace(v_def, 'Nina desligada', 'Assistente desligada');
    v_def := replace(v_def, 'Nina', 'assistente');
    EXECUTE v_def;
  END LOOP;
END;
$$;

-- 4. Nome padrão da assistente --------------------------------------------
-- Clínicas que ainda usam o nome de fábrica passam a usar "Assistente"
-- (cada clínica pode dar o nome que quiser na tela do agente).

ALTER TABLE public.nina_settings ALTER COLUMN sdr_name SET DEFAULT 'Assistente';
UPDATE public.nina_settings SET sdr_name = 'Assistente' WHERE sdr_name = 'Nina';

-- Prompts salvos a partir do padrão antigo: troca a persona fixa pela variável
UPDATE public.nina_settings
SET system_prompt_override = replace(replace(replace(system_prompt_override,
      'Você é a Nina,', 'Você é a {{ assistente_nome }},'),
      'Responda diretamente como Nina', 'Responda diretamente como {{ assistente_nome }}'),
      E'\nNina: "', E'\n{{ assistente_nome }}: "')
WHERE system_prompt_override LIKE '%Nina%';
