-- Teste: só a dona da plataforma lê/escreve app_config (chave mestra).
-- Rode dentro de BEGIN ... ROLLBACK:
--   psql -v ON_ERROR_STOP=1 -c 'BEGIN' -f seguranca_app_config.sql -c 'ROLLBACK'

\set QUIET on
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE _s (step int, check_name text, ok boolean, detail text);
GRANT ALL ON _s TO authenticated, anon;

DO $$
DECLARE
  org1 uuid := gen_random_uuid();
  dona uuid := gen_random_uuid();
  plataforma uuid := gen_random_uuid();
  v text; n int; blocked boolean;
BEGIN
  INSERT INTO public.organizations (id, name) VALUES (org1, 'Clínica Teste Segurança');
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
    (dona, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dona-seg@teste.invalid', '{}'::jsonb, now(), now()),
    (plataforma, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'plataforma-seg@teste.invalid', '{}'::jsonb, now(), now());
  -- igual ao painel (criar clínica): papel global admin + admin da clínica
  DELETE FROM public.user_roles WHERE user_id IN (dona, plataforma);
  INSERT INTO public.user_roles (user_id, role) VALUES (dona, 'admin'), (plataforma, 'admin');
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org1, dona, 'admin');
  INSERT INTO public.profiles (user_id, full_name) VALUES (plataforma, 'Plataforma') ON CONFLICT (user_id) DO NOTHING;
  ALTER TABLE public.profiles DISABLE TRIGGER USER;
  UPDATE public.profiles SET is_platform_owner = true WHERE user_id = plataforma;
  ALTER TABLE public.profiles ENABLE TRIGGER USER;
  INSERT INTO public.app_config (key, value) VALUES ('service_role_key', 'CHAVE-MESTRA-TESTE')
    ON CONFLICT (key) DO UPDATE SET value = excluded.value;

  -- dona de clínica
  PERFORM set_config('request.jwt.claims', json_build_object('sub', dona, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.app_config;
  INSERT INTO _s VALUES (1, 'dona de clínica não lê app_config', n = 0, n::text);
  UPDATE public.app_config SET value = 'https://servidor-do-atacante.invalid' WHERE key = 'service_role_key';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO _s VALUES (2, 'dona de clínica não altera app_config', n = 0, n::text);
  blocked := false;
  BEGIN
    PERFORM public.app_config_get('service_role_key');
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  INSERT INTO _s VALUES (3, 'dona de clínica não chama app_config_get', blocked, '');
  RESET ROLE;

  -- visitante sem login
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  blocked := false;
  BEGIN
    SELECT count(*) INTO n FROM public.app_config;
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  INSERT INTO _s VALUES (4, 'visitante não lê app_config', blocked, '');
  RESET ROLE;

  -- dona da plataforma
  PERFORM set_config('request.jwt.claims', json_build_object('sub', plataforma, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT value INTO v FROM public.app_config WHERE key = 'service_role_key';
  INSERT INTO _s VALUES (5, 'dona da plataforma lê app_config', v = 'CHAVE-MESTRA-TESTE', coalesce(v, '(nada)'));
  RESET ROLE;

  -- crons (SECURITY DEFINER) continuam lendo
  SELECT public.app_config_get('service_role_key') INTO v;
  INSERT INTO _s VALUES (6, 'crons continuam lendo a chave', v = 'CHAVE-MESTRA-TESTE', coalesce(v, '(nada)'));
END $$;

SELECT step || ' ' || CASE WHEN ok THEN 'OK  ' ELSE 'FALHOU' END || ' ' || check_name || CASE WHEN ok THEN '' ELSE ' (' || coalesce(detail, '') || ')' END FROM _s ORDER BY step;
SELECT CASE WHEN bool_and(ok) THEN 'RESULTADO: ' || count(*) || '/' || count(*) || ' OK' ELSE 'RESULTADO: FALHOU' END FROM _s;
