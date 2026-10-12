-- Segurança para o SaaS:
-- 1. App Secret da Meta por clínica (validação da assinatura do webhook)
-- 2. Limpeza diária do histórico de crons e respostas HTTP do pg_net

-- 1. App Secret ----------------------------------------------------------------

ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS whatsapp_app_secret text;

-- Nova assinatura (app secret). A antiga é removida para não ficar duas versões.
DROP FUNCTION IF EXISTS public.owner_update_clinic_whatsapp(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.owner_update_clinic_whatsapp(
  p_org uuid, p_phone_number_id text, p_business_account_id text,
  p_access_token text DEFAULT NULL, p_app_secret text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  IF EXISTS (
    SELECT 1 FROM public.nina_settings
    WHERE whatsapp_phone_number_id = nullif(trim(p_phone_number_id), '') AND organization_id <> p_org
  ) THEN
    RAISE EXCEPTION 'Esse Phone Number ID já está em uso por outra clínica' USING ERRCODE = '22023';
  END IF;

  UPDATE public.nina_settings
  SET whatsapp_provider = CASE WHEN nullif(trim(p_phone_number_id), '') IS NOT NULL THEN 'meta' ELSE whatsapp_provider END,
      whatsapp_phone_number_id = nullif(trim(p_phone_number_id), ''),
      whatsapp_business_account_id = nullif(trim(p_business_account_id), ''),
      -- vazio = manter o atual (o painel nunca recebe os segredos salvos)
      whatsapp_access_token = COALESCE(nullif(trim(p_access_token), ''), whatsapp_access_token),
      whatsapp_app_secret = COALESCE(nullif(trim(p_app_secret), ''), whatsapp_app_secret)
  WHERE organization_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A clínica ainda não tem configuração da Nina' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.owner_log(p_org, 'whatsapp_updated', jsonb_build_object(
    'phone_number_id', nullif(trim(p_phone_number_id), ''),
    'token_changed', nullif(trim(p_access_token), '') IS NOT NULL,
    'app_secret_changed', nullif(trim(p_app_secret), '') IS NOT NULL
  ));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.owner_update_clinic_whatsapp(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_clinic_whatsapp(uuid, text, text, text, text) TO authenticated, service_role;

-- Config do dono passa a dizer se o App Secret está cadastrado (sem expor o valor)
CREATE OR REPLACE FUNCTION public.owner_has_app_secret(p_org uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  RETURN COALESCE((SELECT whatsapp_app_secret IS NOT NULL FROM public.nina_settings WHERE organization_id = p_org), false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.owner_has_app_secret(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_has_app_secret(uuid) TO authenticated, service_role;

-- 2. Limpeza diária ------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'nina-cleanup-history';
  PERFORM cron.schedule('nina-cleanup-history', '15 4 * * *', $job$
    DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
    DELETE FROM net._http_response WHERE created < now() - interval '2 days';
  $job$);
END $$;
