-- DISPARO (campanhas em massa pela API oficial) + FOLLOW-UP (réguas automáticas)
-- Ideia trazida do sistema "Disparo-WhatsApp", refeita para a Nina:
--   * tudo separado por clínica (organization_id + RLS);
--   * disparo só com modelos (templates) APROVADOS pela Meta;
--   * ritmo seguro, limite diário, horário comercial e pausa automática
--     para não derrubar a qualidade do número;
--   * quem pede para sair (SAIR, PARAR...) ganha a etiqueta "nao-perturbe"
--     e nunca mais recebe disparo nem follow-up.

-- 1. Campanhas de disparo ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.disparo_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'auto_paused', 'completed', 'cancelled')),
  template_name text NOT NULL,
  template_language text NOT NULL DEFAULT 'pt_BR',
  template_category text,
  template_body text,
  -- [{ "source": "first_name" | "name" | "fixed", "value": "..." }] na ordem {{1}}, {{2}}...
  template_params jsonb NOT NULL DEFAULT '[]'::jsonb,
  header_media_url text,
  header_media_type text CHECK (header_media_type IS NULL OR header_media_type IN ('image', 'video', 'document')),
  -- { "type": "all" | "tags", "tags": [...], "phones": [...] }
  audience jsonb NOT NULL DEFAULT '{"type":"all"}'::jsonb,
  speed text NOT NULL DEFAULT 'seguro' CHECK (speed IN ('seguro', 'normal', 'rapido')),
  daily_limit integer NOT NULL DEFAULT 250 CHECK (daily_limit BETWEEN 1 AND 100000),
  window_start smallint NOT NULL DEFAULT 8 CHECK (window_start BETWEEN 0 AND 23),
  window_end smallint NOT NULL DEFAULT 20 CHECK (window_end BETWEEN 1 AND 24),
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  pause_reason text,
  total integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disparo_campaigns_org_idx ON public.disparo_campaigns (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS disparo_campaigns_status_idx ON public.disparo_campaigns (status);

CREATE TABLE IF NOT EXISTS public.disparo_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.disparo_campaigns(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  whatsapp_message_id text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, phone)
);
CREATE INDEX IF NOT EXISTS disparo_recipients_queue_idx ON public.disparo_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS disparo_recipients_org_sent_idx ON public.disparo_recipients (organization_id, sent_at);

-- 2. Follow-up -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.followup_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  -- sem_resposta: cliente parou de responder há X horas
  -- apos_agendamento: X horas depois do horário do agendamento
  -- etiqueta: cliente recebeu a etiqueta X
  trigger_type text NOT NULL DEFAULT 'sem_resposta'
    CHECK (trigger_type IN ('sem_resposta', 'apos_agendamento', 'etiqueta')),
  trigger_hours integer NOT NULL DEFAULT 24 CHECK (trigger_hours BETWEEN 0 AND 8760),
  trigger_tag text,
  stop_on_reply boolean NOT NULL DEFAULT true,
  window_start smallint NOT NULL DEFAULT 8 CHECK (window_start BETWEEN 0 AND 23),
  window_end smallint NOT NULL DEFAULT 20 CHECK (window_end BETWEEN 1 AND 24),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS followup_sequences_org_idx ON public.followup_sequences (organization_id);

CREATE TABLE IF NOT EXISTS public.followup_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES public.followup_sequences(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  -- espera antes deste passo (contada a partir do passo anterior / da entrada na régua)
  delay_hours integer NOT NULL DEFAULT 0 CHECK (delay_hours BETWEEN 0 AND 8760),
  -- texto: mensagem livre (só chega se o cliente falou nas últimas 24h)
  -- modelo: template aprovado (funciona a qualquer hora)
  kind text NOT NULL DEFAULT 'texto' CHECK (kind IN ('texto', 'modelo')),
  message text,
  template_name text,
  template_language text DEFAULT 'pt_BR',
  template_body text,
  template_params jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS followup_steps_seq_idx ON public.followup_steps (sequence_id, position);

CREATE TABLE IF NOT EXISTS public.followup_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES public.followup_sequences(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  -- o que fez entrar (id da última mensagem nossa, do agendamento ou 'etiqueta'):
  -- evita colocar a mesma pessoa duas vezes pelo mesmo motivo
  ref_id text NOT NULL,
  status text NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'concluido', 'respondeu', 'parado', 'erro')),
  current_step integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  stop_reason text,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, contact_id, ref_id)
);
CREATE INDEX IF NOT EXISTS followup_enrollments_due_idx ON public.followup_enrollments (status, next_run_at);
CREATE INDEX IF NOT EXISTS followup_enrollments_seq_idx ON public.followup_enrollments (sequence_id, enrolled_at DESC);

CREATE TABLE IF NOT EXISTS public.followup_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.followup_enrollments(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.followup_steps(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS followup_sends_enr_idx ON public.followup_sends (enrollment_id, created_at);

-- 3. organization_id automático + updated_at + RLS -----------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['disparo_campaigns', 'disparo_recipients', 'followup_sequences',
                           'followup_steps', 'followup_enrollments', 'followup_sends'] LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET DEFAULT public.current_org_id()', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Clinic members manage own data" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Clinic members manage own data" ON public.%I FOR ALL TO authenticated USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['disparo_campaigns', 'followup_sequences', 'followup_enrollments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

-- 4. Montar a lista de envio de uma campanha -----------------------------------
-- Pega os clientes da clínica (todos ou por etiqueta) + números colados,
-- tira bloqueados, "nao-perturbe" e repetidos, e grava em disparo_recipients.

CREATE OR REPLACE FUNCTION public.disparo_prepare_campaign(p_campaign uuid, p_start_at timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c public.disparo_campaigns;
  v_org uuid := public.current_org_id();
  v_tags text[];
  v_phone text;
  v_total integer;
BEGIN
  SELECT * INTO c FROM public.disparo_campaigns WHERE id = p_campaign;
  IF NOT FOUND OR c.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Campanha não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF c.status NOT IN ('draft', 'scheduled') THEN
    RAISE EXCEPTION 'Essa campanha já foi iniciada' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.disparo_recipients WHERE campaign_id = c.id;

  v_tags := ARRAY(SELECT jsonb_array_elements_text(COALESCE(c.audience->'tags', '[]'::jsonb)));

  -- Números colados: viram clientes da clínica (para a resposta cair no Atendimento)
  FOR v_phone IN
    SELECT DISTINCT regexp_replace(p, '\D', '', 'g')
    FROM jsonb_array_elements_text(COALESCE(c.audience->'phones', '[]'::jsonb)) AS p
    WHERE length(regexp_replace(p, '\D', '', 'g')) BETWEEN 10 AND 15
  LOOP
    IF length(v_phone) IN (10, 11) THEN v_phone := '55' || v_phone; END IF;
    INSERT INTO public.contacts (organization_id, phone_number, whatsapp_id, tags)
    VALUES (v_org, v_phone, v_phone, ARRAY['disparo'])
    ON CONFLICT (organization_id, phone_number) DO NOTHING;
  END LOOP;

  INSERT INTO public.disparo_recipients (organization_id, campaign_id, contact_id, phone, name)
  SELECT DISTINCT ON (regexp_replace(COALESCE(ct.whatsapp_id, ct.phone_number), '\D', '', 'g'))
    v_org, c.id, ct.id,
    regexp_replace(COALESCE(ct.whatsapp_id, ct.phone_number), '\D', '', 'g'),
    COALESCE(nullif(ct.call_name, ''), ct.name)
  FROM public.contacts ct
  WHERE ct.organization_id = v_org
    AND COALESCE(ct.is_blocked, false) = false
    AND NOT ('nao-perturbe' = ANY (COALESCE(ct.tags, '{}')))
    AND length(regexp_replace(COALESCE(ct.whatsapp_id, ct.phone_number), '\D', '', 'g')) >= 10
    AND (
      COALESCE(c.audience->>'type', 'all') = 'all'
      OR (COALESCE(c.audience->>'type', 'all') = 'tags' AND ct.tags && v_tags)
      OR regexp_replace(ct.phone_number, '\D', '', 'g') IN (
        SELECT CASE WHEN length(x) IN (10, 11) THEN '55' || x ELSE x END
        FROM (SELECT regexp_replace(p, '\D', '', 'g') AS x
              FROM jsonb_array_elements_text(COALESCE(c.audience->'phones', '[]'::jsonb)) AS p) s
      )
    )
  ON CONFLICT (campaign_id, phone) DO NOTHING;

  GET DIAGNOSTICS v_total = ROW_COUNT;

  UPDATE public.disparo_campaigns
  SET total = v_total, sent = 0, failed = 0, skipped = 0,
      status = CASE WHEN p_start_at IS NOT NULL AND p_start_at > now() THEN 'scheduled' ELSE 'running' END,
      scheduled_at = COALESCE(p_start_at, now()),
      started_at = NULL, finished_at = NULL, pause_reason = NULL
  WHERE id = c.id;

  RETURN v_total;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.disparo_prepare_campaign(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disparo_prepare_campaign(uuid, timestamptz) TO authenticated, service_role;

-- 5. Números das campanhas (entregues, lidas, respondidas) ---------------------
-- A Meta avisa entregue/lida no webhook, que já atualiza a tabela messages.

CREATE OR REPLACE FUNCTION public.disparo_campaign_stats()
RETURNS TABLE (campaign_id uuid, delivered bigint, read bigint, replied bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT r.campaign_id,
    count(*) FILTER (WHERE m.status IN ('delivered', 'read')) AS delivered,
    count(*) FILTER (WHERE m.status = 'read') AS read,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.messages um
      WHERE um.conversation_id = m.conversation_id
        AND um.from_type = 'user'
        AND um.sent_at > r.sent_at
    )) AS replied
  FROM public.disparo_recipients r
  JOIN public.messages m ON m.id = r.message_id
  WHERE r.organization_id = public.current_org_id()
  GROUP BY r.campaign_id;
$$;
REVOKE EXECUTE ON FUNCTION public.disparo_campaign_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disparo_campaign_stats() TO authenticated, service_role;

-- 6. Quem pediu para sair ganha "nao-perturbe" ---------------------------------

CREATE OR REPLACE FUNCTION public.disparo_sweep_optouts()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  WITH optouts AS (
    SELECT DISTINCT c.contact_id
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.from_type = 'user'
      AND m.sent_at > now() - interval '2 days'
      AND lower(trim(regexp_replace(COALESCE(m.content, ''), '[[:punct:]]', '', 'g')))
          IN ('sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'remover',
              'nao quero mais', 'não quero mais', 'nao tenho interesse', 'não tenho interesse')
  )
  UPDATE public.contacts ct
  SET tags = array_append(COALESCE(ct.tags, '{}'), 'nao-perturbe')
  FROM optouts o
  WHERE ct.id = o.contact_id
    AND NOT ('nao-perturbe' = ANY (COALESCE(ct.tags, '{}')));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.followup_enrollments e
  SET status = 'parado', stop_reason = 'Cliente pediu para não receber mensagens'
  FROM public.contacts ct
  WHERE e.contact_id = ct.id AND e.status = 'ativo'
    AND 'nao-perturbe' = ANY (COALESCE(ct.tags, '{}'));

  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.disparo_sweep_optouts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disparo_sweep_optouts() TO service_role;

-- 7. Crons (mesmo padrão dos lembretes: URL e chave vêm de app_config) ----------

CREATE OR REPLACE FUNCTION public.nina_invoke_function(p_name text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_url text; v_key text; v_req_id bigint;
BEGIN
  v_url := public.app_config_get('supabase_url');
  v_key := public.app_config_get('service_role_key');
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE '[nina_invoke_function] app_config incompleta — pulando %', p_name;
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_req_id;
  RETURN v_req_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.nina_invoke_function(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nina_invoke_function(text) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
  WHERE jobname IN ('nina-disparo-processor', 'nina-followup-processor');

  PERFORM cron.schedule('nina-disparo-processor', '* * * * *',
    $job$SELECT public.nina_invoke_function('disparo-processor')$job$);
  PERFORM cron.schedule('nina-followup-processor', '*/5 * * * *',
    $job$SELECT public.nina_invoke_function('followup-processor')$job$);
END $$;

-- 8. Quem entra nas réguas de follow-up ----------------------------------------
-- Chamado pelo followup-processor (service_role). Devolve quantos entraram.

CREATE OR REPLACE FUNCTION public.followup_enroll(p_seq uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s public.followup_sequences;
  v_tz text;
  v_first_delay integer;
  v_count integer := 0;
BEGIN
  SELECT * INTO s FROM public.followup_sequences WHERE id = p_seq AND active;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(timezone, 'America/Sao_Paulo') INTO v_tz FROM public.nina_settings WHERE organization_id = s.organization_id;
  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');
  SELECT delay_hours INTO v_first_delay FROM public.followup_steps WHERE sequence_id = s.id ORDER BY position LIMIT 1;
  IF v_first_delay IS NULL THEN RETURN 0; END IF; -- régua sem passos

  IF s.trigger_type = 'sem_resposta' THEN
    -- Última mensagem da conversa é nossa, está parada há X horas (até 3 dias além disso)
    -- e não foi enviada pelo próprio follow-up
    INSERT INTO public.followup_enrollments (organization_id, sequence_id, contact_id, ref_id, next_run_at)
    SELECT s.organization_id, s.id, cv.contact_id, lm.id::text, now() + make_interval(hours => v_first_delay)
    FROM public.conversations cv
    JOIN public.contacts ct ON ct.id = cv.contact_id
    JOIN LATERAL (
      SELECT m.id, m.from_type, m.sent_at, m.metadata
      FROM public.messages m
      WHERE m.conversation_id = cv.id
      ORDER BY m.sent_at DESC
      LIMIT 1
    ) lm ON true
    WHERE cv.organization_id = s.organization_id
      AND cv.is_active
      AND cv.status <> 'paused'
      AND lm.from_type IN ('nina', 'human')
      AND COALESCE(lm.metadata->>'origem', '') <> 'followup'
      AND lm.sent_at <= now() - make_interval(hours => s.trigger_hours)
      AND lm.sent_at >= now() - make_interval(hours => s.trigger_hours + 72)
      AND lm.sent_at >= s.created_at
      AND COALESCE(ct.is_blocked, false) = false
      AND NOT ('nao-perturbe' = ANY (COALESCE(ct.tags, '{}')))
      AND NOT EXISTS (
        SELECT 1 FROM public.followup_enrollments e
        WHERE e.sequence_id = s.id AND e.contact_id = cv.contact_id AND e.status = 'ativo'
      )
    ON CONFLICT (sequence_id, contact_id, ref_id) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF s.trigger_type = 'apos_agendamento' THEN
    INSERT INTO public.followup_enrollments (organization_id, sequence_id, contact_id, ref_id, next_run_at)
    SELECT s.organization_id, s.id, a.contact_id, a.id::text, now() + make_interval(hours => v_first_delay)
    FROM public.appointments a
    JOIN public.contacts ct ON ct.id = a.contact_id
    WHERE a.organization_id = s.organization_id
      AND a.contact_id IS NOT NULL
      AND COALESCE(a.status, 'scheduled') NOT IN ('cancelled', 'canceled')
      AND ((a.date + a."time") AT TIME ZONE v_tz) + make_interval(hours => s.trigger_hours) <= now()
      AND ((a.date + a."time") AT TIME ZONE v_tz) + make_interval(hours => s.trigger_hours) >= GREATEST(s.created_at, now() - interval '7 days')
      AND COALESCE(ct.is_blocked, false) = false
      AND NOT ('nao-perturbe' = ANY (COALESCE(ct.tags, '{}')))
    ON CONFLICT (sequence_id, contact_id, ref_id) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF s.trigger_type = 'etiqueta' AND nullif(trim(s.trigger_tag), '') IS NOT NULL THEN
    INSERT INTO public.followup_enrollments (organization_id, sequence_id, contact_id, ref_id, next_run_at)
    SELECT s.organization_id, s.id, ct.id, 'etiqueta:' || lower(trim(s.trigger_tag)),
           now() + make_interval(hours => v_first_delay)
    FROM public.contacts ct
    WHERE ct.organization_id = s.organization_id
      AND lower(trim(s.trigger_tag)) = ANY (SELECT lower(x) FROM unnest(COALESCE(ct.tags, '{}')) x)
      AND COALESCE(ct.is_blocked, false) = false
      AND NOT ('nao-perturbe' = ANY (COALESCE(ct.tags, '{}')))
    ON CONFLICT (sequence_id, contact_id, ref_id) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.followup_enroll(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.followup_enroll(uuid) TO service_role;
