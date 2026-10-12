-- Teste das agências (white label etapa 2). Rode dentro de BEGIN ... ROLLBACK.

\set QUIET on
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE _ag (step int, check_name text, ok boolean, detail text);
GRANT ALL ON _ag TO authenticated;

DO $$
DECLARE
  owner_id uuid := (SELECT user_id FROM public.profiles WHERE is_platform_owner LIMIT 1);
  ag1 uuid := gen_random_uuid();
  ag2 uuid := gen_random_uuid();
  ag_user uuid := gen_random_uuid();
  ag2_user uuid := gen_random_uuid();
  clinic_user uuid := gen_random_uuid();
  org_a uuid := gen_random_uuid();   -- clínica da agência 1
  org_b uuid := gen_random_uuid();   -- clínica da agência 2
  org_d uuid := gen_random_uuid();   -- clínica direta do dono
  js jsonb; n int; st text; charge uuid; total numeric;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
    (ag_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agencia1@teste.invalid', '{}'::jsonb, now(), now()),
    (ag2_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agencia2@teste.invalid', '{}'::jsonb, now(), now()),
    (clinic_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clinica-ag@teste.invalid', '{}'::jsonb, now(), now());
  INSERT INTO public.agencies (id, name, fee_per_clinic) VALUES (ag1, 'Agência Um', 99), (ag2, 'Agência Dois', NULL);
  INSERT INTO public.agency_members (agency_id, user_id) VALUES (ag1, ag_user), (ag2, ag2_user);
  INSERT INTO public.organizations (id, name, agency_id, monthly_fee) VALUES
    (org_a, 'Clínica da Agência Um', ag1, 300), (org_b, 'Clínica da Agência Dois', ag2, 250), (org_d, 'Clínica Direta Teste', NULL, 400);
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_a, clinic_user, 'admin');
  INSERT INTO public.nina_settings (organization_id, company_name, sdr_name, whatsapp_verify_token) VALUES
    (org_a, 'Clínica da Agência Um', 'Assistente', 'ag-teste-a'), (org_b, 'Clínica da Agência Dois', 'Assistente', 'ag-teste-b');
  INSERT INTO public.organization_billing_charges (organization_id, due_date, amount) VALUES
    (org_a, public.today_sp() - 3, 300), (org_d, public.today_sp() + 10, 400);

  -- ===== agência 1 =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ag_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT name INTO st FROM public.my_agency();
  INSERT INTO _ag VALUES (1, 'agência se reconhece', st = 'Agência Um', st);

  SELECT string_agg(name, ',' ORDER BY name) INTO st FROM public.owner_organizations_overview();
  INSERT INTO _ag VALUES (2, 'agência só vê as clínicas dela', st = 'Clínica da Agência Um', st);

  js := public.owner_organization_detail(org_a);
  INSERT INTO _ag VALUES (3, 'agência abre a clínica dela sem custo de IA',
    js->'organization'->>'name' = 'Clínica da Agência Um' AND NOT (js->'usage_30d' ? 'ai_cost_usd') AND NOT (js->'usage_30d' ? 'ai_tokens'),
    js->'usage_30d'::text);

  BEGIN
    PERFORM public.owner_organization_detail(org_b);
    INSERT INTO _ag VALUES (4, 'agência não abre clínica de outra agência', false, 'abriu!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _ag VALUES (4, 'agência não abre clínica de outra agência', true, 'bloqueado');
  END;
  BEGIN
    PERFORM public.owner_get_clinic_config(org_d);
    INSERT INTO _ag VALUES (5, 'agência não lê config de clínica direta', false, 'leu!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _ag VALUES (5, 'agência não lê config de clínica direta', true, 'bloqueado');
  END;

  PERFORM public.owner_update_clinic_hours(org_a, '08:00', '17:00', ARRAY[1,2,3]);
  charge := public.owner_create_charge(org_a, public.today_sp() + 30, 300, 'Novembro');
  PERFORM public.owner_mark_charge_paid(charge, NULL, 'Pix');
  SELECT count(*) INTO n FROM public.owner_list_charges(NULL);
  INSERT INTO _ag VALUES (6, 'agência configura e cobra a clínica dela', n = 2, n || ' cobranças');

  BEGIN
    PERFORM public.owner_cancel_charge((SELECT id FROM public.organization_billing_charges WHERE organization_id = org_d LIMIT 1));
    INSERT INTO _ag VALUES (7, 'agência não mexe em cobrança de outra clínica', false, 'cancelou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _ag VALUES (7, 'agência não mexe em cobrança de outra clínica', true, 'bloqueado');
  END;

  BEGIN
    PERFORM public.owner_ai_usage(30);
    INSERT INTO _ag VALUES (8, 'agência não vê consumo de IA', false, 'viu!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _ag VALUES (8, 'agência não vê consumo de IA', true, 'bloqueado');
  END;
  BEGIN
    PERFORM public.owner_agencies_overview();
    INSERT INTO _ag VALUES (9, 'agência não vê outras agências', false, 'viu!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _ag VALUES (9, 'agência não vê outras agências', true, 'bloqueado');
  END;

  js := public.agency_dashboard_summary();
  INSERT INTO _ag VALUES (10, 'resumo da agência', (js->>'clinics_active')::int = 1 AND (js->>'fee_per_clinic')::numeric = 99
    AND (js->>'overdue_count')::int = 1 AND NOT js ? 'ai_cost_month_usd', js::text);

  SELECT count(*) INTO n FROM public.owner_alerts() a WHERE a.organization_id <> org_a;
  INSERT INTO _ag VALUES (11, 'alertas só das clínicas dela', n = 0, n || ' de fora');

  BEGIN
    PERFORM count(*) FROM public.agencies;
    INSERT INTO _ag VALUES (12, 'tabela de agências fechada', false, 'leu!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _ag VALUES (12, 'tabela de agências fechada', true, 'bloqueado');
  END;
  RESET ROLE;

  -- ===== admin da clínica (não é agência) =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', clinic_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.owner_organizations_overview();
    INSERT INTO _ag VALUES (13, 'clínica não usa funções de gestão', false, 'usou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _ag VALUES (13, 'clínica não usa funções de gestão', true, 'bloqueado');
  END;
  RESET ROLE;

  -- ===== dono =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.owner_organizations_overview() o WHERE o.id IN (org_a, org_b, org_d);
  INSERT INTO _ag VALUES (14, 'dono vê clínicas de todas as agências', n = 3, n || ' clínicas');
  js := public.owner_organization_detail(org_a);
  INSERT INTO _ag VALUES (15, 'dono vê custo de IA e a agência da clínica',
    js->'usage_30d' ? 'ai_cost_usd' AND js->'organization'->>'agency_name' = 'Agência Um', js->'organization'->>'agency_name');
  PERFORM public.owner_update_clinic_hours(org_a, '09:00', '18:00', ARRAY[1,2,3,4,5]);
  INSERT INTO _ag VALUES (16, 'dono configura clínica de agência (suporte)', true, 'ok');

  SELECT count(*) INTO n FROM public.owner_list_charges(NULL) c WHERE c.organization_id = org_a;
  INSERT INTO _ag VALUES (17, 'cobranças da agência não entram no financeiro do dono', n = 0, n || ' na lista');

  SELECT x.monthly_total INTO total FROM public.owner_agencies_overview() x WHERE x.id = ag1;
  INSERT INTO _ag VALUES (18, 'fatura da agência = clínicas ativas x valor', total = 99, total::text);
  SELECT monthly_total IS NULL INTO STRICT st FROM public.owner_agencies_overview() x WHERE x.id = ag2;
  INSERT INTO _ag VALUES (19, 'agência sem valor combinado fica em branco', st::boolean, st);

  PERFORM public.owner_update_agency(ag2, 'Agência Dois', 79, 'Ana', NULL, NULL);
  PERFORM public.owner_set_agency_status(ag1, 'suspended');
  RESET ROLE;

  -- ===== agência suspensa perde o painel =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ag_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.owner_organizations_overview();
    INSERT INTO _ag VALUES (20, 'agência suspensa sem acesso', false, 'entrou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _ag VALUES (20, 'agência suspensa sem acesso', true, 'bloqueado');
  END;
  SELECT status INTO st FROM public.my_agency();
  INSERT INTO _ag VALUES (21, 'painel sabe que a agência está suspensa', st = 'suspended', st);
  RESET ROLE;

  SELECT count(*) INTO n FROM public.owner_audit_log WHERE agency_id IN (ag1, ag2);
  INSERT INTO _ag VALUES (22, 'histórico registra ações sobre agências', n = 2, n || ' registros');
END $$;

SELECT step || '. ' || CASE WHEN ok THEN 'OK   ' ELSE 'FALHA' END || ' ' || check_name || ' (' || detail || ')' FROM _ag ORDER BY step;
SELECT 'RESUMO: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' ok' FROM _ag;
