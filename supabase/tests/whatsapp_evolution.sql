-- Teste do provedor de WhatsApp (Meta x QR code). Rode dentro de BEGIN ... ROLLBACK.

\set QUIET on
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE _w (step int, check_name text, ok boolean, detail text);
GRANT ALL ON _w TO authenticated;

DO $$
DECLARE
  owner_id uuid := (SELECT user_id FROM public.profiles WHERE is_platform_owner LIMIT 1);
  org2 uuid := gen_random_uuid();
  ok boolean; n int; js jsonb;
BEGIN
  INSERT INTO public.organizations (id, name, created_at) VALUES (org2, 'Clínica Teste QR', now() - interval '5 days');
  INSERT INTO public.nina_settings (organization_id, company_name, sdr_name, whatsapp_verify_token)
  VALUES (org2, 'Clínica Teste QR', 'Nina', 'nina-beleza-qr');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT whatsapp_connected INTO ok FROM public.owner_organizations_overview() WHERE id = org2;
  INSERT INTO _w VALUES (1, 'sem conexão aparece como pendente', ok = false, ok::text);
  SELECT count(*) INTO n FROM public.owner_alerts() WHERE organization_id = org2 AND kind = 'whatsapp_pending';
  INSERT INTO _w VALUES (2, 'alerta de WhatsApp não conectado', n = 1, n::text);
  RESET ROLE;

  UPDATE public.nina_settings SET whatsapp_provider = 'evolution', evolution_instance = 'nina_teste_qr',
    evolution_status = 'open', evolution_phone = '5511999990000' WHERE organization_id = org2;

  SET LOCAL ROLE authenticated;
  SELECT whatsapp_connected INTO ok FROM public.owner_organizations_overview() WHERE id = org2;
  INSERT INTO _w VALUES (3, 'QR code conectado conta como conectado', ok, ok::text);
  SELECT count(*) INTO n FROM public.owner_alerts() WHERE organization_id = org2 AND kind = 'whatsapp_pending';
  INSERT INTO _w VALUES (4, 'alerta some com QR conectado', n = 0, n::text);
  js := public.owner_organization_detail(org2);
  INSERT INTO _w VALUES (5, 'detalhe mostra provedor e número', js->'whatsapp'->>'provider' = 'evolution' AND js->'whatsapp'->>'evolution_phone' = '5511999990000', js->'whatsapp'->>'provider');
  js := public.owner_get_clinic_config(org2);
  INSERT INTO _w VALUES (6, 'config não expõe o token do webhook', js->>'whatsapp_provider' = 'evolution' AND NOT js ? 'evolution_token', js->>'whatsapp_provider');
  RESET ROLE;

  UPDATE public.nina_settings SET evolution_status = 'close' WHERE organization_id = org2;
  SET LOCAL ROLE authenticated;
  SELECT whatsapp_connected INTO ok FROM public.owner_organizations_overview() WHERE id = org2;
  INSERT INTO _w VALUES (7, 'QR desconectado volta a pendente', ok = false, ok::text);

  PERFORM public.owner_update_clinic_whatsapp(org2, 'PNID-QR-TESTE', NULL, 'token-meta');
  js := public.owner_get_clinic_config(org2);
  INSERT INTO _w VALUES (8, 'salvar credenciais da Meta troca o provedor', js->>'whatsapp_provider' = 'meta' AND (js->>'whatsapp_connected')::boolean, js->>'whatsapp_provider');
  RESET ROLE;

  BEGIN
    UPDATE public.nina_settings SET whatsapp_provider = 'telegram' WHERE organization_id = org2;
    INSERT INTO _w VALUES (9, 'recusa provedor desconhecido', false, 'aceitou!');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _w VALUES (9, 'recusa provedor desconhecido', true, 'recusado');
  END;
END $$;

SELECT step || '. ' || CASE WHEN ok THEN 'OK   ' ELSE 'FALHA' END || ' ' || check_name || ' (' || detail || ')' FROM _w ORDER BY step;
SELECT 'RESUMO: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' ok' FROM _w;
