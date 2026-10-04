-- Teste do Painel do Dono. Rode dentro de BEGIN ... ROLLBACK (nada fica gravado).

\set QUIET on
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE _o (step int, check_name text, ok boolean, detail text);
GRANT ALL ON _o TO authenticated;

DO $$
DECLARE
  owner_id uuid := (SELECT user_id FROM public.profiles WHERE is_platform_owner LIMIT 1);
  org2 uuid := gen_random_uuid();
  user2 uuid := gen_random_uuid();
  n int; st text; js jsonb;
BEGIN
  INSERT INTO public.organizations (id, name) VALUES (org2, 'Clínica Teste B');
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (user2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dono-teste@teste.invalid', '{}'::jsonb, now(), now());
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org2, user2, 'admin');
  INSERT INTO public.contacts (organization_id, phone_number, name) VALUES (org2, '5500000000009', 'Paciente B');

  -- ===== usuário comum (admin da clínica B) =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _o VALUES (1, 'clínica não é dona da plataforma', NOT public.is_platform_owner(), '');

  BEGIN
    PERFORM * FROM public.owner_organizations_overview();
    INSERT INTO _o VALUES (2, 'clínica não lista outras clínicas', false, 'listou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _o VALUES (2, 'clínica não lista outras clínicas', true, 'bloqueado');
  END;

  BEGIN
    PERFORM public.owner_set_organization_status(org2, 'active');
    INSERT INTO _o VALUES (3, 'clínica não muda status', false, 'mudou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _o VALUES (3, 'clínica não muda status', true, 'bloqueado');
  END;

  BEGIN
    UPDATE public.profiles SET is_platform_owner = true WHERE user_id = user2;
    INSERT INTO _o VALUES (4, 'clínica não se promove a dona', false, 'promoveu!');
  EXCEPTION WHEN raise_exception THEN
    INSERT INTO _o VALUES (4, 'clínica não se promove a dona', true, 'bloqueado');
  END;
  RESET ROLE;

  -- ===== dono =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _o VALUES (5, 'dono reconhecido', public.is_platform_owner(), coalesce(owner_id::text, 'sem dono'));
  SELECT count(*) INTO n FROM public.owner_organizations_overview();
  INSERT INTO _o VALUES (6, 'dono vê todas as clínicas', n >= 2, n::text);
  SELECT contacts INTO n FROM public.owner_organizations_overview() WHERE id = org2;
  INSERT INTO _o VALUES (7, 'uso da clínica B contado', n = 1, n::text);
  js := public.owner_organization_detail(org2);
  INSERT INTO _o VALUES (8, 'detalhe traz membros e 30 dias de gráfico',
    jsonb_array_length(js->'members') = 1 AND jsonb_array_length(js->'daily_ai_messages') = 30,
    (js->'members'->0->>'email') || ' / ' || jsonb_array_length(js->'daily_ai_messages'));

  PERFORM public.owner_set_organization_status(org2, 'suspended');
  RESET ROLE;

  -- ===== clínica B suspensa =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT status INTO st FROM public.my_organization();
  INSERT INTO _o VALUES (9, 'painel sabe que está suspensa', st = 'suspended', st);
  SELECT count(*) INTO n FROM public.contacts;
  INSERT INTO _o VALUES (10, 'suspensa não vê dados', n = 0, n::text);
  RESET ROLE;

  -- ===== reativa =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.owner_set_organization_status(org2, 'active');
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', user2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.contacts;
  INSERT INTO _o VALUES (11, 'reativada volta a ver dados', n = 1, n::text);
  RESET ROLE;
END $$;

SELECT step || '. ' || CASE WHEN ok THEN 'OK   ' ELSE 'FALHA' END || ' ' || check_name || ' (' || detail || ')' FROM _o ORDER BY step;
SELECT 'RESUMO: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' ok' FROM _o;
