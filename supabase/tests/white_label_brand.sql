-- Teste da marca da plataforma (white label). Rode dentro de BEGIN ... ROLLBACK.

\set QUIET on
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE _wl (step int, check_name text, ok boolean, detail text);
GRANT ALL ON _wl TO authenticated, anon;

DO $$
DECLARE
  owner_id uuid := (SELECT user_id FROM public.profiles WHERE is_platform_owner LIMIT 1);
  org2 uuid := gen_random_uuid();
  user2 uuid := gen_random_uuid();
  js jsonb; n int;
BEGIN
  INSERT INTO public.organizations (id, name) VALUES (org2, 'Clínica Teste Marca');
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (user2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'marca-teste@teste.invalid', '{}'::jsonb, now(), now());
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org2, user2, 'admin');

  -- ===== visitante (tela de entrada) =====
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  js := public.public_brand('qualquer.exemplo.com');
  INSERT INTO _wl VALUES (1, 'visitante vê a marca da plataforma', js ? 'name' AND length(js->>'name') > 0, js->>'name');
  INSERT INTO _wl VALUES (2, 'marca não tem "Nina"', js::text NOT ILIKE '%nina%', js->>'name');
  BEGIN
    PERFORM count(*) FROM public.brands;
    INSERT INTO _wl VALUES (3, 'visitante não lê a tabela de marcas', false, 'leu!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _wl VALUES (3, 'visitante não lê a tabela de marcas', true, 'bloqueado');
  END;
  RESET ROLE;

  -- ===== admin de clínica não muda a marca =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.owner_update_platform_brand('Hack', NULL, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO _wl VALUES (4, 'clínica não muda a marca', false, 'mudou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _wl VALUES (4, 'clínica não muda a marca', true, 'bloqueado');
  END;
  RESET ROLE;

  -- ===== dono =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  js := public.owner_update_platform_brand('  Marca Teste ', 'Frase', '', 'https://exemplo.invalid/i.png', '#12AB34', 'suporte@exemplo.invalid', '11 99999-0000');
  INSERT INTO _wl VALUES (5, 'dono salva a marca', js->>'name' = 'Marca Teste' AND js->>'logo_url' IS NULL AND js->>'accent_color' = '#12AB34', js::text);
  js := public.public_brand(NULL);
  INSERT INTO _wl VALUES (6, 'marca nova aparece para todos', js->>'name' = 'Marca Teste' AND js->>'support_email' = 'suporte@exemplo.invalid', js->>'name');
  BEGIN
    PERFORM public.owner_update_platform_brand('Marca', NULL, NULL, NULL, 'azul', NULL, NULL);
    INSERT INTO _wl VALUES (7, 'recusa cor inválida', false, 'aceitou!');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _wl VALUES (7, 'recusa cor inválida', true, 'recusado');
  END;
  BEGIN
    PERFORM public.owner_update_platform_brand('  ', NULL, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO _wl VALUES (8, 'recusa nome vazio', false, 'aceitou!');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _wl VALUES (8, 'recusa nome vazio', true, 'recusado');
  END;
  RESET ROLE;

  -- ===== textos do servidor sem "Nina" =====
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname LIKE 'owner_%' AND p.prosrc LIKE '%Nina%';
  INSERT INTO _wl VALUES (9, 'funções do dono sem "Nina"', n = 0, n || ' com Nina');
  SELECT count(*) INTO n FROM public.nina_settings WHERE sdr_name = 'Nina';
  INSERT INTO _wl VALUES (10, 'nome padrão da assistente trocado', n = 0, n || ' clínicas com Nina');
  SELECT count(*) INTO n FROM public.owner_audit_log WHERE action = 'platform_brand_updated';
  INSERT INTO _wl VALUES (11, 'histórico registra a troca de marca', n >= 1, n || ' registros');
END $$;

SELECT step || '. ' || CASE WHEN ok THEN 'OK   ' ELSE 'FALHA' END || ' ' || check_name || ' (' || detail || ')' FROM _wl ORDER BY step;
SELECT 'RESUMO: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' ok' FROM _wl;
