-- Tipo de negócio (nicho) + marca da empresa + pedidos.
--
-- O sistema deixa de ser só de clínica de estética: cada empresa escolhe o
-- nicho na Configuração Inicial (ou depois, nas Configurações). O nicho muda
-- palavras da tela, funil, etiquetas, equipe, catálogo e o prompt da IA.
-- A lista de nichos mora no código (src/niches/registry.ts); o banco só guarda
-- o id e aplica a configuração que a tela manda.
--
-- Tudo aqui é reversível:
--   * contas antigas continuam 'estetica' (nada muda para elas);
--   * trocar de nicho não apaga nada: renomeia e desativa; a configuração
--     anterior fica guardada em niche_previous e undo_business_niche() volta;
--   * a tabela orders é nova e só aparece para nichos de pedido.

-- 1. Colunas novas ------------------------------------------------------------

ALTER TABLE public.nina_settings
  ADD COLUMN IF NOT EXISTS business_niche text NOT NULL DEFAULT 'estetica',
  ADD COLUMN IF NOT EXISTS company_logo_url text,
  ADD COLUMN IF NOT EXISTS niche_previous jsonb;

ALTER TABLE public.nina_settings DROP CONSTRAINT IF EXISTS nina_settings_business_niche_check;
ALTER TABLE public.nina_settings ADD CONSTRAINT nina_settings_business_niche_check
  CHECK (business_niche ~ '^[a-z_]{2,30}$');

ALTER TABLE public.nina_settings DROP CONSTRAINT IF EXISTS nina_settings_company_logo_url_check;
ALTER TABLE public.nina_settings ADD CONSTRAINT nina_settings_company_logo_url_check
  CHECK (company_logo_url IS NULL OR (company_logo_url ~ '^https?://' AND length(company_logo_url) <= 500));

ALTER TABLE public.nina_settings ALTER COLUMN company_name SET DEFAULT 'Minha Empresa';

-- Vitrine segura (sem tokens) ganha nicho e logo
CREATE OR REPLACE VIEW public.nina_public_settings WITH (security_invoker='true') AS
  SELECT id, company_name, sdr_name, business_niche, company_logo_url
  FROM public.nina_settings;

-- 2. Perfil da empresa para QUALQUER membro ----------------------------------
-- nina_settings (e a vitrine, que usa as permissões de quem lê) só abre para o
-- admin, então atendentes ficavam sem nome/nicho. Esta função devolve só os
-- dados de vitrine da empresa de quem está logado.

CREATE OR REPLACE FUNCTION public.org_profile()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'company_name', s.company_name,
    'sdr_name', s.sdr_name,
    'business_niche', s.business_niche,
    'company_logo_url', s.company_logo_url,
    'can_undo_niche', s.niche_previous IS NOT NULL,
    'previous_niche', s.niche_previous->>'niche'
  )
  FROM public.nina_settings s
  WHERE s.organization_id = public.current_org_id();
$$;

REVOKE ALL ON FUNCTION public.org_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_profile() TO authenticated, service_role;

-- 3. Catálogo aceita categorias de qualquer nicho -----------------------------

ALTER TABLE public.procedures DROP CONSTRAINT IF EXISTS procedures_category_check;
ALTER TABLE public.procedures ADD CONSTRAINT procedures_category_check
  CHECK (category ~ '^[a-z_]{1,40}$');

-- 4. Trocar o nicho -----------------------------------------------------------
-- p_config vem da tela (nicheApplyPayload): {stages, tags, teams, functions}.
-- p_prompt: NULL = não mexe no prompt; texto = passa a usar esse prompt.

CREATE OR REPLACE FUNCTION public.apply_business_niche(p_niche text, p_config jsonb, p_prompt text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_settings public.nina_settings;
  v_snapshot jsonb;
  v_ids uuid[];
  v_item jsonb;
  v_i int := 0;
  v_pos int;
  v_names text[];
  v_palette text[] := ARRAY['#ec4899', '#22c55e', '#3b82f6', '#f97316', '#8b5cf6', '#06b6d4'];
BEGIN
  IF v_org IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Só o administrador da empresa pode trocar o tipo de negócio' USING ERRCODE = '42501';
  END IF;
  IF p_niche IS NULL OR p_niche !~ '^[a-z_]{2,30}$' THEN
    RAISE EXCEPTION 'Tipo de negócio inválido' USING ERRCODE = '22023';
  END IF;
  IF p_config IS NULL
     OR jsonb_typeof(p_config->'stages') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_config->'tags') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_config->'teams') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_config->'functions') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_config->'stages') NOT BETWEEN 1 AND 10
     OR jsonb_array_length(p_config->'tags') > 20
     OR jsonb_array_length(p_config->'teams') > 10
     OR jsonb_array_length(p_config->'functions') > 10 THEN
    RAISE EXCEPTION 'Configuração do nicho inválida' USING ERRCODE = '22023';
  END IF;
  IF p_prompt IS NOT NULL AND length(p_prompt) > 50000 THEN
    RAISE EXCEPTION 'Prompt grande demais' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_settings FROM public.nina_settings WHERE organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração da empresa não encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- Foto do jeito que está agora (para o "desfazer")
  v_snapshot := jsonb_build_object(
    'niche', v_settings.business_niche,
    'system_prompt_override', v_settings.system_prompt_override,
    'saved_at', now(),
    'stages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'title', title, 'color', color,
                  'is_ai_managed', COALESCE(is_ai_managed, false), 'is_active', COALESCE(is_active, true)))
                FROM public.pipeline_stages WHERE organization_id = v_org AND NOT COALESCE(is_system, false)), '[]'::jsonb),
    'tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'label', label, 'is_active', is_active))
                FROM public.tag_definitions WHERE organization_id = v_org), '[]'::jsonb),
    'teams', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'is_active', COALESCE(is_active, true)))
                FROM public.teams WHERE organization_id = v_org), '[]'::jsonb),
    'functions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'is_active', COALESCE(is_active, true)))
                FROM public.team_functions WHERE organization_id = v_org), '[]'::jsonb)
  );

  -- Funil: renomeia as etapas ativas pela ordem; cria as que faltarem.
  -- Etapas a mais da empresa ficam como estão (nada some do quadro).
  SELECT array_agg(id ORDER BY position, created_at) INTO v_ids
  FROM public.pipeline_stages
  WHERE organization_id = v_org AND NOT COALESCE(is_system, false) AND COALESCE(is_active, true);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_config->'stages') LOOP
    v_i := v_i + 1;
    IF length(btrim(COALESCE(v_item->>'title', ''))) NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'Etapa do funil sem nome' USING ERRCODE = '22023';
    END IF;
    IF v_ids IS NOT NULL AND v_i <= array_length(v_ids, 1) THEN
      UPDATE public.pipeline_stages
      SET title = btrim(v_item->>'title'),
          color = COALESCE(v_item->>'color', color),
          is_ai_managed = COALESCE((v_item->>'is_ai_managed')::boolean, false),
          updated_at = now()
      WHERE id = v_ids[v_i];
    ELSE
      SELECT COALESCE(max(position), -1) + 1 INTO v_pos
      FROM public.pipeline_stages WHERE organization_id = v_org AND position < 100;
      INSERT INTO public.pipeline_stages (organization_id, title, color, position, is_system, is_active, is_ai_managed)
      VALUES (v_org, btrim(v_item->>'title'), COALESCE(v_item->>'color', 'border-slate-500'), v_pos, false, true,
              COALESCE((v_item->>'is_ai_managed')::boolean, false));
    END IF;
  END LOOP;

  -- Etiquetas: mesmas chaves (a IA usa a chave), nomes do nicho
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_config->'tags') LOOP
    IF COALESCE(v_item->>'key', '') !~ '^[a-z_]{2,40}$' OR length(btrim(COALESCE(v_item->>'label', ''))) NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'Etiqueta inválida' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.tag_definitions (organization_id, key, label, color, category, is_active)
    VALUES (
      v_org, v_item->>'key', btrim(v_item->>'label'),
      CASE v_item->>'key'
        WHEN 'hot_lead' THEN '#ef4444' WHEN 'warm_lead' THEN '#f97316' WHEN 'cold_lead' THEN '#3b82f6'
        WHEN 'qualified' THEN '#22c55e' WHEN 'unqualified' THEN '#6b7280' WHEN 'interested' THEN '#8b5cf6'
        WHEN 'follow_up' THEN '#eab308' WHEN 'demo_requested' THEN '#06b6d4' ELSE '#3b82f6' END,
      CASE
        WHEN v_item->>'key' IN ('hot_lead', 'warm_lead', 'cold_lead') THEN 'status'
        WHEN v_item->>'key' IN ('qualified', 'unqualified') THEN 'qualification'
        WHEN v_item->>'key' = 'interested' THEN 'interest'
        WHEN v_item->>'key' IN ('follow_up', 'demo_requested') THEN 'action'
        ELSE 'custom' END,
      true
    )
    ON CONFLICT (organization_id, key) DO UPDATE
    SET label = EXCLUDED.label, is_active = true, updated_at = now();
  END LOOP;

  -- Equipes: as do nicho ficam ativas; as antigas sem ninguém ficam inativas
  v_names := ARRAY(SELECT btrim(x->>'name') FROM jsonb_array_elements(p_config->'teams') x);
  v_i := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_config->'teams') LOOP
    v_i := v_i + 1;
    IF length(btrim(COALESCE(v_item->>'name', ''))) NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'Equipe sem nome' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.teams (organization_id, name, description, color, is_active)
    VALUES (v_org, btrim(v_item->>'name'), v_item->>'description', v_palette[1 + ((v_i - 1) % array_length(v_palette, 1))], true)
    ON CONFLICT (organization_id, name) DO UPDATE
    SET description = EXCLUDED.description, is_active = true, updated_at = now();
  END LOOP;
  UPDATE public.teams t SET is_active = false, updated_at = now()
  WHERE t.organization_id = v_org AND COALESCE(t.is_active, true)
    AND NOT (t.name = ANY (v_names))
    AND NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.team_id = t.id);

  v_names := ARRAY(SELECT btrim(x->>'name') FROM jsonb_array_elements(p_config->'functions') x);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_config->'functions') LOOP
    IF length(btrim(COALESCE(v_item->>'name', ''))) NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'Função sem nome' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.team_functions (organization_id, name, description, is_active)
    VALUES (v_org, btrim(v_item->>'name'), v_item->>'description', true)
    ON CONFLICT (organization_id, name) DO UPDATE
    SET description = EXCLUDED.description, is_active = true, updated_at = now();
  END LOOP;
  UPDATE public.team_functions f SET is_active = false, updated_at = now()
  WHERE f.organization_id = v_org AND COALESCE(f.is_active, true)
    AND NOT (f.name = ANY (v_names))
    AND NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.function_id = f.id);

  UPDATE public.nina_settings
  SET business_niche = p_niche,
      niche_previous = v_snapshot,
      system_prompt_override = CASE WHEN p_prompt IS NULL THEN system_prompt_override ELSE nullif(btrim(p_prompt), '') END,
      updated_at = now()
  WHERE organization_id = v_org;

  RETURN jsonb_build_object('niche', p_niche, 'previous_niche', v_settings.business_niche);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_business_niche(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_business_niche(text, jsonb, text) TO authenticated, service_role;

-- 5. Desfazer a última troca --------------------------------------------------

CREATE OR REPLACE FUNCTION public.undo_business_niche()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_snap jsonb;
  v_current text;
BEGIN
  IF v_org IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Só o administrador da empresa pode desfazer a troca' USING ERRCODE = '42501';
  END IF;

  SELECT niche_previous, business_niche INTO v_snap, v_current
  FROM public.nina_settings WHERE organization_id = v_org FOR UPDATE;
  IF v_snap IS NULL THEN
    RAISE EXCEPTION 'Não há troca de tipo de negócio para desfazer' USING ERRCODE = 'P0002';
  END IF;

  -- Funil
  UPDATE public.pipeline_stages s
  SET title = x.title, color = x.color, is_ai_managed = x.is_ai_managed, is_active = x.is_active, updated_at = now()
  FROM jsonb_to_recordset(v_snap->'stages') AS x(id uuid, title text, color text, is_ai_managed boolean, is_active boolean)
  WHERE s.id = x.id AND s.organization_id = v_org;
  UPDATE public.pipeline_stages s SET is_active = false, updated_at = now()
  WHERE s.organization_id = v_org AND NOT COALESCE(s.is_system, false) AND COALESCE(s.is_active, true)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_snap->'stages') x WHERE (x->>'id')::uuid = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.stage_id = s.id);

  -- Etiquetas
  UPDATE public.tag_definitions t
  SET label = x.label, is_active = x.is_active, updated_at = now()
  FROM jsonb_to_recordset(v_snap->'tags') AS x(id uuid, label text, is_active boolean)
  WHERE t.id = x.id AND t.organization_id = v_org;
  UPDATE public.tag_definitions t SET is_active = false, updated_at = now()
  WHERE t.organization_id = v_org AND t.is_active
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_snap->'tags') x WHERE (x->>'id')::uuid = t.id);

  -- Equipes e funções
  UPDATE public.teams t
  SET name = x.name, description = x.description, is_active = x.is_active, updated_at = now()
  FROM jsonb_to_recordset(v_snap->'teams') AS x(id uuid, name text, description text, is_active boolean)
  WHERE t.id = x.id AND t.organization_id = v_org;
  UPDATE public.teams t SET is_active = false, updated_at = now()
  WHERE t.organization_id = v_org AND COALESCE(t.is_active, true)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_snap->'teams') x WHERE (x->>'id')::uuid = t.id)
    AND NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.team_id = t.id);

  UPDATE public.team_functions f
  SET name = x.name, description = x.description, is_active = x.is_active, updated_at = now()
  FROM jsonb_to_recordset(v_snap->'functions') AS x(id uuid, name text, description text, is_active boolean)
  WHERE f.id = x.id AND f.organization_id = v_org;
  UPDATE public.team_functions f SET is_active = false, updated_at = now()
  WHERE f.organization_id = v_org AND COALESCE(f.is_active, true)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_snap->'functions') x WHERE (x->>'id')::uuid = f.id)
    AND NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.function_id = f.id);

  UPDATE public.nina_settings
  SET business_niche = COALESCE(v_snap->>'niche', 'estetica'),
      system_prompt_override = v_snap->>'system_prompt_override',
      niche_previous = NULL,
      updated_at = now()
  WHERE organization_id = v_org;

  RETURN jsonb_build_object('niche', COALESCE(v_snap->>'niche', 'estetica'), 'undone_niche', v_current);
END;
$$;

REVOKE ALL ON FUNCTION public.undo_business_niche() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_business_niche() TO authenticated, service_role;

-- 6. Pedidos (nichos de venda: delivery, moda, atacado...) ---------------------

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number integer,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'novo'
    CHECK (status IN ('novo', 'confirmado', 'preparando', 'enviado', 'entregue', 'cancelado')),
  -- [{procedure_id?, name, quantity, unit_price, notes?}]
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 100),
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  delivery_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  discount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total numeric(12,2) NOT NULL DEFAULT 0,
  delivery_method text NOT NULL DEFAULT 'entrega' CHECK (delivery_method IN ('entrega', 'retirada', 'envio')),
  delivery_address text CHECK (delivery_address IS NULL OR length(delivery_address) <= 500),
  payment_method text CHECK (payment_method IS NULL OR length(payment_method) <= 60),
  customer_name text CHECK (customer_name IS NULL OR length(customer_name) <= 120),
  customer_phone text CHECK (customer_phone IS NULL OR length(customer_phone) <= 40),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ia')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE INDEX IF NOT EXISTS orders_org_created_idx ON public.orders (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_org_status_idx ON public.orders (organization_id, status);
CREATE INDEX IF NOT EXISTS orders_contact_idx ON public.orders (contact_id);

-- Número do pedido por empresa (#1, #2...) e totais calculados no banco
CREATE OR REPLACE FUNCTION public.orders_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('orders:' || NEW.organization_id::text));
    SELECT COALESCE(max(number), 0) + 1 INTO NEW.number FROM public.orders WHERE organization_id = NEW.organization_id;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.number := OLD.number;
    NEW.organization_id := OLD.organization_id;
    NEW.updated_at := now();
  END IF;

  NEW.subtotal := COALESCE((
    SELECT sum(GREATEST(COALESCE((i->>'quantity')::numeric, 1), 0) * GREATEST(COALESCE((i->>'unit_price')::numeric, 0), 0))
    FROM jsonb_array_elements(NEW.items) i
  ), 0);
  NEW.total := GREATEST(NEW.subtotal + COALESCE(NEW.delivery_fee, 0) - COALESCE(NEW.discount, 0), 0);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_before_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aa_set_organization_id ON public.orders;
CREATE TRIGGER aa_set_organization_id BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_organization_id();
DROP TRIGGER IF EXISTS bb_orders_before_write ON public.orders;
CREATE TRIGGER bb_orders_before_write BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_before_write();

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clinic members manage own data" ON public.orders;
CREATE POLICY "Clinic members manage own data" ON public.orders
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

REVOKE ALL ON public.orders FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END $$;

-- 7. Logo da própria empresa ---------------------------------------------------
-- Fica no mesmo bucket público da marca, na pasta org/<id da empresa>/.
-- Só o admin daquela empresa envia ou apaga.

DROP POLICY IF EXISTS "brand assets org admin insert" ON storage.objects;
DROP POLICY IF EXISTS "brand assets org admin update" ON storage.objects;
DROP POLICY IF EXISTS "brand assets org admin delete" ON storage.objects;
CREATE POLICY "brand assets org admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND (storage.foldername(name))[1] = 'org'
    AND (storage.foldername(name))[2] = public.current_org_id()::text
    AND public.is_org_admin()
  );
CREATE POLICY "brand assets org admin update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND (storage.foldername(name))[1] = 'org'
    AND (storage.foldername(name))[2] = public.current_org_id()::text
    AND public.is_org_admin()
  );
CREATE POLICY "brand assets org admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND (storage.foldername(name))[1] = 'org'
    AND (storage.foldername(name))[2] = public.current_org_id()::text
    AND public.is_org_admin()
  );

-- 8. Painel do dono enxerga o nicho de cada empresa ---------------------------
-- (para o "carregar prompt padrão" usar o prompt do nicho certo)

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'owner_get_clinic_config';
  IF v_def IS NOT NULL AND v_def NOT LIKE '%business_niche%' THEN
    v_def := replace(v_def,
      '''system_prompt_override'', s.system_prompt_override,',
      '''system_prompt_override'', s.system_prompt_override, ''business_niche'', s.business_niche,');
    EXECUTE v_def;
  END IF;
END;
$$;

-- 9. Frase da marca da plataforma sem "clínicas" (só se ainda for a de fábrica)

UPDATE public.brands
SET tagline = 'Atendimento com IA no WhatsApp', updated_at = now()
WHERE scope = 'platform' AND tagline = 'Atendimento com IA para clínicas';
