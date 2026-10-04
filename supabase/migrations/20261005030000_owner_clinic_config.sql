-- Fase 3 do SaaS: o dono cadastra clínicas e configura a clínica pelo painel dele
-- (WhatsApp, agente/prompt, horários, procedimentos). Toda alteração feita pelo
-- dono fica registrada em owner_audit_log.

-- 1. Histórico de alterações do dono -----------------------------------------

CREATE TABLE IF NOT EXISTS public.owner_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_audit_log_org_created_idx ON public.owner_audit_log (organization_id, created_at DESC);
ALTER TABLE public.owner_audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.owner_log(p_org uuid, p_action text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.owner_audit_log (organization_id, actor_id, action, details)
  VALUES (p_org, auth.uid(), p_action, COALESCE(p_details, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.owner_list_audit(p_org uuid, p_limit integer DEFAULT 20)
RETURNS TABLE (action text, details jsonb, actor_email text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  RETURN QUERY
  SELECT l.action, l.details, u.email::text, l.created_at
  FROM public.owner_audit_log l
  LEFT JOIN auth.users u ON u.id = l.actor_id
  WHERE l.organization_id = p_org
  ORDER BY l.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
END;
$$;

-- Registra mudanças já existentes do dono (status, dados, cobranças)
CREATE OR REPLACE FUNCTION public.owner_set_organization_status(p_org uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Status inválido: %', p_status;
  END IF;
  UPDATE public.organizations SET status = p_status WHERE id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clínica não encontrada' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.owner_log(p_org, CASE WHEN p_status = 'active' THEN 'clinic_reactivated' ELSE 'clinic_suspended' END);
END;
$$;

-- 2. Configuração completa da clínica (para os formulários do dono) -----------

CREATE OR REPLACE FUNCTION public.owner_get_clinic_config(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.assert_platform_owner();
  SELECT jsonb_build_object(
    'company_name', s.company_name,
    'sdr_name', s.sdr_name,
    'is_active', s.is_active,
    'auto_response_enabled', s.auto_response_enabled,
    'ai_model_mode', s.ai_model_mode,
    'system_prompt_override', s.system_prompt_override,
    'audio_response_enabled', s.audio_response_enabled,
    'ai_scheduling_enabled', s.ai_scheduling_enabled,
    'message_breaking_enabled', s.message_breaking_enabled,
    'business_hours_start', s.business_hours_start,
    'business_hours_end', s.business_hours_end,
    'business_days', s.business_days,
    'timezone', s.timezone,
    'whatsapp_phone_number_id', s.whatsapp_phone_number_id,
    'whatsapp_business_account_id', s.whatsapp_business_account_id,
    'has_whatsapp_token', s.whatsapp_access_token IS NOT NULL,
    'whatsapp_verify_token', s.whatsapp_verify_token
  )
  INTO result
  FROM public.nina_settings s
  WHERE s.organization_id = p_org;
  RETURN result;
END;
$$;

-- 3. WhatsApp ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.owner_update_clinic_whatsapp(
  p_org uuid, p_phone_number_id text, p_business_account_id text, p_access_token text DEFAULT NULL
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
  SET whatsapp_phone_number_id = nullif(trim(p_phone_number_id), ''),
      whatsapp_business_account_id = nullif(trim(p_business_account_id), ''),
      -- token vazio = manter o atual (o painel nunca recebe o token salvo)
      whatsapp_access_token = COALESCE(nullif(trim(p_access_token), ''), whatsapp_access_token)
  WHERE organization_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A clínica ainda não tem configuração da Nina' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.owner_log(p_org, 'whatsapp_updated', jsonb_build_object(
    'phone_number_id', nullif(trim(p_phone_number_id), ''),
    'token_changed', nullif(trim(p_access_token), '') IS NOT NULL
  ));
END;
$$;

-- 4. Agente IA e prompt -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.owner_update_clinic_agent(p_org uuid, p_settings jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mode text := COALESCE(p_settings->>'ai_model_mode', 'flash');
BEGIN
  PERFORM public.assert_platform_owner();
  IF v_mode NOT IN ('flash', 'pro', 'pro3', 'adaptive') THEN
    RAISE EXCEPTION 'Modelo inválido' USING ERRCODE = '22023';
  END IF;
  IF coalesce(trim(p_settings->>'sdr_name'), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome da assistente' USING ERRCODE = '22023';
  END IF;

  UPDATE public.nina_settings
  SET sdr_name = trim(p_settings->>'sdr_name'),
      company_name = nullif(trim(p_settings->>'company_name'), ''),
      is_active = COALESCE((p_settings->>'is_active')::boolean, is_active),
      auto_response_enabled = COALESCE((p_settings->>'auto_response_enabled')::boolean, auto_response_enabled),
      ai_model_mode = v_mode,
      audio_response_enabled = COALESCE((p_settings->>'audio_response_enabled')::boolean, audio_response_enabled),
      ai_scheduling_enabled = COALESCE((p_settings->>'ai_scheduling_enabled')::boolean, ai_scheduling_enabled),
      message_breaking_enabled = COALESCE((p_settings->>'message_breaking_enabled')::boolean, message_breaking_enabled),
      -- prompt vazio = volta ao prompt padrão de estética
      system_prompt_override = nullif(trim(p_settings->>'system_prompt_override'), '')
  WHERE organization_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A clínica ainda não tem configuração da Nina' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.owner_log(p_org, 'agent_updated', jsonb_build_object(
    'ai_model_mode', v_mode,
    'is_active', p_settings->'is_active',
    'custom_prompt', nullif(trim(p_settings->>'system_prompt_override'), '') IS NOT NULL
  ));
END;
$$;

-- 5. Horários ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.owner_update_clinic_hours(p_org uuid, p_start time, p_end time, p_days integer[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'O horário de fim precisa ser depois do início' USING ERRCODE = '22023';
  END IF;
  IF p_days IS NULL OR cardinality(p_days) = 0 OR EXISTS (SELECT 1 FROM unnest(p_days) d WHERE d < 0 OR d > 6) THEN
    RAISE EXCEPTION 'Escolha pelo menos um dia de atendimento' USING ERRCODE = '22023';
  END IF;

  UPDATE public.nina_settings
  SET business_hours_start = p_start,
      business_hours_end = p_end,
      business_days = (SELECT array_agg(DISTINCT d ORDER BY d) FROM unnest(p_days) d)
  WHERE organization_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A clínica ainda não tem configuração da Nina' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.owner_log(p_org, 'hours_updated', jsonb_build_object('start', p_start, 'end', p_end, 'days', p_days));
END;
$$;

-- 6. Procedimentos ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.owner_list_procedures(p_org uuid)
RETURNS SETOF public.procedures
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  RETURN QUERY SELECT * FROM public.procedures WHERE organization_id = p_org ORDER BY category, name;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_save_procedure(p_org uuid, p_procedure jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := nullif(p_procedure->>'id', '')::uuid;
  v_name text := trim(p_procedure->>'name');
  v_min numeric := nullif(p_procedure->>'price_min', '')::numeric;
  v_max numeric := nullif(p_procedure->>'price_max', '')::numeric;
BEGIN
  PERFORM public.assert_platform_owner();
  IF coalesce(v_name, '') = '' THEN
    RAISE EXCEPTION 'Informe o nome do procedimento' USING ERRCODE = '22023';
  END IF;
  IF (p_procedure->>'category') NOT IN ('facial', 'corporal', 'harmonizacao', 'capilar', 'bem_estar', 'pos_operatorio', 'outro') THEN
    RAISE EXCEPTION 'Categoria inválida' USING ERRCODE = '22023';
  END IF;
  IF v_min IS NOT NULL AND v_max IS NOT NULL AND v_max < v_min THEN
    RAISE EXCEPTION 'O preço máximo precisa ser maior que o mínimo' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.procedures (
      organization_id, name, category, description, duration_minutes, price_min, price_max,
      price_visible, contraindications, pre_care, post_care, is_active
    ) VALUES (
      p_org, v_name, p_procedure->>'category', nullif(trim(p_procedure->>'description'), ''),
      COALESCE(nullif(p_procedure->>'duration_minutes', '')::integer, 60), v_min, v_max,
      COALESCE((p_procedure->>'price_visible')::boolean, false),
      nullif(trim(p_procedure->>'contraindications'), ''), nullif(trim(p_procedure->>'pre_care'), ''),
      nullif(trim(p_procedure->>'post_care'), ''), COALESCE((p_procedure->>'is_active')::boolean, true)
    ) RETURNING id INTO v_id;
    PERFORM public.owner_log(p_org, 'procedure_created', jsonb_build_object('name', v_name));
  ELSE
    UPDATE public.procedures SET
      name = v_name,
      category = p_procedure->>'category',
      description = nullif(trim(p_procedure->>'description'), ''),
      duration_minutes = COALESCE(nullif(p_procedure->>'duration_minutes', '')::integer, 60),
      price_min = v_min, price_max = v_max,
      price_visible = COALESCE((p_procedure->>'price_visible')::boolean, false),
      contraindications = nullif(trim(p_procedure->>'contraindications'), ''),
      pre_care = nullif(trim(p_procedure->>'pre_care'), ''),
      post_care = nullif(trim(p_procedure->>'post_care'), ''),
      is_active = COALESCE((p_procedure->>'is_active')::boolean, true)
    WHERE id = v_id AND organization_id = p_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Procedimento não encontrado' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.owner_log(p_org, 'procedure_updated', jsonb_build_object('name', v_name));
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_delete_procedure(p_org uuid, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
BEGIN
  PERFORM public.assert_platform_owner();
  DELETE FROM public.procedures WHERE id = p_id AND organization_id = p_org RETURNING name INTO v_name;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Procedimento não encontrado' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.owner_log(p_org, 'procedure_deleted', jsonb_build_object('name', v_name));
END;
$$;

-- Histórico também para edição de dados e cobranças feitas pelo dono
CREATE OR REPLACE FUNCTION public.audit_owner_org_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.is_platform_owner() AND (
    NEW.name IS DISTINCT FROM OLD.name OR NEW.monthly_fee IS DISTINCT FROM OLD.monthly_fee
    OR NEW.contact_name IS DISTINCT FROM OLD.contact_name OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
    OR NEW.notes IS DISTINCT FROM OLD.notes
  ) THEN
    PERFORM public.owner_log(NEW.id, 'clinic_data_updated', jsonb_build_object('name', NEW.name, 'monthly_fee', NEW.monthly_fee));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_owner_org_changes ON public.organizations;
CREATE TRIGGER audit_owner_org_changes
  AFTER UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.audit_owner_org_changes();

CREATE OR REPLACE FUNCTION public.audit_owner_charge_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_owner() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.owner_log(NEW.organization_id, 'charge_created', jsonb_build_object('due_date', NEW.due_date, 'amount', NEW.amount));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.owner_log(NEW.organization_id, 'charge_' || NEW.status, jsonb_build_object('due_date', NEW.due_date, 'amount', NEW.amount, 'method', NEW.payment_method));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_owner_charge_changes ON public.organization_billing_charges;
CREATE TRIGGER audit_owner_charge_changes
  AFTER INSERT OR UPDATE ON public.organization_billing_charges
  FOR EACH ROW EXECUTE FUNCTION public.audit_owner_charge_changes();

REVOKE EXECUTE ON FUNCTION public.audit_owner_org_changes(), public.audit_owner_charge_changes() FROM PUBLIC, anon, authenticated;

-- 7. Permissões --------------------------------------------------------------

REVOKE ALL ON public.owner_audit_log FROM anon, authenticated;
GRANT ALL ON public.owner_audit_log TO service_role;

REVOKE EXECUTE ON FUNCTION
  public.owner_log(uuid, text, jsonb),
  public.owner_list_audit(uuid, integer),
  public.owner_get_clinic_config(uuid),
  public.owner_update_clinic_whatsapp(uuid, text, text, text),
  public.owner_update_clinic_agent(uuid, jsonb),
  public.owner_update_clinic_hours(uuid, time, time, integer[]),
  public.owner_list_procedures(uuid),
  public.owner_save_procedure(uuid, jsonb),
  public.owner_delete_procedure(uuid, uuid)
FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.owner_log(uuid, text, jsonb) FROM authenticated;

GRANT EXECUTE ON FUNCTION
  public.owner_list_audit(uuid, integer),
  public.owner_get_clinic_config(uuid),
  public.owner_update_clinic_whatsapp(uuid, text, text, text),
  public.owner_update_clinic_agent(uuid, jsonb),
  public.owner_update_clinic_hours(uuid, time, time, integer[]),
  public.owner_list_procedures(uuid),
  public.owner_save_procedure(uuid, jsonb),
  public.owner_delete_procedure(uuid, uuid)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_log(uuid, text, jsonb) TO service_role;
