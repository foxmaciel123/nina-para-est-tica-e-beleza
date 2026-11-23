-- Teste do tipo de negócio (nicho), logo da empresa e pedidos.
-- Rode dentro de BEGIN ... ROLLBACK (nada fica gravado):
--   psql -v ON_ERROR_STOP=1 -c 'BEGIN' -f nichos_negocio.sql -c 'ROLLBACK'

\set QUIET on
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE _n (step int, check_name text, ok boolean, detail text);
GRANT ALL ON _n TO authenticated, anon;

DO $$
DECLARE
  org1 uuid := gen_random_uuid();
  org2 uuid := gen_random_uuid();
  admin1 uuid := gen_random_uuid();
  agent1 uuid := gen_random_uuid();
  admin2 uuid := gen_random_uuid();
  stage_ids uuid[];
  team_recepcao uuid; team_proc uuid; func_gestora uuid;
  contact1 uuid;
  cfg jsonb := jsonb_build_object(
    'stages', jsonb_build_array(
      jsonb_build_object('title', 'Novo Pedido', 'color', 'border-orange-500', 'is_ai_managed', false),
      jsonb_build_object('title', 'Montando Pedido', 'color', 'border-amber-500', 'is_ai_managed', true),
      jsonb_build_object('title', 'Aguardando Pagamento', 'color', 'border-violet-500', 'is_ai_managed', true),
      jsonb_build_object('title', 'Saiu para Entrega', 'color', 'border-sky-500', 'is_ai_managed', false),
      jsonb_build_object('title', 'Etapa Extra', 'color', 'border-teal-500', 'is_ai_managed', false)),
    'tags', jsonb_build_array(
      jsonb_build_object('key', 'hot_lead', 'label', 'Pronto pra pedir'),
      jsonb_build_object('key', 'warm_lead', 'label', 'Olhando o cardápio')),
    'teams', jsonb_build_array(jsonb_build_object('name', 'Cozinha', 'description', 'Preparo')),
    'functions', jsonb_build_array(jsonb_build_object('name', 'Atendente', 'description', 'Anota pedidos'))
  );
  js jsonb; n int; t text; num1 int; num2 int; tot numeric; o1 uuid;
BEGIN
  INSERT INTO public.organizations (id, name) VALUES (org1, 'Empresa Nicho A'), (org2, 'Empresa Nicho B');
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
    (admin1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nicho-admin1@teste.invalid', '{}'::jsonb, now(), now()),
    (agent1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nicho-agent1@teste.invalid', '{}'::jsonb, now(), now()),
    (admin2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nicho-admin2@teste.invalid', '{}'::jsonb, now(), now());
  DELETE FROM public.organization_members WHERE user_id IN (admin1, agent1, admin2);
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
    (org1, admin1, 'admin'), (org1, agent1, 'member'), (org2, admin2, 'admin');

  -- Configuração de fábrica (igual ao seedClinicDefaults)
  INSERT INTO public.nina_settings (organization_id, company_name, sdr_name, system_prompt_override)
  VALUES (org1, 'Empresa A', 'Bia', 'PROMPT ANTIGO'), (org2, 'Empresa B', 'Lia', NULL);
  INSERT INTO public.pipeline_stages (organization_id, title, color, position, is_system, is_ai_managed) VALUES
    (org1, 'Novas Interessadas', 'border-pink-500', 0, false, false),
    (org1, 'Avaliação Agendada', 'border-rose-500', 1, false, true),
    (org1, 'Pós-avaliação', 'border-fuchsia-500', 2, false, true),
    (org1, 'Negociando Pacote', 'border-amber-500', 3, false, false),
    (org1, 'Ganho', 'border-green-500', 100, true, false),
    (org1, 'Perdido', 'border-red-500', 101, true, false),
    (org2, 'Novas Interessadas', 'border-pink-500', 0, false, false);
  INSERT INTO public.tag_definitions (organization_id, key, label, category) VALUES
    (org1, 'hot_lead', 'Pronta pra agendar', 'status'), (org1, 'cold_lead', 'Só pesquisando', 'status'),
    (org2, 'hot_lead', 'Pronta pra agendar', 'status');
  INSERT INTO public.teams (organization_id, name, description) VALUES (org1, 'Recepção', 'Atendimento') RETURNING id INTO team_recepcao;
  INSERT INTO public.teams (organization_id, name, description) VALUES (org1, 'Procedimentos', 'Profissionais') RETURNING id INTO team_proc;
  INSERT INTO public.team_functions (organization_id, name, description) VALUES (org1, 'Gestora', 'Gestão') RETURNING id INTO func_gestora;
  INSERT INTO public.team_functions (organization_id, name, description) VALUES (org1, 'Esteticista', 'Procedimentos');
  -- Alguém na equipe Procedimentos: essa equipe não pode sumir
  INSERT INTO public.team_members (organization_id, name, email, team_id, function_id)
  VALUES (org1, 'Ana', 'ana-nicho@teste.invalid', team_proc, func_gestora);

  SELECT array_agg(id ORDER BY position) INTO stage_ids FROM public.pipeline_stages WHERE organization_id = org1 AND NOT is_system;

  -- ===== visitante =====
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.org_profile();
    INSERT INTO _n VALUES (1, 'visitante não lê perfil de empresa', false, 'leu!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _n VALUES (1, 'visitante não lê perfil de empresa', true, 'bloqueado');
  END;
  RESET ROLE;

  -- ===== atendente (não admin) =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', agent1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  js := public.org_profile();
  INSERT INTO _n VALUES (2, 'atendente lê nome e nicho da empresa', js->>'company_name' = 'Empresa A' AND js->>'business_niche' = 'estetica', js::text);
  BEGIN
    PERFORM public.apply_business_niche('delivery', cfg, NULL);
    INSERT INTO _n VALUES (3, 'atendente não troca o nicho', false, 'trocou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _n VALUES (3, 'atendente não troca o nicho', true, 'bloqueado');
  END;
  RESET ROLE;

  -- ===== admin troca para delivery =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  js := public.apply_business_niche('delivery', cfg, 'PROMPT DELIVERY');
  INSERT INTO _n VALUES (4, 'admin troca o nicho', js->>'niche' = 'delivery' AND js->>'previous_niche' = 'estetica', js::text);
  RESET ROLE;

  SELECT string_agg(title, ' | ' ORDER BY position) INTO t FROM public.pipeline_stages WHERE organization_id = org1 AND NOT is_system AND is_active;
  INSERT INTO _n VALUES (5, 'funil renomeado e etapa extra criada',
    t = 'Novo Pedido | Montando Pedido | Aguardando Pagamento | Saiu para Entrega | Etapa Extra', t);
  SELECT count(*) INTO n FROM public.pipeline_stages WHERE id = ANY (stage_ids);
  INSERT INTO _n VALUES (6, 'etapas antigas mantidas (mesmo id, cards não mudam)', n = 4, n || ' etapas');
  SELECT string_agg(title, ' | ' ORDER BY position) INTO t FROM public.pipeline_stages WHERE organization_id = org1 AND is_system;
  INSERT INTO _n VALUES (7, 'Ganho e Perdido intactos', t = 'Ganho | Perdido', t);
  SELECT label INTO t FROM public.tag_definitions WHERE organization_id = org1 AND key = 'hot_lead';
  INSERT INTO _n VALUES (8, 'etiqueta renomeada pela chave', t = 'Pronto pra pedir', t);
  SELECT count(*) INTO n FROM public.tag_definitions WHERE organization_id = org1 AND key = 'warm_lead' AND is_active;
  INSERT INTO _n VALUES (9, 'etiqueta que faltava foi criada', n = 1, n::text);
  SELECT string_agg(name || '=' || is_active, ', ' ORDER BY name) INTO t FROM public.teams WHERE organization_id = org1;
  INSERT INTO _n VALUES (10, 'equipe nova ativa, antiga vazia inativa, antiga com gente mantida',
    t = 'Cozinha=true, Procedimentos=true, Recepção=false', t);
  SELECT string_agg(name || '=' || is_active, ', ' ORDER BY name) INTO t FROM public.team_functions WHERE organization_id = org1;
  INSERT INTO _n VALUES (11, 'funções: nova ativa, antiga em uso mantida', t = 'Atendente=true, Esteticista=false, Gestora=true', t);
  SELECT business_niche || ' / ' || system_prompt_override INTO t FROM public.nina_settings WHERE organization_id = org1;
  INSERT INTO _n VALUES (12, 'nicho e prompt gravados', t = 'delivery / PROMPT DELIVERY', t);
  SELECT business_niche || ' / ' || (SELECT string_agg(title, ',') FROM public.pipeline_stages WHERE organization_id = org2) INTO t
  FROM public.nina_settings WHERE organization_id = org2;
  INSERT INTO _n VALUES (13, 'outra empresa não mudou', t = 'estetica / Novas Interessadas', t);

  -- ===== desfazer =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  js := public.org_profile();
  INSERT INTO _n VALUES (14, 'perfil avisa que dá para desfazer', (js->>'can_undo_niche')::boolean AND js->>'previous_niche' = 'estetica', js::text);
  js := public.undo_business_niche();
  INSERT INTO _n VALUES (15, 'desfazer volta para estética', js->>'niche' = 'estetica', js::text);
  RESET ROLE;

  SELECT string_agg(title, ' | ' ORDER BY position) INTO t FROM public.pipeline_stages WHERE organization_id = org1 AND NOT is_system AND is_active;
  INSERT INTO _n VALUES (16, 'funil voltou igual', t = 'Novas Interessadas | Avaliação Agendada | Pós-avaliação | Negociando Pacote', t);
  SELECT string_agg(key || '=' || label || '/' || is_active, ', ' ORDER BY key) INTO t FROM public.tag_definitions WHERE organization_id = org1;
  INSERT INTO _n VALUES (17, 'etiquetas voltaram (a nova fica inativa)', t = 'cold_lead=Só pesquisando/true, hot_lead=Pronta pra agendar/true, warm_lead=Olhando o cardápio/false', t);
  SELECT string_agg(name || '=' || is_active, ', ' ORDER BY name) INTO t FROM public.teams WHERE organization_id = org1;
  INSERT INTO _n VALUES (18, 'equipes voltaram', t = 'Cozinha=false, Procedimentos=true, Recepção=true', t);
  SELECT business_niche || ' / ' || coalesce(system_prompt_override, 'null') || ' / ' || (niche_previous IS NULL) INTO t FROM public.nina_settings WHERE organization_id = org1;
  INSERT INTO _n VALUES (19, 'prompt antigo de volta', t = 'estetica / PROMPT ANTIGO / true', t);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.undo_business_niche();
    INSERT INTO _n VALUES (20, 'não desfaz duas vezes', false, 'desfez de novo');
  EXCEPTION WHEN no_data_found THEN
    INSERT INTO _n VALUES (20, 'não desfaz duas vezes', true, 'avisou');
  END;
  BEGIN
    PERFORM public.apply_business_niche('Delivery!', cfg, NULL);
    INSERT INTO _n VALUES (21, 'nicho inválido recusado', false, 'aceitou');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _n VALUES (21, 'nicho inválido recusado', true, 'recusou');
  END;
  RESET ROLE;

  -- ===== catálogo aceita categorias de outros nichos =====
  INSERT INTO public.procedures (organization_id, name, category, duration_minutes) VALUES (org1, 'X-Burger', 'lanches', 15);
  INSERT INTO _n VALUES (22, 'catálogo aceita categoria de outro nicho', true, 'lanches');

  -- ===== pedidos =====
  INSERT INTO public.contacts (organization_id, phone_number, name) VALUES (org1, '5500000009991', 'Cliente Pedido') RETURNING id INTO contact1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', agent1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.orders (contact_id, items, delivery_fee, discount)
  VALUES (contact1, '[{"name":"X-Burger","quantity":2,"unit_price":25.5},{"name":"Refri","quantity":1,"unit_price":8}]', 7, 3)
  RETURNING id, number, total INTO o1, num1, tot;
  INSERT INTO _n VALUES (23, 'pedido nº 1 com total calculado', num1 = 1 AND tot = 63, num1 || ' / ' || tot);
  INSERT INTO public.orders (items) VALUES ('[{"name":"Suco","quantity":1,"unit_price":9}]') RETURNING number INTO num2;
  INSERT INTO _n VALUES (24, 'segundo pedido nº 2', num2 = 2, num2::text);
  UPDATE public.orders SET number = 99, status = 'preparando', items = '[{"name":"X-Burger","quantity":1,"unit_price":25.5}]' WHERE id = o1
  RETURNING number, total INTO num1, tot;
  INSERT INTO _n VALUES (25, 'número não muda e total recalcula', num1 = 1 AND tot = 29.5, num1 || ' / ' || tot);
  RESET ROLE;

  INSERT INTO public.orders (organization_id, items) VALUES (org2, '[]') RETURNING number INTO num2;
  INSERT INTO _n VALUES (26, 'outra empresa começa no nº 1', num2 = 1, num2::text);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', agent1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.orders;
  INSERT INTO _n VALUES (27, 'atendente só vê pedidos da própria empresa', n = 2, n || ' pedidos');
  BEGIN
    INSERT INTO public.orders (organization_id, items) VALUES (org2, '[]');
    INSERT INTO _n VALUES (28, 'não cria pedido em outra empresa', false, 'criou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _n VALUES (28, 'não cria pedido em outra empresa', true, 'bloqueado');
  END;
  RESET ROLE;

  -- ===== logo da empresa (storage) =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO storage.objects (bucket_id, name) VALUES ('brand-assets', 'org/' || org1 || '/logo-1.png');
  INSERT INTO _n VALUES (29, 'admin envia o logo da própria empresa', true, 'ok');
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('brand-assets', 'org/' || org2 || '/logo-1.png');
    INSERT INTO _n VALUES (30, 'admin não envia logo para outra empresa', false, 'enviou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _n VALUES (30, 'admin não envia logo para outra empresa', true, 'bloqueado');
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('brand-assets', 'platform/logo.png');
    INSERT INTO _n VALUES (31, 'admin não troca a marca da plataforma', false, 'trocou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _n VALUES (31, 'admin não troca a marca da plataforma', true, 'bloqueado');
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', agent1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('brand-assets', 'org/' || org1 || '/logo-2.png');
    INSERT INTO _n VALUES (32, 'atendente não troca o logo', false, 'trocou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _n VALUES (32, 'atendente não troca o logo', true, 'bloqueado');
  END;
  RESET ROLE;

  SELECT count(*) INTO n FROM public.brands WHERE scope = 'platform' AND tagline ILIKE '%clínica%';
  INSERT INTO _n VALUES (33, 'frase da plataforma sem "clínicas"', n = 0, n::text);
END $$;

SELECT step || '. ' || CASE WHEN ok THEN 'OK   ' ELSE 'FALHA' END || ' ' || check_name || ' (' || detail || ')' FROM _n ORDER BY step;
SELECT 'RESUMO: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' ok' FROM _n;
