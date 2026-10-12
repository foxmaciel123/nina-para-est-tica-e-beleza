-- Teste de isolamento entre clínicas. Roda dentro de uma transação e termina
-- com ROLLBACK: nada fica gravado. Uso (no servidor):
--   psql -v ON_ERROR_STOP=1 -f multi_tenant_isolation.sql
-- Espera-se que a migration multi-tenant já tenha sido aplicada (ou incluída
-- antes deste arquivo na mesma transação).

\set QUIET on
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE _t (step int, check_name text, ok boolean, detail text);
GRANT ALL ON _t TO authenticated;

DO $$
DECLARE
  -- clínica A = a mais antiga que tem administradora (outros testes podem criar clínicas sem membros)
  org1 uuid := (SELECT o.id FROM public.organizations o WHERE EXISTS (SELECT 1 FROM public.organization_members m WHERE m.organization_id = o.id AND m.role = 'admin') ORDER BY o.created_at LIMIT 1);
  admin1 uuid := (SELECT m.user_id FROM public.organization_members m WHERE m.organization_id = (SELECT o.id FROM public.organizations o WHERE EXISTS (SELECT 1 FROM public.organization_members x WHERE x.organization_id = o.id AND x.role = 'admin') ORDER BY o.created_at LIMIT 1) AND m.role = 'admin' ORDER BY m.created_at LIMIT 1);
  org2 uuid := gen_random_uuid();
  user2 uuid := gen_random_uuid();
  stage2 uuid;
  c1 uuid; c2 uuid; conv2 uuid; msg_org uuid; deal_stage uuid;
BEGIN
  INSERT INTO public.organizations (id, name) VALUES (org2, 'Clínica Teste B');
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (user2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'isolamento@teste.invalid', '{}'::jsonb, now(), now());
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org2, user2, 'member');

  INSERT INTO public.pipeline_stages (organization_id, title, color, position) VALUES (org2, 'Etapa B', 'border-pink-500', 0) RETURNING id INTO stage2;

  -- contatos com o mesmo telefone nas duas clínicas (permitido agora)
  INSERT INTO public.contacts (organization_id, phone_number, name) VALUES (org1, '5500000000001', 'Paciente A') RETURNING id INTO c1;
  INSERT INTO public.contacts (organization_id, phone_number, name) VALUES (org2, '5500000000001', 'Paciente B') RETURNING id INTO c2;
  INSERT INTO _t VALUES (1, 'mesmo telefone em 2 clínicas', true, 'ok');

  -- card automático usa etapa da clínica certa
  SELECT stage_id INTO deal_stage FROM public.deals WHERE contact_id = c2;
  INSERT INTO _t VALUES (2, 'card do funil na etapa da clínica B', deal_stage = stage2, coalesce(deal_stage::text, 'sem card'));

  -- conversa e mensagem herdam a clínica sem informar organization_id
  INSERT INTO public.conversations (contact_id, status, is_active) VALUES (c2, 'nina', true) RETURNING id INTO conv2;
  INSERT INTO public.messages (conversation_id, content, type, from_type) VALUES (conv2, 'oi', 'text', 'user') RETURNING organization_id INTO msg_org;
  INSERT INTO _t VALUES (3, 'mensagem herda clínica da conversa', msg_org = org2, msg_org::text);

  -- ===== como usuário da clínica B =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _t SELECT 4, 'B vê só contatos da B', count(*) = 1 AND bool_and(name = 'Paciente B'), count(*)::text FROM public.contacts;
  INSERT INTO _t SELECT 5, 'B não vê conversas/mensagens da A', (SELECT count(*) FROM public.messages) = 1, (SELECT count(*) FROM public.messages)::text;
  INSERT INTO _t SELECT 6, 'membro comum não lê nina_settings', count(*) = 0, count(*)::text FROM public.nina_settings;
  INSERT INTO _t SELECT 7, 'B vê só a própria clínica', count(*) = 1, count(*)::text FROM public.organizations;

  INSERT INTO public.contacts (phone_number, name) VALUES ('5500000000002', 'Nova B');
  INSERT INTO _t SELECT 8, 'contato criado pelo painel cai na B', organization_id = org2, organization_id::text FROM public.contacts WHERE phone_number = '5500000000002';

  BEGIN
    INSERT INTO public.contacts (organization_id, phone_number) VALUES (org1, '5500000000003');
    INSERT INTO _t VALUES (9, 'B não consegue gravar na A', false, 'gravou!');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    INSERT INTO _t VALUES (9, 'B não consegue gravar na A', true, SQLERRM);
  END;

  BEGIN
    PERFORM public.update_client_memory(c1, '{}'::jsonb);
    INSERT INTO _t VALUES (10, 'RPC update_client_memory bloqueada', false, 'executou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _t VALUES (10, 'RPC update_client_memory bloqueada', true, 'bloqueada');
  END;

  UPDATE public.contacts SET name = 'hack' WHERE id = c1;
  RESET ROLE;
  INSERT INTO _t SELECT 11, 'B não altera contato da A', name = 'Paciente A', name FROM public.contacts WHERE id = c1;

  -- ===== como admin da clínica A =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _t SELECT 12, 'A vê só contatos da A', bool_and(name <> 'Paciente B' AND name <> 'Nova B'), count(*)::text FROM public.contacts;
  INSERT INTO _t SELECT 13, 'admin da A lê nina_settings da A', count(*) = 1, count(*)::text FROM public.nina_settings;
  INSERT INTO _t SELECT 14, 'A vê o funil da A (6 etapas)', count(*) = 6, count(*)::text FROM public.pipeline_stages;
  RESET ROLE;
END $$;

SELECT step || '. ' || CASE WHEN ok THEN 'OK   ' ELSE 'FALHA' END || ' ' || check_name || ' (' || detail || ')' FROM _t ORDER BY step;
SELECT 'RESUMO: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' ok' FROM _t;
