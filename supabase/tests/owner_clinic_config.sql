-- Teste da configuração de clínica pelo dono. Rode dentro de BEGIN ... ROLLBACK.

\set QUIET on
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE _c (step int, check_name text, ok boolean, detail text);
GRANT ALL ON _c TO authenticated;

DO $$
DECLARE
  owner_id uuid := (SELECT user_id FROM public.profiles WHERE is_platform_owner LIMIT 1);
  org1 uuid := (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1);
  org2 uuid := gen_random_uuid();
  user2 uuid := gen_random_uuid();
  proc_id uuid; js jsonb; n int; st text;
BEGIN
  INSERT INTO public.organizations (id, name) VALUES (org2, 'Clínica Teste B');
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (user2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'config-teste@teste.invalid', '{}'::jsonb, now(), now());
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org2, user2, 'admin');
  INSERT INTO public.nina_settings (organization_id, company_name, sdr_name, whatsapp_verify_token)
  VALUES (org2, 'Clínica Teste B', 'Nina', 'nina-beleza-teste');
  UPDATE public.nina_settings SET whatsapp_phone_number_id = 'PNID-ORG1-TESTE' WHERE organization_id = org1;

  -- ===== admin de outra clínica não usa as funções do dono =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.owner_update_clinic_agent(org1, '{"sdr_name":"Hack"}'::jsonb);
    INSERT INTO _c VALUES (1, 'clínica não edita agente de outra', false, 'editou!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _c VALUES (1, 'clínica não edita agente de outra', true, 'bloqueado');
  END;
  BEGIN
    PERFORM public.owner_get_clinic_config(org1);
    INSERT INTO _c VALUES (2, 'clínica não lê config de outra', false, 'leu!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _c VALUES (2, 'clínica não lê config de outra', true, 'bloqueado');
  END;
  RESET ROLE;

  -- ===== dono =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.owner_update_clinic_whatsapp(org2, 'PNID-B', 'WABA-B', 'token-secreto-b');
  js := public.owner_get_clinic_config(org2);
  INSERT INTO _c VALUES (3, 'salva WhatsApp e não devolve o token', js->>'whatsapp_phone_number_id' = 'PNID-B' AND (js->>'has_whatsapp_token')::boolean AND NOT js ? 'whatsapp_access_token', js->>'whatsapp_phone_number_id');

  PERFORM public.owner_update_clinic_whatsapp(org2, 'PNID-B', 'WABA-B', '');
  RESET ROLE;
  SELECT whatsapp_access_token INTO st FROM public.nina_settings WHERE organization_id = org2;
  INSERT INTO _c VALUES (4, 'token vazio mantém o atual', st = 'token-secreto-b', 'mantido');
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.owner_update_clinic_whatsapp(org2, 'PNID-ORG1-TESTE', NULL, NULL);
    INSERT INTO _c VALUES (5, 'recusa número já usado por outra clínica', false, 'aceitou!');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _c VALUES (5, 'recusa número já usado por outra clínica', true, SQLERRM);
  END;

  PERFORM public.owner_update_clinic_agent(org2, '{"sdr_name":"Bia","company_name":"Bella","is_active":false,"ai_model_mode":"pro","system_prompt_override":"Você é a Bia."}'::jsonb);
  js := public.owner_get_clinic_config(org2);
  INSERT INTO _c VALUES (6, 'salva agente e prompt', js->>'sdr_name' = 'Bia' AND js->>'ai_model_mode' = 'pro' AND (js->>'is_active')::boolean = false AND js->>'system_prompt_override' = 'Você é a Bia.', js->>'sdr_name');

  PERFORM public.owner_update_clinic_agent(org2, '{"sdr_name":"Bia","system_prompt_override":"  "}'::jsonb);
  js := public.owner_get_clinic_config(org2);
  INSERT INTO _c VALUES (7, 'prompt vazio volta ao padrão', js->'system_prompt_override' = 'null'::jsonb, coalesce(js->>'system_prompt_override', 'padrão'));

  BEGIN
    PERFORM public.owner_update_clinic_agent(org2, '{"sdr_name":"Bia","ai_model_mode":"gpt"}'::jsonb);
    INSERT INTO _c VALUES (8, 'recusa modelo inválido', false, 'aceitou!');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _c VALUES (8, 'recusa modelo inválido', true, SQLERRM);
  END;

  PERFORM public.owner_update_clinic_hours(org2, '08:00', '19:30', ARRAY[6, 1, 2, 2]);
  js := public.owner_get_clinic_config(org2);
  INSERT INTO _c VALUES (9, 'salva horário e dias sem repetir', js->>'business_hours_start' = '08:00:00' AND js->'business_days' = '[1, 2, 6]'::jsonb, js->>'business_days');

  BEGIN
    PERFORM public.owner_update_clinic_hours(org2, '18:00', '09:00', ARRAY[1]);
    INSERT INTO _c VALUES (10, 'recusa fim antes do início', false, 'aceitou!');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _c VALUES (10, 'recusa fim antes do início', true, SQLERRM);
  END;

  proc_id := public.owner_save_procedure(org2, '{"name":"Botox","category":"harmonizacao","duration_minutes":"45","price_min":"800","price_max":"1200","price_visible":true}'::jsonb);
  PERFORM public.owner_save_procedure(org2, jsonb_build_object('id', proc_id, 'name', 'Botox full face', 'category', 'harmonizacao', 'price_min', '900'));
  SELECT count(*) INTO n FROM public.owner_list_procedures(org2) WHERE name = 'Botox full face' AND price_min = 900;
  INSERT INTO _c VALUES (11, 'cria e edita procedimento', n = 1, n::text);

  BEGIN
    PERFORM public.owner_save_procedure(org2, '{"name":"Peeling","category":"facial","price_min":"500","price_max":"100"}'::jsonb);
    INSERT INTO _c VALUES (12, 'recusa preço máximo menor que mínimo', false, 'aceitou!');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _c VALUES (12, 'recusa preço máximo menor que mínimo', true, SQLERRM);
  END;

  BEGIN
    PERFORM public.owner_delete_procedure(org1, proc_id);
    INSERT INTO _c VALUES (13, 'não apaga procedimento pela clínica errada', false, 'apagou!');
  EXCEPTION WHEN no_data_found THEN
    INSERT INTO _c VALUES (13, 'não apaga procedimento pela clínica errada', true, 'recusado');
  END;
  PERFORM public.owner_delete_procedure(org2, proc_id);

  PERFORM public.owner_update_organization(org2, 'Clínica Teste B2', 300, NULL, NULL, NULL);
  PERFORM public.owner_create_charge(org2, public.today_sp() + 10, 300, NULL);
  SELECT count(*) INTO n FROM public.owner_list_audit(org2, 50);
  SELECT string_agg(action, ',' ORDER BY action) INTO st FROM (SELECT DISTINCT action FROM public.owner_list_audit(org2, 50)) a;
  INSERT INTO _c VALUES (14, 'histórico registra todas as ações do dono',
    st = 'agent_updated,charge_created,clinic_data_updated,hours_updated,procedure_created,procedure_deleted,procedure_updated,whatsapp_updated', st);
  RESET ROLE;
END $$;

SELECT step || '. ' || CASE WHEN ok THEN 'OK   ' ELSE 'FALHA' END || ' ' || check_name || ' (' || detail || ')' FROM _c ORDER BY step;
SELECT 'RESUMO: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' ok' FROM _c;
