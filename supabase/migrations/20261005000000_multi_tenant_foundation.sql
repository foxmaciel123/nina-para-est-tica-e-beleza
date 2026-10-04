-- Fase 1 do SaaS: fundação multi-clínica.
-- Cada clínica é uma organization; todo dado de clínica carrega organization_id
-- e as policies só deixam o usuário ver/alterar dados da própria clínica.

-- 1. Clínicas e membros ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS organization_members_user_id_idx ON public.organization_members (user_id);

DROP TRIGGER IF EXISTS update_organizations_updated_at ON public.organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Clínica do usuário logado (usada nas policies)
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT organization_id FROM public.organization_members
  WHERE user_id = auth.uid()
  ORDER BY created_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid()
      AND organization_id = public.current_org_id()
      AND role = 'admin'
  );
$$;

-- 2. Clínica nº 1 a partir dos dados que já existem --------------------------

DO $$
DECLARE
  v_org uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations) THEN
    INSERT INTO public.organizations (name)
    VALUES (COALESCE(
      (SELECT company_name FROM public.nina_settings ORDER BY created_at LIMIT 1),
      'Minha Clínica'
    ))
    RETURNING id INTO v_org;

    INSERT INTO public.organization_members (organization_id, user_id, role)
    SELECT v_org, u.id,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin'
           ) THEN 'admin' ELSE 'member' END
    FROM auth.users u;
  END IF;
END $$;

-- 3. organization_id nas tabelas de clínica ----------------------------------

DO $$
DECLARE
  t text;
  v_org uuid := (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1);
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'conversations', 'messages', 'conversation_states',
    'deals', 'deal_activities', 'appointments', 'appointment_reminders',
    'contact_photos', 'procedures', 'reminder_templates',
    'google_calendar_credentials', 'google_calendar_sync_log',
    'nina_settings', 'pipeline_stages', 'tag_definitions',
    'teams', 'team_functions', 'team_members'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid', t);
    EXECUTE format('UPDATE public.%I SET organization_id = $1 WHERE organization_id IS NULL', t) USING v_org;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I, ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE',
      t, t || '_organization_id_fkey', t || '_organization_id_fkey'
    );
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organization_id)', t || '_organization_id_idx', t);
  END LOOP;
END $$;

-- 4. Preenche organization_id automaticamente em todo INSERT -----------------
--    Ordem: valor informado → registro pai → clínica do usuário logado.

CREATE OR REPLACE FUNCTION public.set_organization_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'messages', 'conversation_states' THEN
      SELECT organization_id INTO NEW.organization_id FROM public.conversations WHERE id = NEW.conversation_id;
    WHEN 'conversations', 'deals', 'appointments', 'contact_photos' THEN
      IF NEW.contact_id IS NOT NULL THEN
        SELECT organization_id INTO NEW.organization_id FROM public.contacts WHERE id = NEW.contact_id;
      END IF;
    WHEN 'deal_activities' THEN
      SELECT organization_id INTO NEW.organization_id FROM public.deals WHERE id = NEW.deal_id;
    WHEN 'appointment_reminders' THEN
      SELECT organization_id INTO NEW.organization_id FROM public.appointments WHERE id = NEW.appointment_id;
    WHEN 'google_calendar_sync_log' THEN
      IF NEW.credential_id IS NOT NULL THEN
        SELECT organization_id INTO NEW.organization_id FROM public.google_calendar_credentials WHERE id = NEW.credential_id;
      END IF;
    ELSE
      NULL;
  END CASE;

  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := public.current_org_id();
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'conversations', 'messages', 'conversation_states',
    'deals', 'deal_activities', 'appointments', 'appointment_reminders',
    'contact_photos', 'procedures', 'reminder_templates',
    'google_calendar_credentials', 'google_calendar_sync_log',
    'nina_settings', 'pipeline_stages', 'tag_definitions',
    'teams', 'team_functions', 'team_members'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS aa_set_organization_id ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER aa_set_organization_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_organization_id()',
      t
    );
  END LOOP;
END $$;

-- 5. Unicidade passa a valer por clínica ------------------------------------

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_phone_number_unique;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_org_phone_number_unique UNIQUE (organization_id, phone_number);

ALTER TABLE public.tag_definitions DROP CONSTRAINT IF EXISTS tag_definitions_user_key_unique;
ALTER TABLE public.tag_definitions ADD CONSTRAINT tag_definitions_org_key_unique UNIQUE (organization_id, key);

ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_user_name_unique;
ALTER TABLE public.teams ADD CONSTRAINT teams_org_name_unique UNIQUE (organization_id, name);

ALTER TABLE public.team_functions DROP CONSTRAINT IF EXISTS team_functions_user_name_unique;
ALTER TABLE public.team_functions ADD CONSTRAINT team_functions_org_name_unique UNIQUE (organization_id, name);

ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_email_key;
ALTER TABLE public.team_members ADD CONSTRAINT team_members_org_email_unique UNIQUE (organization_id, email);

ALTER TABLE public.reminder_templates DROP CONSTRAINT IF EXISTS reminder_templates_user_id_reminder_type_procedure_category_key;
ALTER TABLE public.reminder_templates ADD CONSTRAINT reminder_templates_org_type_category_unique UNIQUE (organization_id, reminder_type, procedure_category);

-- Uma configuração por clínica, e cada número de WhatsApp aponta para uma clínica só
ALTER TABLE public.nina_settings ADD CONSTRAINT nina_settings_organization_id_unique UNIQUE (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS nina_settings_whatsapp_phone_number_id_unique
  ON public.nina_settings (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;

-- 6. Funil: o card novo usa a primeira etapa da clínica do contato -----------

CREATE OR REPLACE FUNCTION public.auto_create_deal_on_contact()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  first_stage_id uuid;
BEGIN
  SELECT id INTO first_stage_id
  FROM public.pipeline_stages
  WHERE is_active = true AND organization_id = NEW.organization_id
  ORDER BY position ASC
  LIMIT 1;

  IF first_stage_id IS NOT NULL THEN
    INSERT INTO public.deals (title, contact_id, stage_id, user_id, organization_id)
    VALUES (COALESCE(NEW.name, NEW.phone_number), NEW.id, first_stage_id, NEW.user_id, NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_deal_for_new_contact()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  first_stage_id uuid;
BEGIN
  SELECT id INTO first_stage_id
  FROM public.pipeline_stages
  WHERE is_active = true AND organization_id = NEW.organization_id
  ORDER BY position
  LIMIT 1;

  IF first_stage_id IS NULL THEN
    RAISE NOTICE 'No pipeline stages found, skipping deal creation for contact %', NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.deals (contact_id, title, company, stage, stage_id, priority, user_id, organization_id)
  VALUES (NEW.id, COALESCE(NEW.name, NEW.call_name, 'Novo Lead'), NULL, 'new', first_stage_id, 'medium', NEW.user_id, NEW.organization_id);
  RETURN NEW;
END;
$$;

-- 7. Policies por clínica ---------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'contacts', 'conversations', 'messages', 'conversation_states',
        'deals', 'deal_activities', 'appointments', 'appointment_reminders',
        'contact_photos', 'procedures', 'reminder_templates',
        'google_calendar_credentials', 'google_calendar_sync_log',
        'nina_settings', 'pipeline_stages', 'tag_definitions',
        'teams', 'team_functions', 'team_members'
      ])
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Dados do dia a dia: qualquer membro da clínica
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'conversations', 'messages', 'conversation_states',
    'deals', 'deal_activities', 'appointments', 'appointment_reminders',
    'contact_photos', 'procedures', 'reminder_templates',
    'google_calendar_credentials', 'google_calendar_sync_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "Clinic members manage own data" ON public.%I FOR ALL TO authenticated USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id())',
      t
    );
  END LOOP;
END $$;

-- Configuração da clínica: membros leem, admin da clínica altera
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pipeline_stages', 'tag_definitions', 'teams', 'team_functions', 'team_members'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "Clinic members read config" ON public.%I FOR SELECT TO authenticated USING (organization_id = public.current_org_id())',
      t
    );
    EXECUTE format(
      'CREATE POLICY "Clinic admins manage config" ON public.%I FOR ALL TO authenticated USING (organization_id = public.current_org_id() AND public.is_org_admin()) WITH CHECK (organization_id = public.current_org_id() AND public.is_org_admin())',
      t
    );
  END LOOP;
END $$;

-- nina_settings guarda tokens (WhatsApp, ElevenLabs): só admin da clínica
ALTER TABLE public.nina_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinic admins manage nina_settings" ON public.nina_settings
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.current_org_id() AND public.is_org_admin());

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own organization" ON public.organizations
  FOR SELECT TO authenticated USING (id = public.current_org_id());
CREATE POLICY "Admins update own organization" ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (id = public.current_org_id() AND public.is_org_admin());

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own organization members" ON public.organization_members
  FOR SELECT TO authenticated USING (organization_id = public.current_org_id());

GRANT SELECT, UPDATE ON public.organizations TO authenticated;
GRANT SELECT ON public.organization_members TO authenticated;
GRANT ALL ON public.organizations, public.organization_members TO service_role;

-- 8. Funções SECURITY DEFINER: só o backend chama -----------------------------
--    (ignoram RLS; liberadas a usuários permitiriam mexer em dados de outra clínica)

REVOKE EXECUTE ON FUNCTION
  public.update_client_memory(uuid, jsonb),
  public.get_or_create_conversation_state(uuid),
  public.claim_nina_processing_batch(integer),
  public.claim_send_queue_batch(integer),
  public.claim_message_processing_batch(integer),
  public.cleanup_processed_queues(),
  public.cleanup_processed_message_queue(),
  public.nina_invoke_reminders(),
  public.nina_invoke_gcal_watch_renew(),
  public.set_organization_id(),
  public.auto_create_deal_on_contact(),
  public.create_deal_for_new_contact(),
  public.handle_new_user()
FROM PUBLIC, anon, authenticated;

DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_conversation_state'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.current_org_id(), public.is_org_admin() TO authenticated, service_role;
