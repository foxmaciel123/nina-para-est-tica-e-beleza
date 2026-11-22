-- Botão "Conectar WhatsApp" (Cadastro Incorporado da Meta / Embedded Signup)
-- Um app da Meta da plataforma (Pixel Pro) serve todas as clínicas:
--   * app_config guarda o App ID e o Configuration ID (públicos) e o App Secret
--     e o token de verificação do webhook (secretos, só service_role lê);
--   * a clínica clica no botão, entra com o Facebook dela e escolhe o número;
--   * a função whatsapp-connect troca o código por um token da clínica e grava
--     tudo em nina_settings (nenhum token passa pela tela).

-- PIN de duas etapas gerado ao ativar o número (a Meta pede de novo ao reativar)
ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS whatsapp_two_step_pin text;
ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS whatsapp_connected_via text;

-- 1. O que a tela precisa para abrir o botão (qualquer usuário logado) ----------

CREATE OR REPLACE FUNCTION public.meta_signup_config()
RETURNS TABLE (app_id text, config_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (SELECT nullif(trim(value), '') FROM public.app_config WHERE key = 'meta_app_id'),
    (SELECT nullif(trim(value), '') FROM public.app_config WHERE key = 'meta_es_config_id');
$$;

-- 2. Painel do dono: ler e salvar o app da Meta da plataforma -------------------

CREATE OR REPLACE FUNCTION public.owner_get_meta_app()
RETURNS TABLE (app_id text, config_id text, has_app_secret boolean, verify_token text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  RETURN QUERY SELECT
    (SELECT nullif(trim(value), '') FROM public.app_config WHERE key = 'meta_app_id'),
    (SELECT nullif(trim(value), '') FROM public.app_config WHERE key = 'meta_es_config_id'),
    COALESCE((SELECT nullif(trim(value), '') IS NOT NULL FROM public.app_config WHERE key = 'meta_app_secret'), false),
    (SELECT value FROM public.app_config WHERE key = 'meta_webhook_verify_token');
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_meta_app(p_app_id text, p_config_id text, p_app_secret text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  IF nullif(trim(p_app_id), '') IS NOT NULL AND trim(p_app_id) !~ '^\d{5,25}$' THEN
    RAISE EXCEPTION 'O App ID tem só números' USING ERRCODE = '22023';
  END IF;
  IF nullif(trim(p_config_id), '') IS NOT NULL AND trim(p_config_id) !~ '^\d{5,25}$' THEN
    RAISE EXCEPTION 'O Configuration ID tem só números' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.app_config (key, value, description, is_secret) VALUES
    ('meta_app_id', nullif(trim(p_app_id), ''), 'App ID do app da Meta da plataforma (Cadastro Incorporado)', false),
    ('meta_es_config_id', nullif(trim(p_config_id), ''), 'Configuration ID do Login do Facebook para Empresas (WhatsApp)', false)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  -- vazio = manter o atual (a tela nunca recebe o segredo salvo)
  IF nullif(trim(p_app_secret), '') IS NOT NULL THEN
    INSERT INTO public.app_config (key, value, description, is_secret)
    VALUES ('meta_app_secret', trim(p_app_secret), 'App Secret do app da Meta da plataforma', true)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;

  -- Token de verificação do webhook do app (gerado uma vez)
  INSERT INTO public.app_config (key, value, description, is_secret)
  VALUES ('meta_webhook_verify_token', 'nina-' || encode(extensions.gen_random_bytes(12), 'hex'),
          'Token de verificação do webhook do app da Meta da plataforma', true)
  ON CONFLICT (key) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.meta_signup_config() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.owner_get_meta_app() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.owner_set_meta_app(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meta_signup_config() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_get_meta_app() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_set_meta_app(text, text, text) TO authenticated, service_role;
