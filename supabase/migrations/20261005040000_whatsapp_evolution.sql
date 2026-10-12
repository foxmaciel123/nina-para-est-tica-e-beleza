-- Fase 5 do SaaS: WhatsApp por QR code (Evolution API exclusiva da Nina).
-- A clínica escolhe o provedor: 'meta' (API oficial) ou 'evolution' (QR code).

ALTER TABLE public.nina_settings
  ADD COLUMN IF NOT EXISTS whatsapp_provider text NOT NULL DEFAULT 'meta'
    CHECK (whatsapp_provider IN ('meta', 'evolution')),
  ADD COLUMN IF NOT EXISTS evolution_instance text,
  ADD COLUMN IF NOT EXISTS evolution_token text,
  ADD COLUMN IF NOT EXISTS evolution_status text,
  ADD COLUMN IF NOT EXISTS evolution_phone text,
  ADD COLUMN IF NOT EXISTS evolution_connected_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS nina_settings_evolution_instance_unique
  ON public.nina_settings (evolution_instance) WHERE evolution_instance IS NOT NULL;

-- WhatsApp conectado, valendo para os dois provedores
CREATE OR REPLACE FUNCTION public.whatsapp_connected(s public.nina_settings)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN s.whatsapp_provider = 'evolution' THEN COALESCE(s.evolution_status = 'open', false)
    ELSE s.whatsapp_phone_number_id IS NOT NULL AND s.whatsapp_access_token IS NOT NULL
  END
$$;

-- Funções do dono recriadas com a regra de "conectado" dos dois provedores
-- (mesmo corpo das migrations 20261005020000 e 20261005030000).
CREATE OR REPLACE FUNCTION public.owner_organizations_overview()
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
    COALESCE((SELECT public.whatsapp_connected(s)
      FROM public.nina_settings s WHERE s.organization_id = o.id), false),
    (SELECT max(c.last_message_at) FROM public.conversations c WHERE c.organization_id = o.id),
    o.monthly_fee,
    public.org_billing_state(o.id),
    (SELECT min(c.due_date) FROM public.organization_billing_charges c WHERE c.organization_id = o.id AND c.status = 'pending')
  FROM public.organizations o
  ORDER BY o.created_at;
END;
$$;

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
        'whatsapp_connected', public.whatsapp_connected(s),
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
        'connected', public.whatsapp_connected(s),
        'provider', s.whatsapp_provider,
        'evolution_status', s.evolution_status,
        'evolution_phone', s.evolution_phone,
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
    AND (s.id IS NULL OR NOT public.whatsapp_connected(s))
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
    'whatsapp_verify_token', s.whatsapp_verify_token,
    'whatsapp_provider', s.whatsapp_provider,
    'evolution_status', s.evolution_status,
    'evolution_phone', s.evolution_phone,
    'evolution_connected_at', s.evolution_connected_at,
    'whatsapp_connected', public.whatsapp_connected(s)
  )
  INTO result
  FROM public.nina_settings s
  WHERE s.organization_id = p_org;
  RETURN result;
END;
$$;

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
  SET whatsapp_provider = 'meta',
      whatsapp_phone_number_id = nullif(trim(p_phone_number_id), ''),
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

REVOKE EXECUTE ON FUNCTION public.whatsapp_connected(public.nina_settings) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_connected(public.nina_settings) TO authenticated, service_role;