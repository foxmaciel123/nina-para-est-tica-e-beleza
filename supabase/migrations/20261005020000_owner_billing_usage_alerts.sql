-- Painel do Dono no formato VendaFlow: cobrança manual, consumo de IA e alertas.
-- Tudo é lido/escrito por RPCs SECURITY DEFINER que exigem o dono da plataforma;
-- as tabelas novas não têm policy para usuários comuns.

-- 0. Helper ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_platform_owner()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Acesso restrito ao dono da plataforma' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.today_sp()
RETURNS date
LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

CREATE OR REPLACE FUNCTION public.format_brl(p numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 'R$ ' || translate(to_char(COALESCE(p, 0), 'FM999,999,990.00'), ',.', '.,')
$$;

-- 1. Dados comerciais da clínica ---------------------------------------------

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS monthly_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS notes text;

-- 2. Cobranças manuais (Pix/boleto por fora) ---------------------------------

CREATE TABLE IF NOT EXISTS public.organization_billing_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled')),
  paid_at date,
  payment_method text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_billing_charges_org_due_idx
  ON public.organization_billing_charges (organization_id, due_date);
ALTER TABLE public.organization_billing_charges ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_organization_billing_charges_updated_at ON public.organization_billing_charges;
CREATE TRIGGER update_organization_billing_charges_updated_at
  BEFORE UPDATE ON public.organization_billing_charges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Situação de uma cobrança: paid | canceled | overdue | due_soon | pending
CREATE OR REPLACE FUNCTION public.charge_display_status(p_status text, p_due date)
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN p_status <> 'pending' THEN p_status
    WHEN p_due < public.today_sp() THEN 'overdue'
    WHEN p_due <= public.today_sp() + 5 THEN 'due_soon'
    ELSE 'pending'
  END
$$;

-- Situação da mensalidade da clínica: overdue | due_soon | ok | none
CREATE OR REPLACE FUNCTION public.org_billing_state(p_org uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.organization_billing_charges c
                 WHERE c.organization_id = p_org AND c.status = 'pending' AND c.due_date < public.today_sp()) THEN 'overdue'
    WHEN EXISTS (SELECT 1 FROM public.organization_billing_charges c
                 WHERE c.organization_id = p_org AND c.status = 'pending' AND c.due_date <= public.today_sp() + 5) THEN 'due_soon'
    WHEN EXISTS (SELECT 1 FROM public.organization_billing_charges c WHERE c.organization_id = p_org) THEN 'ok'
    ELSE 'none'
  END
$$;

-- 3. Consumo de IA -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('chat', 'analysis', 'prompt', 'transcription')),
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_events_org_created_idx ON public.ai_usage_events (organization_id, created_at);
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

-- Preço por milhão de tokens em US$ (editável; confira a tabela do Google ao mudar de modelo)
CREATE TABLE IF NOT EXISTS public.ai_model_prices (
  model text PRIMARY KEY,
  input_per_million numeric(10,4) NOT NULL,
  output_per_million numeric(10,4) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_model_prices ENABLE ROW LEVEL SECURITY;
INSERT INTO public.ai_model_prices (model, input_per_million, output_per_million) VALUES
  ('gemini-2.5-flash', 0.30, 2.50),
  ('gemini-2.5-pro', 1.25, 10.00)
ON CONFLICT (model) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ai_event_cost_usd(p_model text, p_in integer, p_out integer)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT (p_in * p.input_per_million + p_out * p.output_per_million) / 1000000.0
     FROM public.ai_model_prices p WHERE p.model = p_model),
    0)
$$;

-- 4. Visão geral do dono -----------------------------------------------------

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
    'mrr', (SELECT COALESCE(sum(monthly_fee), 0) FROM public.organizations WHERE status = 'active'),
    'received_month', (SELECT COALESCE(sum(amount), 0) FROM public.organization_billing_charges
                       WHERE status = 'paid' AND paid_at >= month_start),
    'overdue_count', (SELECT count(DISTINCT organization_id) FROM public.organization_billing_charges
                      WHERE status = 'pending' AND due_date < public.today_sp()),
    'overdue_amount', (SELECT COALESCE(sum(amount), 0) FROM public.organization_billing_charges
                       WHERE status = 'pending' AND due_date < public.today_sp()),
    'due_soon_count', (SELECT count(*) FROM public.organization_billing_charges
                       WHERE status = 'pending' AND due_date BETWEEN public.today_sp() AND public.today_sp() + 5),
    'ai_responses_30d', (SELECT count(*) FROM public.messages WHERE from_type = 'nina' AND sent_at >= now() - interval '30 days'),
    'ai_cost_month_usd', (SELECT COALESCE(sum(public.ai_event_cost_usd(model, prompt_tokens, completion_tokens)), 0)
                          FROM public.ai_usage_events WHERE created_at >= month_start)
  );
END;
$$;

-- Lista de clínicas (troca o tipo de retorno: precisa recriar)
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
  next_due_date date
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
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
    COALESCE((SELECT s.whatsapp_phone_number_id IS NOT NULL AND s.whatsapp_access_token IS NOT NULL
      FROM public.nina_settings s WHERE s.organization_id = o.id), false),
    (SELECT max(c.last_message_at) FROM public.conversations c WHERE c.organization_id = o.id),
    o.monthly_fee,
    public.org_billing_state(o.id),
    (SELECT min(c.due_date) FROM public.organization_billing_charges c WHERE c.organization_id = o.id AND c.status = 'pending')
  FROM public.organizations o
  ORDER BY o.created_at;
END;
$$;

-- Detalhe da clínica (abas Resumo, WhatsApp, Agente IA, Cobrança)
CREATE OR REPLACE FUNCTION public.owner_organization_detail(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.assert_platform_owner();

  SELECT jsonb_build_object(
    'organization', jsonb_build_object(
      'id', o.id, 'name', o.name, 'status', o.status, 'created_at', o.created_at,
      'monthly_fee', o.monthly_fee, 'contact_name', o.contact_name,
      'contact_phone', o.contact_phone, 'notes', o.notes
    ),
    'billing', jsonb_build_object(
      'state', public.org_billing_state(o.id),
      'next_due_date', (SELECT min(c.due_date) FROM public.organization_billing_charges c
                        WHERE c.organization_id = o.id AND c.status = 'pending'),
      'overdue_amount', (SELECT COALESCE(sum(c.amount), 0) FROM public.organization_billing_charges c
                         WHERE c.organization_id = o.id AND c.status = 'pending' AND c.due_date < public.today_sp())
    ),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'email', u.email, 'role', m.role, 'full_name', p.full_name,
        'joined_at', m.created_at, 'last_sign_in_at', u.last_sign_in_at
      ) ORDER BY m.created_at)
      FROM public.organization_members m
      JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.profiles p ON p.user_id = m.user_id
      WHERE m.organization_id = o.id
    ), '[]'::jsonb),
    'settings', (
      SELECT jsonb_build_object(
        'company_name', s.company_name,
        'assistant_name', s.sdr_name,
        'is_active', s.is_active,
        'auto_response_enabled', s.auto_response_enabled,
        'whatsapp_connected', s.whatsapp_phone_number_id IS NOT NULL AND s.whatsapp_access_token IS NOT NULL,
        'custom_prompt', s.system_prompt_override IS NOT NULL,
        'prompt_preview', left(s.system_prompt_override, 800),
        'ai_model_mode', s.ai_model_mode,
        'business_hours', s.business_hours_start || ' – ' || s.business_hours_end,
        'business_days', s.business_days,
        'audio_response_enabled', s.audio_response_enabled,
        'ai_scheduling_enabled', s.ai_scheduling_enabled
      )
      FROM public.nina_settings s WHERE s.organization_id = o.id
    ),
    'whatsapp', (
      SELECT jsonb_build_object(
        'connected', s.whatsapp_phone_number_id IS NOT NULL AND s.whatsapp_access_token IS NOT NULL,
        'phone_number_id', s.whatsapp_phone_number_id,
        'business_account_id', s.whatsapp_business_account_id,
        'has_token', s.whatsapp_access_token IS NOT NULL,
        'verify_token', s.whatsapp_verify_token,
        'last_received_at', (SELECT max(msg.sent_at) FROM public.messages msg WHERE msg.organization_id = o.id AND msg.from_type = 'user'),
        'last_sent_at', (SELECT max(msg.sent_at) FROM public.messages msg WHERE msg.organization_id = o.id AND msg.from_type <> 'user'),
        'failed_sends_7d', (SELECT count(*) FROM public.send_queue q JOIN public.conversations c ON c.id = q.conversation_id
                            WHERE c.organization_id = o.id AND q.status = 'failed' AND q.created_at >= now() - interval '7 days')
      )
      FROM public.nina_settings s WHERE s.organization_id = o.id
    ),
    'usage_30d', jsonb_build_object(
      'contacts_total', (SELECT count(*) FROM public.contacts c WHERE c.organization_id = o.id),
      'new_contacts', (SELECT count(*) FROM public.contacts c WHERE c.organization_id = o.id AND c.created_at >= now() - interval '30 days'),
      'conversations', (SELECT count(*) FROM public.conversations c WHERE c.organization_id = o.id AND c.last_message_at >= now() - interval '30 days'),
      'messages_received', (SELECT count(*) FROM public.messages msg WHERE msg.organization_id = o.id AND msg.from_type = 'user' AND msg.sent_at >= now() - interval '30 days'),
      'ai_messages', (SELECT count(*) FROM public.messages msg WHERE msg.organization_id = o.id AND msg.from_type = 'nina' AND msg.sent_at >= now() - interval '30 days'),
      'appointments', (SELECT count(*) FROM public.appointments a WHERE a.organization_id = o.id AND a.created_at >= now() - interval '30 days'),
      'ai_tokens', (SELECT COALESCE(sum(e.prompt_tokens + e.completion_tokens), 0) FROM public.ai_usage_events e
                    WHERE e.organization_id = o.id AND e.created_at >= now() - interval '30 days'),
      'ai_cost_usd', (SELECT COALESCE(sum(public.ai_event_cost_usd(e.model, e.prompt_tokens, e.completion_tokens)), 0)
                      FROM public.ai_usage_events e WHERE e.organization_id = o.id AND e.created_at >= now() - interval '30 days')
    ),
    'daily_ai_messages', (
      SELECT jsonb_agg(jsonb_build_object('day', d::date, 'count', COALESCE(x.n, 0)) ORDER BY d)
      FROM generate_series((now() - interval '29 days')::date, now()::date, interval '1 day') d
      LEFT JOIN (
        SELECT msg.sent_at::date AS day, count(*) AS n
        FROM public.messages msg
        WHERE msg.organization_id = o.id AND msg.from_type = 'nina' AND msg.sent_at >= now() - interval '30 days'
        GROUP BY 1
      ) x ON x.day = d::date
    )
  )
  INTO result
  FROM public.organizations o
  WHERE o.id = p_org;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Clínica não encontrada' USING ERRCODE = 'P0002';
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_update_organization(
  p_org uuid, p_name text, p_monthly_fee numeric,
  p_contact_name text, p_contact_phone text, p_notes text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome da clínica' USING ERRCODE = '22023';
  END IF;
  IF p_monthly_fee IS NULL OR p_monthly_fee < 0 THEN
    RAISE EXCEPTION 'Mensalidade inválida' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organizations
  SET name = trim(p_name), monthly_fee = p_monthly_fee,
      contact_name = nullif(trim(p_contact_name), ''),
      contact_phone = nullif(trim(p_contact_phone), ''),
      notes = nullif(trim(p_notes), '')
  WHERE id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clínica não encontrada' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- 5. Cobranças ---------------------------------------------------------------

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
  PERFORM public.assert_platform_owner();
  RETURN QUERY
  SELECT c.id, c.organization_id, o.name, c.due_date, c.amount, c.status,
         public.charge_display_status(c.status, c.due_date),
         c.paid_at, c.payment_method, c.notes
  FROM public.organization_billing_charges c
  JOIN public.organizations o ON o.id = c.organization_id
  WHERE p_org IS NULL OR c.organization_id = p_org
  ORDER BY c.due_date DESC, o.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_create_charge(p_org uuid, p_due_date date, p_amount numeric, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_id uuid;
BEGIN
  PERFORM public.assert_platform_owner();
  IF p_due_date IS NULL THEN
    RAISE EXCEPTION 'Informe o vencimento' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.organization_billing_charges (organization_id, due_date, amount, notes)
  VALUES (p_org, p_due_date, p_amount, nullif(trim(p_notes), ''))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_mark_charge_paid(p_charge uuid, p_paid_at date DEFAULT NULL, p_method text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
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
  PERFORM public.assert_platform_owner();
  UPDATE public.organization_billing_charges SET status = 'canceled'
  WHERE id = p_charge AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobrança não encontrada ou já encerrada' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- 6. Consumo de IA -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.owner_ai_usage(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  since timestamptz := now() - make_interval(days => GREATEST(1, LEAST(p_days, 365)));
BEGIN
  PERFORM public.assert_platform_owner();
  RETURN jsonb_build_object(
    'days', GREATEST(1, LEAST(p_days, 365)),
    'totals', (
      SELECT jsonb_build_object(
        'events', count(*),
        'prompt_tokens', COALESCE(sum(prompt_tokens), 0),
        'completion_tokens', COALESCE(sum(completion_tokens), 0),
        'cost_usd', COALESCE(sum(public.ai_event_cost_usd(model, prompt_tokens, completion_tokens)), 0)
      ) FROM public.ai_usage_events WHERE created_at >= since
    ),
    'responses', (SELECT count(*) FROM public.messages WHERE from_type = 'nina' AND sent_at >= since),
    'by_organization', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.cost_usd DESC, t.name)
      FROM (
        SELECT o.id, o.name, o.status,
          (SELECT count(*) FROM public.messages msg WHERE msg.organization_id = o.id AND msg.from_type = 'nina' AND msg.sent_at >= since) AS responses,
          COALESCE(sum(e.prompt_tokens + e.completion_tokens), 0) AS tokens,
          COALESCE(sum(public.ai_event_cost_usd(e.model, e.prompt_tokens, e.completion_tokens)), 0) AS cost_usd
        FROM public.organizations o
        LEFT JOIN public.ai_usage_events e ON e.organization_id = o.id AND e.created_at >= since
        GROUP BY o.id, o.name, o.status
      ) t
    ), '[]'::jsonb),
    'by_kind', COALESCE((
      SELECT jsonb_agg(row_to_json(k))
      FROM (
        SELECT kind, count(*) AS events,
          COALESCE(sum(public.ai_event_cost_usd(model, prompt_tokens, completion_tokens)), 0) AS cost_usd
        FROM public.ai_usage_events WHERE created_at >= since GROUP BY kind
      ) k
    ), '[]'::jsonb),
    'daily', (
      SELECT jsonb_agg(jsonb_build_object('day', d::date, 'cost_usd', COALESCE(x.cost, 0), 'tokens', COALESCE(x.tokens, 0)) ORDER BY d)
      FROM generate_series(since::date, now()::date, interval '1 day') d
      LEFT JOIN (
        SELECT created_at::date AS day,
          sum(public.ai_event_cost_usd(model, prompt_tokens, completion_tokens)) AS cost,
          sum(prompt_tokens + completion_tokens) AS tokens
        FROM public.ai_usage_events WHERE created_at >= since GROUP BY 1
      ) x ON x.day = d::date
    ),
    'prices', COALESCE((SELECT jsonb_agg(row_to_json(p)) FROM public.ai_model_prices p), '[]'::jsonb)
  );
END;
$$;

-- 7. Alertas (calculados ao vivo; somem sozinhos quando a causa é resolvida) --

CREATE OR REPLACE FUNCTION public.owner_alerts()
RETURNS TABLE (
  severity text, kind text, organization_id uuid, organization_name text,
  title text, detail text, since timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_platform_owner();
  RETURN QUERY
  -- Mensalidade atrasada
  SELECT 'critical', 'billing_overdue', o.id, o.name, 'Mensalidade atrasada',
         public.format_brl(sum(c.amount)) || ' em aberto desde ' || to_char(min(c.due_date), 'DD/MM'),
         min(c.due_date)::timestamptz
  FROM public.organization_billing_charges c JOIN public.organizations o ON o.id = c.organization_id
  WHERE c.status = 'pending' AND c.due_date < public.today_sp()
  GROUP BY o.id, o.name
  UNION ALL
  -- Falhas de envio no WhatsApp (24h)
  SELECT 'critical', 'send_failures', o.id, o.name, 'Mensagens não enviadas',
         count(*) || ' falha(s) de envio nas últimas 24 h', max(q.created_at)
  FROM public.send_queue q
  JOIN public.conversations c ON c.id = q.conversation_id
  JOIN public.organizations o ON o.id = c.organization_id
  WHERE q.status = 'failed' AND q.created_at >= now() - interval '24 hours'
    AND coalesce(q.error_message, '') <> 'Clínica suspensa'
  GROUP BY o.id, o.name
  UNION ALL
  -- Nina falhou ao responder (24h)
  SELECT 'critical', 'ai_failures', o.id, o.name, 'Nina falhou ao responder',
         count(*) || ' mensagem(ns) sem resposta por erro nas últimas 24 h', max(n.created_at)
  FROM public.nina_processing_queue n
  JOIN public.conversations c ON c.id = n.conversation_id
  JOIN public.organizations o ON o.id = c.organization_id
  WHERE n.status = 'failed' AND n.created_at >= now() - interval '24 hours'
  GROUP BY o.id, o.name
  UNION ALL
  -- Mensalidade vence em até 5 dias
  SELECT 'warning', 'billing_due_soon', o.id, o.name, 'Mensalidade vence em breve',
         public.format_brl(c.amount) || ' vence em ' || to_char(c.due_date, 'DD/MM'),
         c.due_date::timestamptz
  FROM public.organization_billing_charges c JOIN public.organizations o ON o.id = c.organization_id
  WHERE c.status = 'pending' AND c.due_date BETWEEN public.today_sp() AND public.today_sp() + 5
  UNION ALL
  -- WhatsApp não conectado depois de 2 dias
  SELECT 'warning', 'whatsapp_pending', o.id, o.name, 'WhatsApp não conectado',
         'A clínica foi criada em ' || to_char(o.created_at, 'DD/MM') || ' e ainda não conectou o WhatsApp', o.created_at
  FROM public.organizations o
  LEFT JOIN public.nina_settings s ON s.organization_id = o.id
  WHERE o.status = 'active' AND o.created_at < now() - interval '2 days'
    AND (s.id IS NULL OR s.whatsapp_phone_number_id IS NULL OR s.whatsapp_access_token IS NULL)
  UNION ALL
  -- Nina desligada numa clínica ativa
  SELECT 'warning', 'nina_disabled', o.id, o.name, 'Nina desligada',
         'A clínica desligou as respostas automáticas', s.updated_at
  FROM public.organizations o JOIN public.nina_settings s ON s.organization_id = o.id
  WHERE o.status = 'active' AND s.is_active = false
  UNION ALL
  -- Sem mensagens há 7 dias (clínica que já recebia)
  SELECT 'info', 'inactive', o.id, o.name, 'Sem mensagens há 7 dias',
         'Última mensagem recebida em ' || to_char(x.last_in, 'DD/MM'), x.last_in
  FROM public.organizations o
  JOIN LATERAL (
    SELECT max(msg.sent_at) AS last_in FROM public.messages msg
    WHERE msg.organization_id = o.id AND msg.from_type = 'user'
  ) x ON true
  WHERE o.status = 'active' AND x.last_in IS NOT NULL AND x.last_in < now() - interval '7 days'
  UNION ALL
  -- Clínica suspensa
  SELECT 'info', 'suspended', o.id, o.name, 'Clínica suspensa',
         'A equipe está sem acesso e a Nina não responde', o.updated_at
  FROM public.organizations o WHERE o.status = 'suspended';
END;
$$;

-- 8. Permissões --------------------------------------------------------------

REVOKE ALL ON public.organization_billing_charges, public.ai_usage_events, public.ai_model_prices FROM anon, authenticated;
GRANT ALL ON public.organization_billing_charges, public.ai_usage_events, public.ai_model_prices TO service_role;

REVOKE EXECUTE ON FUNCTION
  public.assert_platform_owner(),
  public.org_billing_state(uuid),
  public.ai_event_cost_usd(text, integer, integer),
  public.owner_dashboard_summary(),
  public.owner_organizations_overview(),
  public.owner_organization_detail(uuid),
  public.owner_update_organization(uuid, text, numeric, text, text, text),
  public.owner_list_charges(uuid),
  public.owner_create_charge(uuid, date, numeric, text),
  public.owner_mark_charge_paid(uuid, date, text),
  public.owner_cancel_charge(uuid),
  public.owner_ai_usage(integer),
  public.owner_alerts()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.owner_dashboard_summary(),
  public.owner_organizations_overview(),
  public.owner_organization_detail(uuid),
  public.owner_update_organization(uuid, text, numeric, text, text, text),
  public.owner_list_charges(uuid),
  public.owner_create_charge(uuid, date, numeric, text),
  public.owner_mark_charge_paid(uuid, date, text),
  public.owner_cancel_charge(uuid),
  public.owner_ai_usage(integer),
  public.owner_alerts()
TO authenticated, service_role;
