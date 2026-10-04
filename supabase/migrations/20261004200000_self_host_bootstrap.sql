-- Complementos ao export do Lovable (que só cobre o schema public).

-- 1. Cadastro: cria profile + role (primeiro usuário vira admin)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Realtime: tabelas que o frontend escuta via supabase.channel()
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'messages', 'conversations', 'deals', 'pipeline_stages',
    'appointments', 'teams', 'team_members', 'team_functions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- 3. app_config guarda a service_role_key usada pelos crons.
--    No Lovable qualquer usuário logado lia a tabela e o anon podia chamar
--    app_config_get() (SECURITY DEFINER). Restringe a admins / service_role.
REVOKE ALL ON TABLE public.app_config FROM anon;
REVOKE ALL ON FUNCTION public.app_config_get(text) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Authenticated users can read app_config" ON public.app_config;
DROP POLICY IF EXISTS "Authenticated users can write app_config" ON public.app_config;

CREATE POLICY "Admins can read app_config" ON public.app_config
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can write app_config" ON public.app_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Crons (as funções leem URL/chave de app_config)
DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
  WHERE jobname IN ('nina-appointment-reminders', 'nina-gcal-watch-renew');

  PERFORM cron.schedule('nina-appointment-reminders', '*/5 * * * *',
    'SELECT public.nina_invoke_reminders()');
  PERFORM cron.schedule('nina-gcal-watch-renew', '0 6 * * *',
    'SELECT public.nina_invoke_gcal_watch_renew()');
END $$;
