-- Teste do rastreamento de anúncios (origem do lead, vendas, relatório, fila
-- da Conversions API). Roda dentro de uma transação e termina com ROLLBACK.
-- Uso (no servidor):
--   psql -v ON_ERROR_STOP=1 -f rastreamento_anuncios.sql

\set QUIET on
\pset tuples_only on
\pset format unaligned

BEGIN;

CREATE TEMP TABLE _t (step int, check_name text, ok boolean, detail text);
GRANT ALL ON _t TO authenticated;

DO $$
DECLARE
  orgA uuid := gen_random_uuid();
  orgB uuid := gen_random_uuid();
  adminA uuid := gen_random_uuid();
  memberA uuid := gen_random_uuid();
  userB uuid := gen_random_uuid();
  ganhoA uuid; etapaA uuid;
  c_ad uuid; c_org uuid; c_old uuid; c_b uuid;
  deal_ad uuid;
  ok_touch boolean;
  r record;
  n int;
  v numeric;
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  INSERT INTO public.organizations (id, name) VALUES (orgA, 'Clínica Anúncios A'), (orgB, 'Clínica Anúncios B');
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
    (adminA, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ads-admin@teste.invalid', '{}'::jsonb, now(), now()),
    (memberA, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ads-membro@teste.invalid', '{}'::jsonb, now(), now()),
    (userB, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ads-b@teste.invalid', '{}'::jsonb, now(), now());
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
    (orgA, adminA, 'admin'), (orgA, memberA, 'member'), (orgB, userB, 'admin');

  INSERT INTO public.pipeline_stages (organization_id, title, color, position) VALUES (orgA, 'Novo', 'border-slate-500', 0) RETURNING id INTO etapaA;
  INSERT INTO public.pipeline_stages (organization_id, title, color, position, is_system) VALUES (orgA, 'Ganho', 'border-emerald-500', 5, true) RETURNING id INTO ganhoA;
  INSERT INTO public.pipeline_stages (organization_id, title, color, position) VALUES (orgB, 'Novo', 'border-slate-500', 0);

  -- ===== origem do lead (webhook = service_role) =====
  INSERT INTO public.contacts (organization_id, phone_number, name) VALUES (orgA, '5511900000001', 'Veio do anúncio') RETURNING id INTO c_ad;
  INSERT INTO public.contacts (organization_id, phone_number, name) VALUES (orgA, '5511900000002', 'Orgânica') RETURNING id INTO c_org;
  INSERT INTO public.contacts (organization_id, phone_number, name, created_at) VALUES (orgA, '5511900000003', 'Antiga', now() - interval '90 days') RETURNING id INTO c_old;
  INSERT INTO public.contacts (organization_id, phone_number, name) VALUES (orgB, '5511900000001', 'Da B') RETURNING id INTO c_b;

  ok_touch := public.record_lead_touch(orgA, c_ad, 'wamid.1', jsonb_build_object(
    'source_id', '120200000000001', 'source_type', 'ad', 'source_url', 'https://fb.me/x',
    'headline', 'Limpeza de pele R$99', 'ctwa_clid', 'CLID-1'), 'meta');
  SELECT * INTO r FROM public.contacts WHERE id = c_ad;
  INSERT INTO _t VALUES (1, 'clique no anúncio grava origem no contato',
    ok_touch AND r.ad_source_id = '120200000000001' AND r.ad_headline = 'Limpeza de pele R$99' AND r.ad_ctwa_clid = 'CLID-1' AND r.ad_first_touch_at IS NOT NULL,
    coalesce(r.ad_source_id, 'sem origem'));

  ok_touch := public.record_lead_touch(orgA, c_ad, 'wamid.1', jsonb_build_object('source_id', '120200000000001', 'ctwa_clid', 'CLID-1'), 'meta');
  SELECT count(*) INTO n FROM public.lead_touches WHERE contact_id = c_ad;
  INSERT INTO _t VALUES (2, 'mesma mensagem reenviada não duplica', NOT ok_touch AND n = 1, n::text);

  PERFORM public.record_lead_touch(orgA, c_ad, 'wamid.2', jsonb_build_object('source_id', '120200000000999', 'headline', 'Outro', 'ctwa_clid', 'CLID-2'), 'meta');
  SELECT * INTO r FROM public.contacts WHERE id = c_ad;
  INSERT INTO _t VALUES (3, '2º anúncio mantém o 1º e atualiza o último clique',
    r.ad_source_id = '120200000000001' AND r.ad_ctwa_clid = 'CLID-2', r.ad_source_id || ' / ' || r.ad_ctwa_clid);

  ok_touch := public.record_lead_touch(orgA, c_b, 'wamid.x', jsonb_build_object('source_id', '1'), 'meta');
  INSERT INTO _t VALUES (4, 'não grava origem em contato de outra clínica', NOT ok_touch, ok_touch::text);

  -- cliente antiga clica num anúncio hoje: conta como lead do anúncio hoje
  PERFORM public.record_lead_touch(orgA, c_old, 'wamid.3', jsonb_build_object('source_id', '120200000000002', 'ctwa_clid', 'CLID-3'), 'meta');

  -- ===== vendas =====
  SELECT id INTO deal_ad FROM public.deals WHERE contact_id = c_ad;
  UPDATE public.deals SET value = 450, won_at = now(), stage_id = ganhoA WHERE id = deal_ad;
  SELECT count(*), sum(value) INTO n, v FROM public.sales WHERE deal_id = deal_ad;
  INSERT INTO _t VALUES (5, 'card em Ganho com valor vira venda', n = 1 AND v = 450, n || ' / ' || coalesce(v::text, '-'));

  UPDATE public.deals SET value = 500 WHERE id = deal_ad;
  SELECT sum(value) INTO v FROM public.sales WHERE deal_id = deal_ad;
  INSERT INTO _t VALUES (6, 'mudar o valor do card atualiza a venda', v = 500, coalesce(v::text, '-'));

  UPDATE public.deals SET won_at = NULL, stage_id = etapaA WHERE id = deal_ad;
  SELECT count(*) INTO n FROM public.sales WHERE deal_id = deal_ad;
  INSERT INTO _t VALUES (7, 'tirar do Ganho apaga a venda', n = 0, n::text);
  UPDATE public.deals SET won_at = now(), stage_id = ganhoA WHERE id = deal_ad;

  INSERT INTO public.appointments (organization_id, title, date, time, contact_id, status) VALUES
    (orgA, 'Avaliação', today, '10:00', c_ad, 'scheduled'),
    (orgA, 'Cancelada', today, '11:00', c_ad, 'cancelled'),
    (orgA, 'Orgânica', today, '12:00', c_org, 'scheduled');

  -- ===== Meta Ads: investimento =====
  INSERT INTO public.meta_ads (organization_id, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name) VALUES
    (orgA, '120200000000001', 'AD01 Limpeza', 'S1', 'Conjunto Mulheres 25-45', 'C1', '[MSG] Limpeza de pele'),
    (orgA, '120200000000003', 'AD03 Sem lead', 'S1', 'Conjunto Mulheres 25-45', 'C1', '[MSG] Limpeza de pele');
  INSERT INTO public.meta_ad_insights_daily (organization_id, ad_id, date, spend, impressions, clicks, conversations) VALUES
    (orgA, '120200000000001', today, 100, 5000, 120, 10),
    (orgA, '120200000000003', today, 30, 900, 10, 0),
    (orgA, '120200000000001', today - 60, 999, 1, 1, 1),
    (orgB, '120200000000001', today, 777, 1, 1, 1);

  -- ===== como membro da clínica A =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', memberA, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO public.sales (contact_id, value, description) VALUES (c_org, 200, 'Botox avulso');
  INSERT INTO _t SELECT 8, 'venda avulsa cai na clínica certa', organization_id = orgA, organization_id::text FROM public.sales WHERE description = 'Botox avulso';

  BEGIN
    INSERT INTO public.sales (contact_id, value) VALUES (c_b, 10);
    INSERT INTO _t VALUES (9, 'não registra venda para cliente de outra clínica', false, 'gravou!');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    INSERT INTO _t VALUES (9, 'não registra venda para cliente de outra clínica', true, SQLERRM);
  END;

  SELECT * INTO r FROM public.ads_report(today - 6, today) x WHERE x.ad_id = '120200000000001';
  INSERT INTO _t VALUES (10, 'relatório: anúncio 1 com investimento, lead, agendamento e venda',
    r.spend = 100 AND r.leads = 1 AND r.appointments = 1 AND r.sales = 1 AND r.revenue = 500
      AND r.campaign_name = '[MSG] Limpeza de pele' AND r.ad_name = 'AD01 Limpeza' AND r.meta_conversations = 10,
    format('gasto %s, leads %s, agend %s, vendas %s, fat %s', r.spend, r.leads, r.appointments, r.sales, r.revenue));

  SELECT * INTO r FROM public.ads_report(today - 6, today) x WHERE x.ad_id IS NULL;
  INSERT INTO _t VALUES (11, 'relatório: linha sem anúncio (orgânico)',
    r.leads = 1 AND r.appointments = 1 AND r.sales = 1 AND r.revenue = 200 AND r.spend = 0,
    format('leads %s, agend %s, vendas %s, fat %s', r.leads, r.appointments, r.sales, r.revenue));

  SELECT * INTO r FROM public.ads_report(today - 6, today) x WHERE x.ad_id = '120200000000002';
  INSERT INTO _t VALUES (12, 'relatório: cliente antiga que clicou hoje conta para o anúncio', r.leads = 1, coalesce(r.leads::text, 'sem linha'));

  SELECT * INTO r FROM public.ads_report(today - 6, today) x WHERE x.ad_id = '120200000000003';
  INSERT INTO _t VALUES (13, 'relatório: anúncio que gastou sem lead aparece', r.spend = 30 AND r.leads = 0, coalesce(r.spend::text, 'sem linha'));

  BEGIN
    SELECT count(*) INTO n FROM public.meta_ads_connections;
    INSERT INTO _t VALUES (14, 'membro não lê a tabela da chave', false, 'leu ' || n);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _t VALUES (14, 'membro não lê a tabela da chave', true, 'bloqueado');
  END;
  RESET ROLE;
END $$;

-- Parte 2: conexão, Conversions API e isolamento
DO $$
DECLARE
  orgA uuid := (SELECT id FROM public.organizations WHERE name = 'Clínica Anúncios A');
  adminA uuid := (SELECT id FROM auth.users WHERE email = 'ads-admin@teste.invalid');
  memberA uuid := (SELECT id FROM auth.users WHERE email = 'ads-membro@teste.invalid');
  userB uuid := (SELECT id FROM auth.users WHERE email = 'ads-b@teste.invalid');
  c_ad uuid := (SELECT id FROM public.contacts WHERE phone_number = '5511900000001' AND organization_id = (SELECT id FROM public.organizations WHERE name = 'Clínica Anúncios A'));
  st jsonb;
  n int;
  r record;
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- membro comum não salva conta de anúncios
  PERFORM set_config('request.jwt.claims', json_build_object('sub', memberA, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.ads_save_connection('1234567890', 'EAAtoken', true);
    INSERT INTO _t VALUES (15, 'membro comum não salva a conta de anúncios', false, 'salvou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _t VALUES (15, 'membro comum não salva a conta de anúncios', true, 'bloqueado');
  END;
  RESET ROLE;

  -- administradora salva; a chave nunca volta para a tela
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adminA, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  st := public.ads_save_connection('act_1234567890', 'EAAtoken-secreto', true);
  INSERT INTO _t VALUES (16, 'admin salva conta (tira o act_) e a chave não aparece',
    st->>'ad_account_id' = '1234567890' AND (st->>'has_token')::boolean AND st::text NOT LIKE '%secreto%', st::text);

  st := public.ads_save_connection('1234567890', '', true);
  INSERT INTO _t VALUES (17, 'salvar com chave vazia mantém a chave', (st->>'has_token')::boolean, st->>'has_token');

  BEGIN
    PERFORM public.ads_save_connection('abc', NULL, NULL);
    INSERT INTO _t VALUES (18, 'conta de anúncios inválida é recusada', false, 'aceitou!');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _t VALUES (18, 'conta de anúncios inválida é recusada', true, SQLERRM);
  END;

  -- com a devolução ligada, venda de cliente de anúncio entra na fila com o último ctwa_clid
  INSERT INTO public.sales (contact_id, value, description) VALUES (c_ad, 300, 'Pacote 3 sessões');
  RESET ROLE;
  SELECT * INTO r FROM public.meta_conversion_events e JOIN public.sales s ON s.id = e.sale_id WHERE s.description = 'Pacote 3 sessões';
  INSERT INTO _t VALUES (19, 'venda de cliente de anúncio entra na fila da Meta',
    r.ctwa_clid = 'CLID-2' AND r.value = 300 AND r.status = 'pending', coalesce(r.ctwa_clid, 'fora da fila'));

  SELECT count(*) INTO n FROM public.meta_conversion_events e JOIN public.sales s ON s.id = e.sale_id WHERE s.description = 'Botox avulso';
  INSERT INTO _t VALUES (20, 'venda de cliente orgânica não vai para a Meta', n = 0, n::text);

  -- clínica B não vê nada da A
  PERFORM set_config('request.jwt.claims', json_build_object('sub', userB, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.sales;
  INSERT INTO _t VALUES (21, 'B não vê vendas da A', n = 0, n::text);
  SELECT count(*) INTO n FROM public.lead_touches;
  INSERT INTO _t VALUES (22, 'B não vê origem dos leads da A', n = 0, n::text);
  SELECT * INTO r FROM public.ads_report(today - 6, today) x WHERE x.ad_id = '120200000000001';
  INSERT INTO _t VALUES (23, 'relatório da B só tem o gasto da B', r.spend = 777 AND r.leads = 0, coalesce(r.spend::text, 'sem linha'));
  st := public.ads_connection_status();
  INSERT INTO _t VALUES (24, 'B não vê a conexão da A', st->>'ad_account_id' IS NULL, st::text);
  RESET ROLE;
END $$;

SELECT step || '. ' || CASE WHEN ok THEN 'OK   ' ELSE 'FALHA' END || ' ' || check_name || ' (' || detail || ')' FROM _t ORDER BY step;
SELECT 'RESUMO: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' ok' FROM _t;

ROLLBACK;
