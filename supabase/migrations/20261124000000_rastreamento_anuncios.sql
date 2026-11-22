-- RASTREAMENTO DE ANÚNCIOS: qual anúncio gera lead, agendamento, venda e faturamento.
--
-- 1. Origem do lead: na 1ª mensagem depois do clique num anúncio de clique
--    para o WhatsApp, a Meta manda o objeto "referral" (id do anúncio, título,
--    link, ctwa_clid). Cada clique vira uma linha em lead_touches; o contato
--    guarda o 1º anúncio (atribuição) e o último ctwa_clid (devolver a venda).
-- 2. Vendas: tabela sales. O card "Ganho" do funil com valor cria a venda
--    sozinho; o botão "Registrar venda" do Atendimento cria vendas avulsas.
-- 3. Meta Ads (só leitura): conta de anúncios + chave da clínica, nomes de
--    campanha/conjunto/anúncio e investimento por dia (função meta-ads-sync).
-- 4. Devolver a venda para a Meta (Conversions API): fila desligada por padrão.
-- 5. Relatório ads_report(de, até) para a tela "Anúncios".

-- 1. Origem do lead -------------------------------------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS ad_source_id text,
  ADD COLUMN IF NOT EXISTS ad_source_type text,
  ADD COLUMN IF NOT EXISTS ad_headline text,
  ADD COLUMN IF NOT EXISTS ad_source_url text,
  ADD COLUMN IF NOT EXISTS ad_first_touch_at timestamptz,
  ADD COLUMN IF NOT EXISTS ad_last_touch_at timestamptz,
  ADD COLUMN IF NOT EXISTS ad_ctwa_clid text;

CREATE INDEX IF NOT EXISTS contacts_org_ad_source_idx
  ON public.contacts (organization_id, ad_source_id) WHERE ad_source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lead_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'meta' CHECK (channel IN ('meta', 'evolution')),
  whatsapp_message_id text,
  source_type text,
  source_id text,
  source_url text,
  headline text,
  body text,
  media_type text,
  ctwa_clid text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, whatsapp_message_id)
);
CREATE INDEX IF NOT EXISTS lead_touches_contact_idx ON public.lead_touches (contact_id);

ALTER TABLE public.lead_touches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clinic members read own touches" ON public.lead_touches;
CREATE POLICY "Clinic members read own touches" ON public.lead_touches
  FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
REVOKE INSERT, UPDATE, DELETE ON public.lead_touches FROM anon, authenticated;

-- Chamado pelos webhooks (service_role) quando a mensagem traz origem de anúncio.
-- p_referral = objeto "referral" da Meta (source_id, source_type, source_url,
-- headline, body, media_type, ctwa_clid).
CREATE OR REPLACE FUNCTION public.record_lead_touch(
  p_org uuid, p_contact uuid, p_message_id text, p_referral jsonb, p_channel text DEFAULT 'meta'
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_source text := nullif(trim(p_referral->>'source_id'), '');
  v_clid text := nullif(trim(p_referral->>'ctwa_clid'), '');
  v_rows integer;
BEGIN
  IF p_referral IS NULL OR (v_source IS NULL AND v_clid IS NULL) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact AND organization_id = p_org) THEN
    RETURN false;
  END IF;

  INSERT INTO public.lead_touches (
    organization_id, contact_id, channel, whatsapp_message_id, source_type, source_id,
    source_url, headline, body, media_type, ctwa_clid
  ) VALUES (
    p_org, p_contact, COALESCE(p_channel, 'meta'), nullif(p_message_id, ''),
    nullif(p_referral->>'source_type', ''), v_source, nullif(p_referral->>'source_url', ''),
    left(nullif(p_referral->>'headline', ''), 300), left(nullif(p_referral->>'body', ''), 1000),
    nullif(p_referral->>'media_type', ''), v_clid
  )
  ON CONFLICT (organization_id, whatsapp_message_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN false; -- mesma mensagem reenviada pela Meta
  END IF;

  UPDATE public.contacts SET
    -- 1º anúncio fica para sempre (é ele que trouxe a cliente)
    ad_source_id = COALESCE(ad_source_id, v_source),
    ad_source_type = CASE WHEN ad_source_id IS NULL THEN nullif(p_referral->>'source_type', '') ELSE ad_source_type END,
    ad_headline = CASE WHEN ad_source_id IS NULL THEN left(nullif(p_referral->>'headline', ''), 300) ELSE ad_headline END,
    ad_source_url = CASE WHEN ad_source_id IS NULL THEN nullif(p_referral->>'source_url', '') ELSE ad_source_url END,
    ad_first_touch_at = CASE WHEN ad_source_id IS NULL AND v_source IS NOT NULL THEN now() ELSE ad_first_touch_at END,
    -- último clique: usado para devolver a venda para a Meta
    ad_last_touch_at = now(),
    ad_ctwa_clid = COALESCE(v_clid, ad_ctwa_clid)
  WHERE id = p_contact;

  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_lead_touch(uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_lead_touch(uuid, uuid, text, jsonb, text) TO service_role;

-- 2. Vendas ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  deal_id uuid UNIQUE REFERENCES public.deals(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  value numeric(12,2) NOT NULL CHECK (value > 0),
  description text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'funil')),
  sold_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_org_sold_idx ON public.sales (organization_id, sold_at);
CREATE INDEX IF NOT EXISTS sales_contact_idx ON public.sales (contact_id);

CREATE OR REPLACE FUNCTION public.sales_set_org()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.contact_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id FROM public.contacts WHERE id = NEW.contact_id;
  END IF;
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := public.current_org_id();
  END IF;
  -- venda de outra clínica não entra (contato precisa ser da mesma clínica)
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contacts WHERE id = NEW.contact_id AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'Cliente não pertence a esta clínica' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sales_set_org ON public.sales;
CREATE TRIGGER sales_set_org BEFORE INSERT OR UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sales_set_org();

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clinic members manage own sales" ON public.sales;
CREATE POLICY "Clinic members manage own sales" ON public.sales
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- Card do funil em "Ganho" com valor = venda. Saiu do Ganho ou valor zerado = some.
CREATE OR REPLACE FUNCTION public.sync_sale_from_deal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.won_at IS NOT NULL AND COALESCE(NEW.value, 0) > 0 THEN
    INSERT INTO public.sales (organization_id, contact_id, deal_id, value, description, source, sold_at, created_by)
    VALUES (NEW.organization_id, NEW.contact_id, NEW.id, NEW.value, NEW.title, 'funil', NEW.won_at, auth.uid())
    ON CONFLICT (deal_id) DO UPDATE
      SET value = EXCLUDED.value, sold_at = EXCLUDED.sold_at, contact_id = EXCLUDED.contact_id;
  ELSE
    DELETE FROM public.sales WHERE deal_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_sale_from_deal ON public.deals;
CREATE TRIGGER sync_sale_from_deal AFTER INSERT OR UPDATE OF won_at, value, contact_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.sync_sale_from_deal();

-- Cards que já estão em "Ganho" com valor viram vendas
INSERT INTO public.sales (organization_id, contact_id, deal_id, value, description, source, sold_at, created_by)
SELECT d.organization_id, d.contact_id, d.id, d.value, d.title, 'funil', d.won_at, NULL
FROM public.deals d
WHERE d.won_at IS NOT NULL AND COALESCE(d.value, 0) > 0
ON CONFLICT (deal_id) DO NOTHING;

-- 3. Meta Ads (só leitura) --------------------------------------------------------

-- Segredos: só o servidor lê (sem policy para authenticated)
CREATE TABLE IF NOT EXISTS public.meta_ads_connections (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  ad_account_id text,
  access_token text,
  capi_enabled boolean NOT NULL DEFAULT false,
  capi_dataset_id text,
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_ads_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ads_connections FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.meta_ads (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ad_id text NOT NULL,
  ad_name text,
  adset_id text,
  adset_name text,
  campaign_id text,
  campaign_name text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, ad_id)
);

CREATE TABLE IF NOT EXISTS public.meta_ad_insights_daily (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ad_id text NOT NULL,
  date date NOT NULL,
  spend numeric(12,2) NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  conversations bigint NOT NULL DEFAULT 0, -- "conversas iniciadas" segundo a Meta
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, ad_id, date)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meta_ads', 'meta_ad_insights_daily'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Clinic members read own ads" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Clinic members read own ads" ON public.%I FOR SELECT TO authenticated USING (organization_id = public.current_org_id())', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- Situação da conexão (sem mostrar a chave)
CREATE OR REPLACE FUNCTION public.ads_connection_status()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'ad_account_id', c.ad_account_id,
    'has_token', c.access_token IS NOT NULL,
    'capi_enabled', COALESCE(c.capi_enabled, false),
    'capi_dataset_id', c.capi_dataset_id,
    'last_sync_at', c.last_sync_at,
    'last_sync_error', c.last_sync_error,
    'has_ctwa_whatsapp', EXISTS (
      SELECT 1 FROM public.nina_settings s
      WHERE s.organization_id = public.current_org_id() AND s.whatsapp_business_account_id IS NOT NULL
    )
  )
  FROM (SELECT public.current_org_id() AS id) o
  LEFT JOIN public.meta_ads_connections c ON c.organization_id = o.id
  WHERE o.id IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.ads_connection_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ads_connection_status() TO authenticated, service_role;

-- Salvar conta e chave (só administradora da clínica). Chave vazia = manter a atual.
CREATE OR REPLACE FUNCTION public.ads_save_connection(
  p_ad_account_id text, p_access_token text DEFAULT NULL, p_capi_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_acc text := regexp_replace(COALESCE(trim(p_ad_account_id), ''), '^act_', '');
BEGIN
  IF v_org IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Só a administradora da clínica pode mudar a conta de anúncios' USING ERRCODE = '42501';
  END IF;
  IF v_acc <> '' AND v_acc !~ '^[0-9]{5,25}$' THEN
    RAISE EXCEPTION 'ID da conta de anúncios inválido: use só os números (ex.: 1234567890)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.meta_ads_connections (organization_id, ad_account_id, access_token, capi_enabled)
  VALUES (v_org, nullif(v_acc, ''), nullif(trim(p_access_token), ''), COALESCE(p_capi_enabled, false))
  ON CONFLICT (organization_id) DO UPDATE SET
    ad_account_id = nullif(v_acc, ''),
    access_token = COALESCE(nullif(trim(p_access_token), ''), meta_ads_connections.access_token),
    capi_enabled = COALESCE(p_capi_enabled, meta_ads_connections.capi_enabled),
    last_sync_error = CASE WHEN nullif(trim(p_access_token), '') IS NOT NULL THEN NULL ELSE meta_ads_connections.last_sync_error END,
    updated_at = now();

  RETURN public.ads_connection_status();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ads_save_connection(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ads_save_connection(text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.ads_disconnect()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.current_org_id() IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Só a administradora da clínica pode desconectar' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.meta_ads_connections WHERE organization_id = public.current_org_id();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ads_disconnect() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ads_disconnect() TO authenticated;

-- 4. Devolver a venda para a Meta (Conversions API) ------------------------------
-- Só entra na fila se a clínica ligou a opção e a cliente veio de anúncio
-- (tem ctwa_clid). Quem envia é a função meta-ads-sync.

CREATE TABLE IF NOT EXISTS public.meta_conversion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid UNIQUE REFERENCES public.sales(id) ON DELETE CASCADE,
  event_name text NOT NULL DEFAULT 'Purchase',
  value numeric(12,2),
  currency text NOT NULL DEFAULT 'BRL',
  ctwa_clid text NOT NULL,
  event_time timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meta_conversion_events_pending_idx
  ON public.meta_conversion_events (organization_id) WHERE status = 'pending';
ALTER TABLE public.meta_conversion_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clinic members read own conversions" ON public.meta_conversion_events;
CREATE POLICY "Clinic members read own conversions" ON public.meta_conversion_events
  FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
REVOKE INSERT, UPDATE, DELETE ON public.meta_conversion_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.queue_sale_conversion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_clid text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.meta_ads_connections
    WHERE organization_id = NEW.organization_id AND capi_enabled
  ) THEN
    RETURN NEW;
  END IF;
  SELECT ad_ctwa_clid INTO v_clid FROM public.contacts WHERE id = NEW.contact_id;
  IF v_clid IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.meta_conversion_events (organization_id, sale_id, value, ctwa_clid, event_time)
  VALUES (NEW.organization_id, NEW.id, NEW.value, v_clid, NEW.sold_at)
  ON CONFLICT (sale_id) DO UPDATE SET value = EXCLUDED.value
    WHERE meta_conversion_events.status <> 'sent';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS queue_sale_conversion ON public.sales;
CREATE TRIGGER queue_sale_conversion AFTER INSERT OR UPDATE OF value ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.queue_sale_conversion();

-- 5. Relatório por anúncio ----------------------------------------------------------
-- Uma linha por anúncio (ad_id) + uma linha sem anúncio (ad_id NULL = orgânico
-- ou origem desconhecida). Datas no fuso de São Paulo. Eventos do período:
--   leads         = clientes que chegaram no período (1º clique no anúncio)
--   agendamentos  = agendamentos criados no período (menos cancelados)
--   vendas        = vendas do período (funil "Ganho" com valor + vendas avulsas)
-- Cada evento é atribuído ao 1º anúncio que trouxe a cliente.

CREATE OR REPLACE FUNCTION public.ads_report(p_from date, p_to date)
RETURNS TABLE (
  ad_id text,
  ad_name text,
  adset_id text,
  adset_name text,
  campaign_id text,
  campaign_name text,
  headline text,
  spend numeric,
  impressions bigint,
  clicks bigint,
  meta_conversations bigint,
  leads bigint,
  appointments bigint,
  sales bigint,
  revenue numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  tz constant text := 'America/Sao_Paulo';
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Usuário sem clínica' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH c AS (
    SELECT ct.id, ct.ad_source_id AS k, ct.ad_headline,
           (COALESCE(ct.ad_first_touch_at, ct.created_at) AT TIME ZONE tz)::date AS lead_day
    FROM public.contacts ct
    WHERE ct.organization_id = v_org
  ),
  l AS (
    SELECT c.k, count(*)::bigint AS n FROM c WHERE c.lead_day BETWEEN p_from AND p_to GROUP BY c.k
  ),
  a AS (
    SELECT c.k, count(*)::bigint AS n
    FROM public.appointments ap JOIN c ON c.id = ap.contact_id
    WHERE ap.organization_id = v_org
      AND lower(COALESCE(ap.status, '')) NOT IN ('cancelled', 'canceled', 'cancelado', 'cancelada')
      AND (ap.created_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to
    GROUP BY c.k
  ),
  s AS (
    SELECT c.k, count(*)::bigint AS n, sum(sl.value) AS total
    FROM public.sales sl JOIN c ON c.id = sl.contact_id
    WHERE sl.organization_id = v_org
      AND (sl.sold_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to
    GROUP BY c.k
  ),
  i AS (
    SELECT d.ad_id AS k, sum(d.spend) AS spend, sum(d.impressions)::bigint AS impressions,
           sum(d.clicks)::bigint AS clicks, sum(d.conversations)::bigint AS conversations
    FROM public.meta_ad_insights_daily d
    WHERE d.organization_id = v_org AND d.date BETWEEN p_from AND p_to
    GROUP BY d.ad_id
  ),
  h AS (
    SELECT c.k, max(c.ad_headline) AS headline FROM c WHERE c.k IS NOT NULL GROUP BY c.k
  ),
  keys AS (
    SELECT l.k FROM l UNION SELECT a.k FROM a UNION SELECT s.k FROM s UNION SELECT i.k FROM i
  )
  SELECT keys.k, m.ad_name, m.adset_id, m.adset_name, m.campaign_id, m.campaign_name, h.headline,
         COALESCE(i.spend, 0), COALESCE(i.impressions, 0), COALESCE(i.clicks, 0), COALESCE(i.conversations, 0),
         COALESCE(l.n, 0), COALESCE(a.n, 0), COALESCE(s.n, 0), COALESCE(s.total, 0)
  FROM keys
  LEFT JOIN l ON l.k IS NOT DISTINCT FROM keys.k
  LEFT JOIN a ON a.k IS NOT DISTINCT FROM keys.k
  LEFT JOIN s ON s.k IS NOT DISTINCT FROM keys.k
  LEFT JOIN i ON i.k IS NOT DISTINCT FROM keys.k
  LEFT JOIN h ON h.k = keys.k
  LEFT JOIN public.meta_ads m ON m.organization_id = v_org AND m.ad_id = keys.k
  ORDER BY COALESCE(s.total, 0) DESC, COALESCE(i.spend, 0) DESC, COALESCE(l.n, 0) DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ads_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ads_report(date, date) TO authenticated, service_role;

-- 6. Cron: busca investimento e envia conversões a cada hora ---------------------------

DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'nina-meta-ads-sync';
  PERFORM cron.schedule('nina-meta-ads-sync', '17 * * * *',
    $job$SELECT public.nina_invoke_function('meta-ads-sync')$job$);
END $$;
