-- Teste de cobrança, consumo de IA e alertas do Painel do Dono.
-- Rode dentro de BEGIN ... ROLLBACK (nada fica gravado).

\set QUIET on
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE _b (step int, check_name text, ok boolean, detail text);
GRANT ALL ON _b TO authenticated;

DO $$
DECLARE
  owner_id uuid := (SELECT user_id FROM public.profiles WHERE is_platform_owner LIMIT 1);
  org2 uuid := gen_random_uuid();
  user2 uuid := gen_random_uuid();
  ch_overdue uuid; ch_soon uuid; n int; js jsonb; st text; v numeric;
BEGIN
  INSERT INTO public.organizations (id, name, monthly_fee) VALUES (org2, 'Clínica Teste B', 397);
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (user2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cobranca-teste@teste.invalid', '{}'::jsonb, now(), now());
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org2, user2, 'admin');
  INSERT INTO public.ai_usage_events (organization_id, kind, model, prompt_tokens, completion_tokens)
  VALUES (org2, 'chat', 'gemini-2.5-flash', 1000000, 100000);

  -- ===== clínica comum =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.owner_list_charges(NULL);
    INSERT INTO _b VALUES (1, 'clínica não lê cobranças', false, 'leu!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _b VALUES (1, 'clínica não lê cobranças', true, 'bloqueado');
  END;
  BEGIN
    PERFORM count(*) FROM public.organization_billing_charges;
    INSERT INTO _b VALUES (2, 'tabela de cobranças fechada', false, 'leu!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _b VALUES (2, 'tabela de cobranças fechada', true, 'bloqueado');
  END;
  BEGIN
    PERFORM public.owner_create_charge(org2, public.today_sp(), 1);
    INSERT INTO _b VALUES (3, 'clínica não cria cobrança', false, 'criou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _b VALUES (3, 'clínica não cria cobrança', true, 'bloqueado');
  END;
  RESET ROLE;

  -- ===== dono =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  ch_overdue := public.owner_create_charge(org2, public.today_sp() - 3, 397, 'outubro');
  ch_soon := public.owner_create_charge(org2, public.today_sp() + 2, 397, 'novembro');
  SELECT billing_state INTO st FROM public.owner_organizations_overview() WHERE id = org2;
  INSERT INTO _b VALUES (4, 'clínica com cobrança vencida fica atrasada', st = 'overdue', st);

  SELECT count(*) INTO n FROM public.owner_alerts() WHERE organization_id = org2 AND kind IN ('billing_overdue', 'billing_due_soon');
  INSERT INTO _b VALUES (5, 'alertas de atraso e vencimento próximo', n = 2, n::text);
  SELECT detail INTO st FROM public.owner_alerts() WHERE organization_id = org2 AND kind = 'billing_overdue';
  INSERT INTO _b VALUES (6, 'valor em reais no alerta', st LIKE 'R$ 397,00%', st);

  PERFORM public.owner_mark_charge_paid(ch_overdue, NULL, 'Pix');
  SELECT billing_state INTO st FROM public.owner_organizations_overview() WHERE id = org2;
  INSERT INTO _b VALUES (7, 'depois de pagar sai do atraso', st = 'due_soon', st);

  js := public.owner_dashboard_summary();
  INSERT INTO _b VALUES (8, 'recebido no mês soma o pagamento', (js->>'received_month')::numeric >= 397, js->>'received_month');

  PERFORM public.owner_cancel_charge(ch_soon);
  SELECT display_status INTO st FROM public.owner_list_charges(org2) WHERE id = ch_soon;
  INSERT INTO _b VALUES (9, 'cobrança cancelada', st = 'canceled', st);

  BEGIN
    PERFORM public.owner_mark_charge_paid(ch_soon, NULL, NULL);
    INSERT INTO _b VALUES (10, 'não paga cobrança cancelada', false, 'pagou!');
  EXCEPTION WHEN no_data_found THEN
    INSERT INTO _b VALUES (10, 'não paga cobrança cancelada', true, 'recusado');
  END;

  js := public.owner_ai_usage(30);
  SELECT (x->>'cost_usd')::numeric INTO v FROM jsonb_array_elements(js->'by_organization') x WHERE x->>'id' = org2::text;
  INSERT INTO _b VALUES (11, 'custo IA: 1M entrada + 100k saída no flash = US$ 0,55', round(v, 2) = 0.55, v::text);

  PERFORM public.owner_update_organization(org2, 'Clínica Teste B Renomeada', 450, 'Ana', '11999990000', NULL);
  js := public.owner_organization_detail(org2);
  INSERT INTO _b VALUES (12, 'edita nome e mensalidade', js->'organization'->>'name' = 'Clínica Teste B Renomeada' AND (js->'organization'->>'monthly_fee')::numeric = 450, js->'organization'->>'name');

  BEGIN
    PERFORM public.owner_create_charge(org2, public.today_sp(), 0);
    INSERT INTO _b VALUES (13, 'recusa cobrança de valor zero', false, 'criou!');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _b VALUES (13, 'recusa cobrança de valor zero', true, SQLERRM);
  END;
  RESET ROLE;
END $$;

SELECT step || '. ' || CASE WHEN ok THEN 'OK   ' ELSE 'FALHA' END || ' ' || check_name || ' (' || detail || ')' FROM _b ORDER BY step;
SELECT 'RESUMO: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' ok' FROM _b;
