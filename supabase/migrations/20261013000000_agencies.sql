-- White label, etapa 2: agências.
-- O dono cadastra agências; cada agência tem as próprias clínicas e um painel
-- para criar, configurar e cobrar essas clínicas. O dono continua vendo e
-- configurando tudo (suporte). Gasto de IA (tokens e custo) é só do dono.

-- 1. Tabelas ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  fee_per_clinic numeric(10, 2) CHECK (fee_per_clinic IS NULL OR fee_per_clinic >= 0), -- combinado depois com cada agência
  contact_name text,
  contact_phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS agency_members_agency_idx ON public.agency_members (agency_id);

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS organizations_agency_idx ON public.organizations (agency_id);

ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agencies, public.agency_members FROM anon, authenticated;
GRANT ALL ON public.agencies, public.agency_members TO service_role;

ALTER TABLE public.owner_audit_log ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE CASCADE;

-- 2. Quem gerencia o quê ------------------------------------------------------

-- Agência ativa do usuário logado (null se não for de agência ou se estiver suspensa)
CREATE OR REPLACE FUNCTION public.my_agency_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.agency_id FROM public.agency_members m
  JOIN public.agencies a ON a.id = m.agency_id
  WHERE m.user_id = auth.uid() AND a.status = 'active'
  LIMIT 1;
$$;

-- Agência do usuário logado (inclusive suspensa, para o painel mostrar o aviso)
CREATE OR REPLACE FUNCTION public.my_agency()
RETURNS TABLE (id uuid, name text, status text, role text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id, a.name, a.status, m.role FROM public.agency_members m
  JOIN public.agencies a ON a.id = m.agency_id
  WHERE m.user_id = auth.uid()
  LIMIT 1;
$$;

-- Usada também pelas edge functions (service_role), que informam o usuário
CREATE OR REPLACE FUNCTION public.can_user_manage_org(p_user uuid, p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_user AND is_platform_owner)
      OR EXISTS (
        SELECT 1 FROM public.organizations o
        JOIN public.agency_members m ON m.agency_id = o.agency_id
        JOIN public.agencies a ON a.id = o.agency_id
        WHERE o.id = p_org AND m.user_id = p_user AND a.status = 'active'
      );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_org(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND public.can_user_manage_org(auth.uid(), p_org);
$$;

CREATE OR REPLACE FUNCTION public.assert_can_manage_org(p_org uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.can_manage_org(p_org) THEN
    RAISE EXCEPTION 'Acesso restrito' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Dono ou agência ativa
CREATE OR REPLACE FUNCTION public.assert_manager()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_owner() AND public.my_agency_id() IS NULL THEN
    RAISE EXCEPTION 'Acesso restrito' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Clínicas que o usuário logado gerencia: todas (dono) ou as da agência
CREATE OR REPLACE FUNCTION public.managed_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.id FROM public.organizations o
  WHERE public.is_platform_owner()
     OR (o.agency_id IS NOT NULL AND o.agency_id = public.my_agency_id());
$$;

-- 3. Funções de clínica: dono OU agência da clínica ----------------------------

DO $$
DECLARE
  fn text;
  r record;
  v_def text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'owner_organization_detail', 'owner_set_organization_status', 'owner_update_organization',
    'owner_get_clinic_config', 'owner_update_clinic_whatsapp', 'owner_update_clinic_agent',
    'owner_update_clinic_hours', 'owner_list_procedures', 'owner_save_procedure',
    'owner_delete_procedure', 'owner_list_audit', 'owner_create_charge', 'owner_has_app_secret'
  ] LOOP
    FOR r IN
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      v_def := pg_get_functiondef(r.oid);
      IF position('PERFORM public.assert_platform_owner();' IN v_def) = 0 THEN
        RAISE EXCEPTION 'Função % sem a checagem esperada', fn;
      END IF;
      EXECUTE replace(v_def, 'PERFORM public.assert_platform_owner();', 'PERFORM public.assert_can_manage_org(p_org);');
    END LOOP;
  END LOOP;
END;
$$;

-- Detalhe da clínica: a agência não vê tokens nem custo de IA
ALTER FUNCTION public.owner_organization_detail(uuid) RENAME TO org_detail_full;
REVOKE ALL ON FUNCTION public.org_detail_full(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_organization_detail(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb;
BEGIN
  v := public.org_detail_full(p_org);
  v := jsonb_set(v, '{organization}', (v->'organization') || jsonb_build_object(
    'agency_id', (SELECT agency_id FROM public.organizations WHERE id = p_org),
    'agency_name', (SELECT a.name FROM public.organizations o JOIN public.agencies a ON a.id = o.agency_id WHERE o.id = p_org)
  ));
  IF NOT public.is_platform_owner() THEN
    v := v #- '{usage_30d,ai_tokens}' #- '{usage_30d,ai_cost_usd}';
  END IF;
  RETURN v;
END;
$$;

-- Cobranças: marcar paga / cancelar conferindo a clínica da cobrança
CREATE OR REPLACE FUNCTION public.owner_mark_charge_paid(p_charge uuid, p_paid_at date DEFAULT NULL, p_method text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_can_manage_org((SELECT organization_id FROM public.organization_billing_charges WHERE id = p_charge));
  UPDATE public.organization_billing_charges
  SET status = 'paid', paid_at = COALESCE(p_paid_at, public.today_sp()),
      payment_method = nullif(trim(p_method), '')
  WHERE id = p_charge AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobrança não encontrada ou já encerrada' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_cancel_charge(p_charge uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_can_manage_org((SELECT organization_id FROM public.organization_billing_charges WHERE id = p_charge));
  UPDATE public.organization_billing_charges SET status = 'canceled'
  WHERE id = p_charge AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobrança não encontrada ou já encerrada' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Lista de cobranças. Sem clínica informada: o dono vê só as clínicas diretas
-- (as cobranças das clínicas de agência são da agência); a agência vê as dela.
CREATE OR REPLACE FUNCTION public.owner_list_charges(p_org uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, organization_id uuid, organization_name text,
  due_date date, amount numeric, status text, display_status text,
  paid_at date, payment_method text, notes text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_org IS NULL THEN
    PERFORM public.assert_manager();
  ELSE
    PERFORM public.assert_can_manage_org(p_org);
  END IF;
  RETURN QUERY
  SELECT c.id, c.organization_id, o.name, c.due_date, c.amount, c.status,
         public.charge_display_status(c.status, c.due_date),
         c.paid_at, c.payment_method, c.notes
  FROM public.organization_billing_charges c
  JOIN public.organizations o ON o.id = c.organization_id
  WHERE CASE
    WHEN p_org IS NOT NULL THEN c.organization_id = p_org
    WHEN public.is_platform_owner() THEN o.agency_id IS NULL
    ELSE o.agency_id = public.my_agency_id()
  END
  ORDER BY c.due_date DESC, o.name;
END;
$$;

-- Lista de clínicas com a agência de cada uma
DROP FUNCTION IF EXISTS public.owner_organizations_overview();
CREATE FUNCTION public.owner_organizations_overview()
RETURNS TABLE (
  id uuid,
  name text,
  status text,
  created_at timestamptz,
  admin_email text,
  members bigint,
  contacts bigint,
  conversations_30d bigint,
  ai_messages_30d bigint,
  appointments_30d bigint,
  whatsapp_connected boolean,
  last_activity_at timestamptz,
  monthly_fee numeric,
  billing_state text,
  next_due_date date,
  agency_id uuid,
  agency_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_manager();
  RETURN QUERY
  SELECT
    o.id, o.name, o.status, o.created_at,
    (SELECT u.email::text FROM public.organization_members m JOIN auth.users u ON u.id = m.user_id
      WHERE m.organization_id = o.id AND m.role = 'admin' ORDER BY m.created_at LIMIT 1),
    (SELECT count(*) FROM public.organization_members m WHERE m.organization_id = o.id),
    (SELECT count(*) FROM public.contacts c WHERE c.organization_id = o.id),
    (SELECT count(*) FROM public.conversations c WHERE c.organization_id = o.id AND c.last_message_at >= now() - interval '30 days'),
    (SELECT count(*) FROM public.messages msg WHERE msg.organization_id = o.id AND msg.from_type = 'nina' AND msg.sent_at >= now() - interval '30 days'),
    (SELECT count(*) FROM public.appointments a WHERE a.organization_id = o.id AND a.created_at >= now() - interval '30 days'),
    COALESCE((SELECT public.whatsapp_connected(s)
      FROM public.nina_settings s WHERE s.organization_id = o.id), false),
    (SELECT max(c.last_message_at) FROM public.conversations c WHERE c.organization_id = o.id),
    o.monthly_fee,
    public.org_billing_state(o.id),
    (SELECT min(c.due_date) FROM public.organization_billing_charges c WHERE c.organization_id = o.id AND c.status = 'pending'),
    o.agency_id,
    ag.name
  FROM public.organizations o
  LEFT JOIN public.agencies ag ON ag.id = o.agency_id
  WHERE o.id IN (SELECT public.managed_org_ids())
  ORDER BY o.created_at;
END;
$$;

-- Alertas: cada um vê os das clínicas que gerencia. Alertas de mensalidade de
-- clínica de agência ficam com a agência (não aparecem para o dono).
ALTER FUNCTION public.owner_alerts() RENAME TO alerts_all;
REVOKE ALL ON FUNCTION public.alerts_all() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.alerts_all()'::regprocedure);
  IF position('PERFORM public.assert_platform_owner();' IN v_def) = 0 THEN
    RAISE EXCEPTION 'alerts_all sem a checagem esperada';
  END IF;
  EXECUTE replace(v_def, 'PERFORM public.assert_platform_owner();', 'PERFORM public.assert_manager();');
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_alerts()
RETURNS TABLE (
  severity text, kind text, organization_id uuid, organization_name text,
  title text, detail text, since timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_manager();
  RETURN QUERY
  SELECT a.* FROM public.alerts_all() a
  JOIN public.organizations o ON o.id = a.organization_id
  WHERE o.id IN (SELECT public.managed_org_ids())
    AND NOT (public.is_platform_owner() AND o.agency_id IS NOT NULL AND a.kind LIKE 'billing%');
END;
$$;

-- Resumo do dono: dinheiro só das clínicas diretas + agências
CREATE OR REPLACE FUNCTION public.owner_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  month_start date := date_trunc('month', public.today_sp())::date;
BEGIN
  PERFORM public.assert_platform_owner();
  RETURN jsonb_build_object(
    'clinics_active', (SELECT count(*) FROM public.organizations WHERE status = 'active'),
    'clinics_suspended', (SELECT count(*) FROM public.organizations WHERE status = 'suspended'),
    'mrr', (SELECT COALESCE(sum(monthly_fee), 0) FROM public.organizations WHERE status = 'active' AND agency_id IS NULL),
    'received_month', (SELECT COALESCE(sum(c.amount), 0) FROM public.organization_billing_charges c
                       JOIN public.organizations o ON o.id = c.organization_id
                       WHERE o.agency_id IS NULL AND c.status = 'paid' AND c.paid_at >= month_start),
    'overdue_count', (SELECT count(DISTINCT c.organization_id) FROM public.organization_billing_charges c
                      JOIN public.organizations o ON o.id = c.organization_id
                      WHERE o.agency_id IS NULL AND c.status = 'pending' AND c.due_date < public.today_sp()),
    'overdue_amount', (SELECT COALESCE(sum(c.amount), 0) FROM public.organization_billing_charges c
                       JOIN public.organizations o ON o.id = c.organization_id
                       WHERE o.agency_id IS NULL AND c.status = 'pending' AND c.due_date < public.today_sp()),
    'due_soon_count', (SELECT count(*) FROM public.organization_billing_charges c
                       JOIN public.organizations o ON o.id = c.organization_id
                       WHERE o.agency_id IS NULL AND c.status = 'pending' AND c.due_date BETWEEN public.today_sp() AND public.today_sp() + 5),
    'ai_responses_30d', (SELECT count(*) FROM public.messages WHERE from_type = 'nina' AND sent_at >= now() - interval '30 days'),
    'ai_cost_month_usd', (SELECT COALESCE(sum(public.ai_event_cost_usd(model, prompt_tokens, completion_tokens)), 0)
                          FROM public.ai_usage_events WHERE created_at >= month_start),
    'agencies_active', (SELECT count(*) FROM public.agencies WHERE status = 'active'),
    'clinics_via_agencies', (SELECT count(*) FROM public.organizations o JOIN public.agencies a ON a.id = o.agency_id
                             WHERE o.status = 'active'),
    'agency_fees_month', (SELECT COALESCE(sum(a.fee_per_clinic), 0) FROM public.organizations o
                          JOIN public.agencies a ON a.id = o.agency_id
                          WHERE o.status = 'active' AND a.status = 'active')
  );
END;
$$;

-- Histórico: a agência também deixa registro do que faz nas clínicas dela
CREATE OR REPLACE FUNCTION public.audit_owner_org_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF (public.is_platform_owner() OR public.my_agency_id() IS NOT NULL) AND (
    NEW.name IS DISTINCT FROM OLD.name OR NEW.monthly_fee IS DISTINCT FROM OLD.monthly_fee
    OR NEW.contact_name IS DISTINCT FROM OLD.contact_name OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
    OR NEW.notes IS DISTINCT FROM OLD.notes
  ) THEN
    PERFORM public.owner_log(NEW.id, 'clinic_data_updated', jsonb_build_object('name', NEW.name, 'monthly_fee', NEW.monthly_fee));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_owner_charge_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_owner() AND public.my_agency_id() IS NULL THEN
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

-- 4. Painel da agência ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agency_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agency uuid := public.my_agency_id();
  month_start date := date_trunc('month', public.today_sp())::date;
BEGIN
  IF v_agency IS NULL THEN
    RAISE EXCEPTION 'Acesso restrito' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'agency_name', (SELECT name FROM public.agencies WHERE id = v_agency),
    'clinics_active', (SELECT count(*) FROM public.organizations WHERE agency_id = v_agency AND status = 'active'),
    'clinics_suspended', (SELECT count(*) FROM public.organizations WHERE agency_id = v_agency AND status = 'suspended'),
    'whatsapp_connected', (SELECT count(*) FROM public.organizations o JOIN public.nina_settings s ON s.organization_id = o.id
                           WHERE o.agency_id = v_agency AND o.status = 'active' AND public.whatsapp_connected(s)),
    'ai_responses_30d', (SELECT count(*) FROM public.messages m JOIN public.organizations o ON o.id = m.organization_id
                         WHERE o.agency_id = v_agency AND m.from_type = 'nina' AND m.sent_at >= now() - interval '30 days'),
    'fee_per_clinic', (SELECT fee_per_clinic FROM public.agencies WHERE id = v_agency),
    'mrr', (SELECT COALESCE(sum(monthly_fee), 0) FROM public.organizations WHERE agency_id = v_agency AND status = 'active'),
    'received_month', (SELECT COALESCE(sum(c.amount), 0) FROM public.organization_billing_charges c
                       JOIN public.organizations o ON o.id = c.organization_id
                       WHERE o.agency_id = v_agency AND c.status = 'paid' AND c.paid_at >= month_start),
    'overdue_count', (SELECT count(DISTINCT c.organization_id) FROM public.organization_billing_charges c
                      JOIN public.organizations o ON o.id = c.organization_id
                      WHERE o.agency_id = v_agency AND c.status = 'pending' AND c.due_date < public.today_sp()),
    'overdue_amount', (SELECT COALESCE(sum(c.amount), 0) FROM public.organization_billing_charges c
                       JOIN public.organizations o ON o.id = c.organization_id
                       WHERE o.agency_id = v_agency AND c.status = 'pending' AND c.due_date < public.today_sp())
  );
END;
$$;

-- 5. Agências no Painel do Dono ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.owner_agencies_overview()
RETURNS TABLE (
  id uuid, name text, status text, created_at timestamptz, admin_email text,
  contact_name text, contact_phone text, fee_per_clinic numeric,
  clinics_active bigint, clinics_total bigint, monthly_total numeric, notes text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  RETURN QUERY
  SELECT a.id, a.name, a.status, a.created_at,
    (SELECT u.email::text FROM public.agency_members m JOIN auth.users u ON u.id = m.user_id
      WHERE m.agency_id = a.id ORDER BY m.created_at LIMIT 1),
    a.contact_name, a.contact_phone, a.fee_per_clinic,
    (SELECT count(*) FROM public.organizations o WHERE o.agency_id = a.id AND o.status = 'active'),
    (SELECT count(*) FROM public.organizations o WHERE o.agency_id = a.id),
    CASE WHEN a.fee_per_clinic IS NULL THEN NULL
         ELSE a.fee_per_clinic * (SELECT count(*) FROM public.organizations o WHERE o.agency_id = a.id AND o.status = 'active') END,
    a.notes
  FROM public.agencies a
  ORDER BY a.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_agency_detail(p_agency uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a public.agencies;
BEGIN
  PERFORM public.assert_platform_owner();
  SELECT * INTO a FROM public.agencies WHERE id = p_agency;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agência não encontrada' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'agency', to_jsonb(a),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('email', u.email, 'full_name', p.full_name, 'joined_at', m.created_at,
                                          'last_sign_in_at', u.last_sign_in_at) ORDER BY m.created_at)
      FROM public.agency_members m JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.profiles p ON p.user_id = m.user_id
      WHERE m.agency_id = p_agency), '[]'::jsonb),
    'clinics', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'status', o.status, 'created_at', o.created_at) ORDER BY o.created_at)
      FROM public.organizations o WHERE o.agency_id = p_agency), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_update_agency(
  p_agency uuid, p_name text, p_fee_per_clinic numeric,
  p_contact_name text, p_contact_phone text, p_notes text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome da agência' USING ERRCODE = '22023';
  END IF;
  IF p_fee_per_clinic IS NOT NULL AND p_fee_per_clinic < 0 THEN
    RAISE EXCEPTION 'Valor por clínica inválido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.agencies
  SET name = btrim(p_name), fee_per_clinic = p_fee_per_clinic,
      contact_name = nullif(btrim(p_contact_name), ''),
      contact_phone = nullif(btrim(p_contact_phone), ''),
      notes = nullif(btrim(p_notes), ''),
      updated_at = now()
  WHERE id = p_agency;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agência não encontrada' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.owner_audit_log (agency_id, actor_id, action, details)
  VALUES (p_agency, auth.uid(), 'agency_updated', jsonb_build_object('name', btrim(p_name), 'fee_per_clinic', p_fee_per_clinic));
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_agency_status(p_agency uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Situação inválida' USING ERRCODE = '22023';
  END IF;
  UPDATE public.agencies SET status = p_status, updated_at = now() WHERE id = p_agency;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agência não encontrada' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.owner_audit_log (agency_id, actor_id, action, details)
  VALUES (p_agency, auth.uid(), 'agency_' || p_status, '{}'::jsonb);
END;
$$;

-- Passa uma clínica para uma agência (ou de volta para o dono, com null)
CREATE OR REPLACE FUNCTION public.owner_set_clinic_agency(p_org uuid, p_agency uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  IF p_agency IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agencies WHERE id = p_agency) THEN
    RAISE EXCEPTION 'Agência não encontrada' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.organizations SET agency_id = p_agency WHERE id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clínica não encontrada' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.owner_log(p_org, 'clinic_agency_changed',
    jsonb_build_object('agency', (SELECT name FROM public.agencies WHERE id = p_agency)));
END;
$$;

-- 6. Permissões ----------------------------------------------------------------

REVOKE ALL ON FUNCTION
  public.my_agency_id(), public.my_agency(), public.can_user_manage_org(uuid, uuid),
  public.can_manage_org(uuid), public.assert_can_manage_org(uuid), public.assert_manager(),
  public.managed_org_ids(), public.owner_organization_detail(uuid), public.owner_mark_charge_paid(uuid, date, text),
  public.owner_cancel_charge(uuid), public.owner_list_charges(uuid), public.owner_organizations_overview(),
  public.owner_alerts(), public.owner_dashboard_summary(), public.agency_dashboard_summary(),
  public.owner_agencies_overview(), public.owner_agency_detail(uuid),
  public.owner_update_agency(uuid, text, numeric, text, text, text), public.owner_set_agency_status(uuid, text),
  public.owner_set_clinic_agency(uuid, uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.my_agency(), public.owner_organization_detail(uuid), public.owner_mark_charge_paid(uuid, date, text),
  public.owner_cancel_charge(uuid), public.owner_list_charges(uuid), public.owner_organizations_overview(),
  public.owner_alerts(), public.owner_dashboard_summary(), public.agency_dashboard_summary(),
  public.owner_agencies_overview(), public.owner_agency_detail(uuid),
  public.owner_update_agency(uuid, text, numeric, text, text, text), public.owner_set_agency_status(uuid, text),
  public.owner_set_clinic_agency(uuid, uuid)
TO authenticated, service_role;

-- Funções internas: só usadas por outras funções e pelas edge functions
REVOKE EXECUTE ON FUNCTION public.can_user_manage_org(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.can_user_manage_org(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION
  public.my_agency_id(), public.can_manage_org(uuid), public.assert_can_manage_org(uuid),
  public.assert_manager(), public.managed_org_ids()
TO authenticated, service_role;
