-- Fase 2 do SaaS: Painel do Dono.
-- O dono da plataforma (flag em profiles) vê todas as clínicas, o uso de cada
-- uma e pode suspender/reativar. Clínica suspensa perde acesso aos dados e a
-- Nina para de responder/enviar.

-- 1. Dono da plataforma ------------------------------------------------------

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_platform_owner boolean NOT NULL DEFAULT false;

-- Usuário comum não pode se promover a dono editando o próprio perfil
CREATE OR REPLACE FUNCTION public.protect_platform_owner_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.is_platform_owner)
     OR (TG_OP = 'UPDATE' AND NEW.is_platform_owner IS DISTINCT FROM OLD.is_platform_owner) THEN
    RAISE EXCEPTION 'is_platform_owner só pode ser alterado pelo backend';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_platform_owner_flag ON public.profiles;
CREATE TRIGGER protect_platform_owner_flag
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_platform_owner_flag();

CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT is_platform_owner FROM public.profiles WHERE user_id = auth.uid()), false);
$$;

-- 2. Clínica suspensa perde acesso aos dados ---------------------------------
--    current_org_id() (usado em todas as policies) só devolve clínica ativa.

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.organization_id
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid() AND o.status = 'active'
  ORDER BY m.created_at
  LIMIT 1;
$$;

-- Para o painel saber em qual clínica o usuário está e se ela foi suspensa
CREATE OR REPLACE FUNCTION public.my_organization()
RETURNS TABLE (id uuid, name text, status text, role text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.id, o.name, o.status, m.role
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
  ORDER BY m.created_at
  LIMIT 1;
$$;

-- 3. Funções do Painel do Dono ----------------------------------------------

CREATE OR REPLACE FUNCTION public.owner_organizations_overview()
RETURNS TABLE (
  id uuid,
  name text,
  status text,
  created_at timestamptz,
  admin_email text,
  members bigint,
  contacts bigint,
  conversations_30d bigint,
  ai_messages_30d bigint,
  appointments_30d bigint,
  whatsapp_connected boolean,
  last_activity_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Acesso restrito ao dono da plataforma' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.status,
    o.created_at,
    (SELECT u.email::text FROM public.organization_members m JOIN auth.users u ON u.id = m.user_id
      WHERE m.organization_id = o.id AND m.role = 'admin' ORDER BY m.created_at LIMIT 1),
    (SELECT count(*) FROM public.organization_members m WHERE m.organization_id = o.id),
    (SELECT count(*) FROM public.contacts c WHERE c.organization_id = o.id),
    (SELECT count(*) FROM public.conversations c WHERE c.organization_id = o.id AND c.last_message_at >= now() - interval '30 days'),
    (SELECT count(*) FROM public.messages msg WHERE msg.organization_id = o.id AND msg.from_type = 'nina' AND msg.sent_at >= now() - interval '30 days'),
    (SELECT count(*) FROM public.appointments a WHERE a.organization_id = o.id AND a.created_at >= now() - interval '30 days'),
    COALESCE((SELECT s.whatsapp_phone_number_id IS NOT NULL AND s.whatsapp_access_token IS NOT NULL
      FROM public.nina_settings s WHERE s.organization_id = o.id), false),
    (SELECT max(c.last_message_at) FROM public.conversations c WHERE c.organization_id = o.id)
  FROM public.organizations o
  ORDER BY o.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_organization_detail(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Acesso restrito ao dono da plataforma' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'organization', to_jsonb(o) - 'updated_at',
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'email', u.email, 'role', m.role, 'full_name', p.full_name,
        'joined_at', m.created_at, 'last_sign_in_at', u.last_sign_in_at
      ) ORDER BY m.created_at)
      FROM public.organization_members m
      JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.profiles p ON p.user_id = m.user_id
      WHERE m.organization_id = o.id
    ), '[]'::jsonb),
    'settings', (
      SELECT jsonb_build_object(
        'company_name', s.company_name,
        'assistant_name', s.sdr_name,
        'is_active', s.is_active,
        'whatsapp_connected', s.whatsapp_phone_number_id IS NOT NULL AND s.whatsapp_access_token IS NOT NULL,
        'custom_prompt', s.system_prompt_override IS NOT NULL,
        'ai_model_mode', s.ai_model_mode,
        'business_hours', s.business_hours_start || ' – ' || s.business_hours_end
      )
      FROM public.nina_settings s WHERE s.organization_id = o.id
    ),
    'usage_30d', jsonb_build_object(
      'contacts_total', (SELECT count(*) FROM public.contacts c WHERE c.organization_id = o.id),
      'new_contacts', (SELECT count(*) FROM public.contacts c WHERE c.organization_id = o.id AND c.created_at >= now() - interval '30 days'),
      'conversations', (SELECT count(*) FROM public.conversations c WHERE c.organization_id = o.id AND c.last_message_at >= now() - interval '30 days'),
      'messages_received', (SELECT count(*) FROM public.messages msg WHERE msg.organization_id = o.id AND msg.from_type = 'user' AND msg.sent_at >= now() - interval '30 days'),
      'ai_messages', (SELECT count(*) FROM public.messages msg WHERE msg.organization_id = o.id AND msg.from_type = 'nina' AND msg.sent_at >= now() - interval '30 days'),
      'appointments', (SELECT count(*) FROM public.appointments a WHERE a.organization_id = o.id AND a.created_at >= now() - interval '30 days')
    ),
    'daily_ai_messages', (
      SELECT jsonb_agg(jsonb_build_object('day', d::date, 'count', COALESCE(x.n, 0)) ORDER BY d)
      FROM generate_series((now() - interval '29 days')::date, now()::date, interval '1 day') d
      LEFT JOIN (
        SELECT msg.sent_at::date AS day, count(*) AS n
        FROM public.messages msg
        WHERE msg.organization_id = o.id AND msg.from_type = 'nina' AND msg.sent_at >= now() - interval '30 days'
        GROUP BY 1
      ) x ON x.day = d::date
    )
  )
  INTO result
  FROM public.organizations o
  WHERE o.id = p_org;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Clínica não encontrada' USING ERRCODE = 'P0002';
  END IF;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_organization_status(p_org uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Acesso restrito ao dono da plataforma' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Status inválido: %', p_status;
  END IF;

  UPDATE public.organizations SET status = p_status WHERE id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clínica não encontrada' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.is_platform_owner(),
  public.my_organization(),
  public.owner_organizations_overview(),
  public.owner_organization_detail(uuid),
  public.owner_set_organization_status(uuid, text),
  public.protect_platform_owner_flag()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.is_platform_owner(),
  public.my_organization(),
  public.owner_organizations_overview(),
  public.owner_organization_detail(uuid),
  public.owner_set_organization_status(uuid, text)
TO authenticated, service_role;

-- 4. Dono inicial -----------------------------------------------------------

UPDATE public.profiles p
SET is_platform_owner = true
FROM auth.users u
WHERE u.id = p.user_id AND u.email = 'modabr14@gmail.com';
