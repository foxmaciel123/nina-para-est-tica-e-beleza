--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'user'
);


--
-- Name: appointment_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_type AS ENUM (
    'demo',
    'meeting',
    'support',
    'followup'
);


--
-- Name: conversation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.conversation_status AS ENUM (
    'nina',
    'human',
    'paused'
);


--
-- Name: member_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.member_role AS ENUM (
    'admin',
    'manager',
    'agent'
);


--
-- Name: member_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.member_status AS ENUM (
    'active',
    'invited',
    'disabled'
);


--
-- Name: message_from; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.message_from AS ENUM (
    'user',
    'nina',
    'human'
);


--
-- Name: message_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.message_status AS ENUM (
    'sent',
    'delivered',
    'read',
    'failed',
    'processing'
);


--
-- Name: message_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.message_type AS ENUM (
    'text',
    'audio',
    'image',
    'document',
    'video'
);


--
-- Name: queue_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.queue_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
);


--
-- Name: team_assignment; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.team_assignment AS ENUM (
    'mateus',
    'igor',
    'fe',
    'vendas',
    'suporte'
);


--
-- Name: app_config_get(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_config_get(p_key text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT value FROM public.app_config WHERE key = p_key LIMIT 1;
$$;


--
-- Name: auto_create_deal_on_contact(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_create_deal_on_contact() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  first_stage_id uuid;
BEGIN
  SELECT id INTO first_stage_id FROM public.pipeline_stages WHERE is_active = true ORDER BY position ASC LIMIT 1;
  IF first_stage_id IS NOT NULL THEN
    INSERT INTO public.deals (title, contact_id, stage_id, user_id)
    VALUES (COALESCE(NEW.name, NEW.phone_number), NEW.id, first_stage_id, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: message_processing_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_processing_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    whatsapp_message_id text NOT NULL,
    phone_number_id text NOT NULL,
    raw_data jsonb NOT NULL,
    status public.queue_status DEFAULT 'pending'::public.queue_status NOT NULL,
    priority integer DEFAULT 1 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    error_message text,
    scheduled_for timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: claim_message_processing_batch(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_message_processing_batch(p_limit integer DEFAULT 50) RETURNS SETOF public.message_processing_queue
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
    RETURN QUERY
    WITH cte AS (
        SELECT id
        FROM public.message_processing_queue
        WHERE status = 'pending'
          AND (scheduled_for IS NULL OR scheduled_for <= now())
        ORDER BY priority DESC, scheduled_for ASC NULLS FIRST, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    UPDATE public.message_processing_queue m
    SET status = 'processing', updated_at = now()
    WHERE m.id IN (SELECT id FROM cte)
    RETURNING m.*;
END;
$$;


--
-- Name: nina_processing_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nina_processing_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    context_data jsonb,
    status public.queue_status DEFAULT 'pending'::public.queue_status NOT NULL,
    priority integer DEFAULT 1 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    error_message text,
    scheduled_for timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: claim_nina_processing_batch(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_nina_processing_batch(p_limit integer DEFAULT 50) RETURNS SETOF public.nina_processing_queue
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
    RETURN QUERY
    WITH cte AS (
        SELECT id
        FROM public.nina_processing_queue
        WHERE status = 'pending'
          AND (scheduled_for IS NULL OR scheduled_for <= now())
        ORDER BY priority DESC, scheduled_for ASC NULLS FIRST, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    UPDATE public.nina_processing_queue n
    SET status = 'processing', updated_at = now()
    WHERE n.id IN (SELECT id FROM cte)
    RETURNING n.*;
END;
$$;


--
-- Name: send_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.send_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    message_type text DEFAULT 'text'::text NOT NULL,
    from_type text DEFAULT 'nina'::text NOT NULL,
    content text,
    media_url text,
    metadata jsonb DEFAULT '{}'::jsonb,
    status public.queue_status DEFAULT 'pending'::public.queue_status NOT NULL,
    priority integer DEFAULT 1 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    error_message text,
    scheduled_at timestamp with time zone DEFAULT now(),
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    message_id uuid
);


--
-- Name: claim_send_queue_batch(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_send_queue_batch(p_limit integer DEFAULT 10) RETURNS SETOF public.send_queue
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
    RETURN QUERY
    WITH cte AS (
        SELECT id
        FROM public.send_queue
        WHERE status = 'pending'
          AND (scheduled_at IS NULL OR scheduled_at <= now())
        ORDER BY priority DESC, scheduled_at ASC NULLS FIRST, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    UPDATE public.send_queue s
    SET status = 'processing', updated_at = now()
    WHERE s.id IN (SELECT id FROM cte)
    RETURNING s.*;
END;
$$;


--
-- Name: cleanup_processed_message_queue(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_processed_message_queue() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    DELETE FROM public.message_grouping_queue 
    WHERE processed = true AND created_at < now() - interval '1 hour';
END;
$$;


--
-- Name: cleanup_processed_queues(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_processed_queues() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    DELETE FROM public.message_processing_queue 
    WHERE status = 'completed' AND processed_at < now() - interval '24 hours';
    DELETE FROM public.nina_processing_queue 
    WHERE status = 'completed' AND processed_at < now() - interval '24 hours';
    DELETE FROM public.send_queue 
    WHERE status = 'completed' AND sent_at < now() - interval '24 hours';
    DELETE FROM public.message_processing_queue 
    WHERE status = 'failed' AND updated_at < now() - interval '7 days';
    DELETE FROM public.nina_processing_queue 
    WHERE status = 'failed' AND updated_at < now() - interval '7 days';
    DELETE FROM public.send_queue 
    WHERE status = 'failed' AND updated_at < now() - interval '7 days';
END;
$$;


--
-- Name: create_deal_for_new_contact(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_deal_for_new_contact() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  first_stage_id UUID;
BEGIN
  SELECT id INTO first_stage_id 
  FROM public.pipeline_stages 
  WHERE is_active = true AND (user_id = NEW.user_id OR user_id IS NULL)
  ORDER BY position LIMIT 1;
  IF first_stage_id IS NULL THEN
    RAISE NOTICE 'No pipeline stages found, skipping deal creation for contact %', NEW.id;
    RETURN NEW;
  END IF;
  INSERT INTO deals (contact_id, title, company, stage, stage_id, priority, user_id)
  VALUES (NEW.id, COALESCE(NEW.name, NEW.call_name, 'Novo Lead'), NULL, 'new', first_stage_id, 'medium', NEW.user_id);
  RETURN NEW;
END;
$$;


--
-- Name: get_auth_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_auth_user_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ SELECT auth.uid() $$;


--
-- Name: conversation_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    current_state text DEFAULT 'idle'::text NOT NULL,
    last_action text,
    last_action_at timestamp with time zone,
    scheduling_context jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: get_or_create_conversation_state(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_or_create_conversation_state(p_conversation_id uuid) RETURNS public.conversation_states
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    state_record public.conversation_states;
BEGIN
    SELECT * INTO state_record
    FROM public.conversation_states
    WHERE conversation_id = p_conversation_id;
    
    IF NOT FOUND THEN
        INSERT INTO public.conversation_states (conversation_id, current_state)
        VALUES (p_conversation_id, 'idle')
        RETURNING * INTO state_record;
    END IF;
    
    RETURN state_record;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name');
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;


--
-- Name: nina_invoke_gcal_watch_renew(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.nina_invoke_gcal_watch_renew() RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_url TEXT; v_key TEXT; v_req_id BIGINT;
BEGIN
  v_url := public.app_config_get('supabase_url');
  v_key := public.app_config_get('service_role_key');
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE '[nina_invoke_gcal_watch_renew] app_config incompleta — pulando';
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := v_url || '/functions/v1/google-calendar-watch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('renew_all', true),
    timeout_milliseconds := 60000
  ) INTO v_req_id;
  RETURN v_req_id;
END;
$$;


--
-- Name: nina_invoke_reminders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.nina_invoke_reminders() RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_url TEXT; v_key TEXT; v_req_id BIGINT;
BEGIN
  v_url := public.app_config_get('supabase_url');
  v_key := public.app_config_get('service_role_key');
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE '[nina_invoke_reminders] app_config incompleta — pulando';
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := v_url || '/functions/v1/appointment-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_req_id;
  RETURN v_req_id;
END;
$$;


--
-- Name: touch_procedures_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_procedures_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_client_memory(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_client_memory(p_contact_id uuid, p_new_memory jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
    UPDATE public.contacts 
    SET client_memory = p_new_memory, updated_at = now()
    WHERE id = p_contact_id;
END;
$$;


--
-- Name: update_conversation_last_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_conversation_last_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = NEW.conversation_id;
  UPDATE public.contacts SET last_activity = NOW(), updated_at = NOW() WHERE id = (SELECT contact_id FROM public.conversations WHERE id = NEW.conversation_id);
  RETURN NEW;
END;
$$;


--
-- Name: update_conversation_state(uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_conversation_state(p_conversation_id uuid, p_new_state text, p_action text DEFAULT NULL::text, p_context jsonb DEFAULT NULL::jsonb) RETURNS public.conversation_states
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    state_record public.conversation_states;
BEGIN
    INSERT INTO public.conversation_states (
        conversation_id, current_state, last_action, last_action_at, scheduling_context
    )
    VALUES (
        p_conversation_id, p_new_state, p_action, now(), COALESCE(p_context, '{}')
    )
    ON CONFLICT (conversation_id) 
    DO UPDATE SET
        current_state = EXCLUDED.current_state,
        last_action = EXCLUDED.last_action,
        last_action_at = EXCLUDED.last_action_at,
        scheduling_context = CASE 
            WHEN EXCLUDED.scheduling_context = '{}' THEN conversation_states.scheduling_context
            ELSE EXCLUDED.scheduling_context
        END,
        updated_at = now()
    RETURNING * INTO state_record;
    
    RETURN state_record;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: app_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_config (
    key text NOT NULL,
    value text,
    description text,
    is_secret boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: appointment_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    appointment_id uuid NOT NULL,
    contact_id uuid,
    reminder_type text NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    message_body text NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    sent_at timestamp with time zone,
    error_message text,
    retry_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointment_reminders_reminder_type_check CHECK ((reminder_type = ANY (ARRAY['pre_24h'::text, 'pre_2h'::text, 'post_24h'::text, 'post_7d_nps'::text, 'recall_30d'::text, 'recall_90d'::text]))),
    CONSTRAINT appointment_reminders_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.appointment_reminders REPLICA IDENTITY FULL;


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    date date NOT NULL,
    "time" time without time zone NOT NULL,
    duration integer DEFAULT 60 NOT NULL,
    type public.appointment_type DEFAULT 'meeting'::public.appointment_type NOT NULL,
    attendees text[] DEFAULT '{}'::text[],
    contact_id uuid,
    meeting_url text,
    status text DEFAULT 'scheduled'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    user_id uuid,
    google_event_id text,
    google_calendar_id text,
    google_synced_at timestamp with time zone,
    last_sync_source text DEFAULT 'local'::text,
    CONSTRAINT appointments_last_sync_source_check CHECK ((last_sync_source = ANY (ARRAY['local'::text, 'google'::text])))
);

ALTER TABLE ONLY public.appointments REPLICA IDENTITY FULL;


--
-- Name: contact_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    contact_id uuid NOT NULL,
    conversation_id uuid,
    message_id uuid,
    storage_path text NOT NULL,
    storage_url text,
    caption text,
    body_area text,
    taken_at timestamp with time zone DEFAULT now() NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text
);

ALTER TABLE ONLY public.contact_photos REPLICA IDENTITY FULL;


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_number text NOT NULL,
    whatsapp_id text,
    name text,
    call_name text,
    email text,
    profile_picture_url text,
    is_business boolean DEFAULT false,
    is_blocked boolean DEFAULT false,
    blocked_at timestamp with time zone,
    blocked_reason text,
    tags text[] DEFAULT '{}'::text[],
    notes text,
    client_memory jsonb DEFAULT '{"last_updated": null, "lead_profile": {"interests": [], "lead_stage": "new", "objections": [], "products_discussed": [], "communication_style": "unknown", "qualification_score": 0}, "sales_intelligence": {"pain_points": [], "next_best_action": "qualify", "budget_indication": "unknown", "decision_timeline": "unknown"}, "interaction_summary": {"response_pattern": "unknown", "last_contact_reason": "", "total_conversations": 0, "preferred_contact_time": "unknown"}, "conversation_history": []}'::jsonb,
    first_contact_date timestamp with time zone DEFAULT now() NOT NULL,
    last_activity timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

ALTER TABLE ONLY public.contacts REPLICA IDENTITY FULL;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    status public.conversation_status DEFAULT 'nina'::public.conversation_status NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    assigned_team public.team_assignment,
    assigned_user_id uuid,
    tags text[] DEFAULT '{}'::text[],
    nina_context jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

ALTER TABLE ONLY public.conversations REPLICA IDENTITY FULL;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    reply_to_id uuid,
    whatsapp_message_id text,
    type public.message_type DEFAULT 'text'::public.message_type NOT NULL,
    from_type public.message_from NOT NULL,
    content text,
    media_url text,
    media_type text,
    status public.message_status DEFAULT 'sent'::public.message_status NOT NULL,
    processed_by_nina boolean DEFAULT false,
    nina_response_time integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.messages REPLICA IDENTITY FULL;


--
-- Name: contacts_with_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.contacts_with_stats WITH (security_invoker='true') AS
 SELECT c.id,
    c.phone_number,
    c.whatsapp_id,
    c.name,
    c.call_name,
    c.email,
    c.profile_picture_url,
    c.is_business,
    c.is_blocked,
    c.blocked_at,
    c.blocked_reason,
    c.tags,
    c.notes,
    c.client_memory,
    c.first_contact_date,
    c.last_activity,
    c.created_at,
    c.updated_at,
    c.user_id,
    COALESCE(msg_stats.total_messages, (0)::bigint) AS total_messages,
    COALESCE(msg_stats.nina_messages, (0)::bigint) AS nina_messages,
    COALESCE(msg_stats.user_messages, (0)::bigint) AS user_messages,
    COALESCE(msg_stats.human_messages, (0)::bigint) AS human_messages
   FROM (public.contacts c
     LEFT JOIN ( SELECT conv.contact_id,
            count(m.id) AS total_messages,
            count(
                CASE
                    WHEN (m.from_type = 'nina'::public.message_from) THEN 1
                    ELSE NULL::integer
                END) AS nina_messages,
            count(
                CASE
                    WHEN (m.from_type = 'user'::public.message_from) THEN 1
                    ELSE NULL::integer
                END) AS user_messages,
            count(
                CASE
                    WHEN (m.from_type = 'human'::public.message_from) THEN 1
                    ELSE NULL::integer
                END) AS human_messages
           FROM (public.conversations conv
             JOIN public.messages m ON ((m.conversation_id = conv.id)))
          GROUP BY conv.contact_id) msg_stats ON ((msg_stats.contact_id = c.id)));


--
-- Name: deal_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    type text DEFAULT 'note'::text NOT NULL,
    title text NOT NULL,
    description text,
    scheduled_at timestamp with time zone,
    completed_at timestamp with time zone,
    is_completed boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT deal_activities_type_check CHECK ((type = ANY (ARRAY['note'::text, 'call'::text, 'email'::text, 'meeting'::text, 'task'::text])))
);


--
-- Name: deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid,
    title text NOT NULL,
    company text,
    value numeric DEFAULT 0,
    stage text DEFAULT 'new'::text,
    priority text DEFAULT 'medium'::text,
    tags text[] DEFAULT '{}'::text[],
    due_date date,
    owner_id uuid,
    notes text,
    lost_reason text,
    won_at timestamp with time zone,
    lost_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    stage_id uuid NOT NULL,
    user_id uuid
);

ALTER TABLE ONLY public.deals REPLICA IDENTITY FULL;


--
-- Name: google_calendar_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_calendar_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    professional_id uuid,
    google_email text NOT NULL,
    calendar_id text DEFAULT 'primary'::text NOT NULL,
    access_token text,
    refresh_token text NOT NULL,
    token_expires_at timestamp with time zone,
    scope text,
    is_active boolean DEFAULT true NOT NULL,
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    watch_channel_id text,
    watch_resource_id text,
    watch_expires_at timestamp with time zone,
    sync_token text,
    last_incoming_sync_at timestamp with time zone
);


--
-- Name: google_calendar_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_calendar_sync_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    credential_id uuid,
    appointment_id uuid,
    direction text NOT NULL,
    google_event_id text,
    status text NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT google_calendar_sync_log_direction_check CHECK ((direction = ANY (ARRAY['outbound_create'::text, 'outbound_update'::text, 'outbound_delete'::text, 'inbound_create'::text, 'inbound_update'::text, 'inbound_delete'::text, 'watch_renew'::text, 'webhook_received'::text]))),
    CONSTRAINT google_calendar_sync_log_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: message_grouping_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_grouping_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    whatsapp_message_id text NOT NULL,
    phone_number_id text NOT NULL,
    message_data jsonb NOT NULL,
    contacts_data jsonb,
    processed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    process_after timestamp with time zone DEFAULT (now() + '00:00:20'::interval),
    message_id uuid
);


--
-- Name: nina_cron_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.nina_cron_status AS
 SELECT j.jobname,
    j.schedule,
    j.active,
    jr.start_time AS last_run_started_at,
    jr.end_time AS last_run_ended_at,
    jr.status AS last_run_status,
    jr.return_message AS last_run_message
   FROM (cron.job j
     LEFT JOIN LATERAL ( SELECT job_run_details.jobid,
            job_run_details.runid,
            job_run_details.job_pid,
            job_run_details.database,
            job_run_details.username,
            job_run_details.command,
            job_run_details.status,
            job_run_details.return_message,
            job_run_details.start_time,
            job_run_details.end_time
           FROM cron.job_run_details
          WHERE (job_run_details.jobid = j.jobid)
          ORDER BY job_run_details.start_time DESC
         LIMIT 1) jr ON (true))
  WHERE (j.jobname ~~ 'nina-%'::text);


--
-- Name: nina_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nina_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    system_prompt_override text,
    test_system_prompt text,
    elevenlabs_api_key text,
    elevenlabs_voice_id text DEFAULT '33B4UnXyTNbgLmdEDh5P'::text NOT NULL,
    elevenlabs_model text DEFAULT 'eleven_turbo_v2_5'::text,
    elevenlabs_stability numeric DEFAULT 0.75 NOT NULL,
    elevenlabs_similarity_boost numeric DEFAULT 0.80 NOT NULL,
    elevenlabs_style numeric DEFAULT 0.30 NOT NULL,
    elevenlabs_speaker_boost boolean DEFAULT true NOT NULL,
    elevenlabs_speed numeric DEFAULT 1.0,
    whatsapp_access_token text,
    whatsapp_phone_number_id text,
    whatsapp_verify_token text DEFAULT 'viver-de-ia-nina-webhook'::text,
    auto_response_enabled boolean DEFAULT true NOT NULL,
    adaptive_response_enabled boolean DEFAULT true NOT NULL,
    message_breaking_enabled boolean DEFAULT true NOT NULL,
    response_delay_min integer DEFAULT 1000 NOT NULL,
    response_delay_max integer DEFAULT 3000 NOT NULL,
    timezone text DEFAULT 'America/Sao_Paulo'::text NOT NULL,
    business_hours_start time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    business_hours_end time without time zone DEFAULT '18:00:00'::time without time zone NOT NULL,
    business_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
    async_booking_enabled boolean DEFAULT false,
    route_all_to_receiver_enabled boolean DEFAULT false NOT NULL,
    test_phone_numbers jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_name text,
    sdr_name text,
    ai_model_mode text DEFAULT 'flash'::text,
    audio_response_enabled boolean DEFAULT false,
    ai_scheduling_enabled boolean DEFAULT true,
    whatsapp_business_account_id text,
    user_id uuid,
    CONSTRAINT nina_settings_ai_model_mode_check CHECK ((ai_model_mode = ANY (ARRAY['flash'::text, 'pro'::text, 'pro3'::text, 'adaptive'::text])))
);


--
-- Name: nina_public_settings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.nina_public_settings WITH (security_invoker='true') AS
 SELECT id,
    company_name,
    sdr_name
   FROM public.nina_settings;


--
-- Name: pipeline_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    color text DEFAULT 'border-slate-500'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    is_system boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ai_trigger_criteria text,
    is_ai_managed boolean DEFAULT false,
    user_id uuid
);

ALTER TABLE ONLY public.pipeline_stages REPLICA IDENTITY FULL;


--
-- Name: procedures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procedures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    category text NOT NULL,
    description text,
    duration_minutes integer DEFAULT 60 NOT NULL,
    price_min numeric(10,2),
    price_max numeric(10,2),
    price_visible boolean DEFAULT false NOT NULL,
    contraindications text,
    pre_care text,
    post_care text,
    professional_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT procedures_category_check CHECK ((category = ANY (ARRAY['facial'::text, 'corporal'::text, 'harmonizacao'::text, 'capilar'::text, 'bem_estar'::text, 'pos_operatorio'::text, 'outro'::text]))),
    CONSTRAINT procedures_duration_minutes_check CHECK ((duration_minutes > 0))
);

ALTER TABLE ONLY public.procedures REPLICA IDENTITY FULL;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    full_name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reminder_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminder_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    reminder_type text NOT NULL,
    procedure_category text,
    template_body text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reminder_templates_reminder_type_check CHECK ((reminder_type = ANY (ARRAY['pre_24h'::text, 'pre_2h'::text, 'post_24h'::text, 'post_7d_nps'::text, 'recall_30d'::text, 'recall_90d'::text])))
);


--
-- Name: tag_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    color text DEFAULT '#3b82f6'::text NOT NULL,
    category text DEFAULT 'custom'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);


--
-- Name: team_functions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_functions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

ALTER TABLE ONLY public.team_functions REPLICA IDENTITY FULL;


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    role public.member_role DEFAULT 'agent'::public.member_role NOT NULL,
    status public.member_status DEFAULT 'invited'::public.member_status NOT NULL,
    avatar text,
    team_id uuid,
    function_id uuid,
    weight integer DEFAULT 1,
    last_active timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

ALTER TABLE ONLY public.team_members REPLICA IDENTITY FULL;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    color text DEFAULT '#3b82f6'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

ALTER TABLE ONLY public.teams REPLICA IDENTITY FULL;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role DEFAULT 'user'::public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_config app_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);


--
-- Name: appointment_reminders appointment_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_reminders
    ADD CONSTRAINT appointment_reminders_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: contact_photos contact_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_photos
    ADD CONSTRAINT contact_photos_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_phone_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_phone_number_unique UNIQUE (phone_number);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: conversation_states conversation_states_conversation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_states
    ADD CONSTRAINT conversation_states_conversation_id_key UNIQUE (conversation_id);


--
-- Name: conversation_states conversation_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_states
    ADD CONSTRAINT conversation_states_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: deal_activities deal_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_activities
    ADD CONSTRAINT deal_activities_pkey PRIMARY KEY (id);


--
-- Name: deals deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);


--
-- Name: google_calendar_credentials google_calendar_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_credentials
    ADD CONSTRAINT google_calendar_credentials_pkey PRIMARY KEY (id);


--
-- Name: google_calendar_credentials google_calendar_credentials_professional_id_google_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_credentials
    ADD CONSTRAINT google_calendar_credentials_professional_id_google_email_key UNIQUE (professional_id, google_email);


--
-- Name: google_calendar_sync_log google_calendar_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_sync_log
    ADD CONSTRAINT google_calendar_sync_log_pkey PRIMARY KEY (id);


--
-- Name: message_grouping_queue message_grouping_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_grouping_queue
    ADD CONSTRAINT message_grouping_queue_pkey PRIMARY KEY (id);


--
-- Name: message_processing_queue message_processing_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_processing_queue
    ADD CONSTRAINT message_processing_queue_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: nina_processing_queue nina_processing_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nina_processing_queue
    ADD CONSTRAINT nina_processing_queue_pkey PRIMARY KEY (id);


--
-- Name: nina_settings nina_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nina_settings
    ADD CONSTRAINT nina_settings_pkey PRIMARY KEY (id);


--
-- Name: nina_settings nina_settings_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nina_settings
    ADD CONSTRAINT nina_settings_user_id_unique UNIQUE (user_id);


--
-- Name: pipeline_stages pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);


--
-- Name: procedures procedures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procedures
    ADD CONSTRAINT procedures_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: reminder_templates reminder_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_templates
    ADD CONSTRAINT reminder_templates_pkey PRIMARY KEY (id);


--
-- Name: reminder_templates reminder_templates_user_id_reminder_type_procedure_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_templates
    ADD CONSTRAINT reminder_templates_user_id_reminder_type_procedure_category_key UNIQUE (user_id, reminder_type, procedure_category);


--
-- Name: send_queue send_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.send_queue
    ADD CONSTRAINT send_queue_pkey PRIMARY KEY (id);


--
-- Name: tag_definitions tag_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_definitions
    ADD CONSTRAINT tag_definitions_pkey PRIMARY KEY (id);


--
-- Name: tag_definitions tag_definitions_user_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_definitions
    ADD CONSTRAINT tag_definitions_user_key_unique UNIQUE (user_id, key);


--
-- Name: team_functions team_functions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_functions
    ADD CONSTRAINT team_functions_pkey PRIMARY KEY (id);


--
-- Name: team_functions team_functions_user_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_functions
    ADD CONSTRAINT team_functions_user_name_unique UNIQUE (user_id, name);


--
-- Name: team_members team_members_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_email_key UNIQUE (email);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: teams teams_user_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_user_name_unique UNIQUE (user_id, name);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: idx_appointments_google_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appointments_google_event ON public.appointments USING btree (google_event_id) WHERE (google_event_id IS NOT NULL);


--
-- Name: idx_appointments_metadata_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appointments_metadata_source ON public.appointments USING gin (metadata jsonb_path_ops);


--
-- Name: idx_contact_photos_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_photos_contact ON public.contact_photos USING btree (contact_id, taken_at DESC);


--
-- Name: idx_contact_photos_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_photos_conversation ON public.contact_photos USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);


--
-- Name: idx_contacts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_created_at ON public.contacts USING btree (created_at DESC);


--
-- Name: idx_contacts_is_blocked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_is_blocked ON public.contacts USING btree (is_blocked);


--
-- Name: idx_contacts_last_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_last_activity ON public.contacts USING btree (last_activity DESC);


--
-- Name: idx_contacts_phone_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_phone_number ON public.contacts USING btree (phone_number);


--
-- Name: idx_contacts_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_tags ON public.contacts USING gin (tags);


--
-- Name: idx_contacts_whatsapp_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_whatsapp_id ON public.contacts USING btree (whatsapp_id);


--
-- Name: idx_conversation_states_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversation_states_conversation_id ON public.conversation_states USING btree (conversation_id);


--
-- Name: idx_conversation_states_current_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversation_states_current_state ON public.conversation_states USING btree (current_state);


--
-- Name: idx_conversations_contact_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_contact_id ON public.conversations USING btree (contact_id);


--
-- Name: idx_conversations_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_created_at ON public.conversations USING btree (created_at DESC);


--
-- Name: idx_conversations_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_is_active ON public.conversations USING btree (is_active);


--
-- Name: idx_conversations_last_message_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_last_message_at ON public.conversations USING btree (last_message_at DESC);


--
-- Name: idx_conversations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_status ON public.conversations USING btree (status);


--
-- Name: idx_conversations_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_tags ON public.conversations USING gin (tags);


--
-- Name: idx_deal_activities_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_activities_created_at ON public.deal_activities USING btree (created_at DESC);


--
-- Name: idx_deal_activities_deal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_activities_deal_id ON public.deal_activities USING btree (deal_id);


--
-- Name: idx_gcal_creds_watch_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcal_creds_watch_channel ON public.google_calendar_credentials USING btree (watch_channel_id) WHERE (watch_channel_id IS NOT NULL);


--
-- Name: idx_gcal_creds_watch_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcal_creds_watch_expires ON public.google_calendar_credentials USING btree (watch_expires_at) WHERE (is_active = true);


--
-- Name: idx_gcal_sync_log_user_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcal_sync_log_user_recent ON public.google_calendar_sync_log USING btree (user_id, created_at DESC);


--
-- Name: idx_message_grouping_queue_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_grouping_queue_created_at ON public.message_grouping_queue USING btree (created_at);


--
-- Name: idx_message_grouping_queue_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_grouping_queue_message_id ON public.message_grouping_queue USING btree (message_id);


--
-- Name: idx_message_grouping_queue_phone_number_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_grouping_queue_phone_number_id ON public.message_grouping_queue USING btree (phone_number_id);


--
-- Name: idx_message_grouping_queue_processed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_grouping_queue_processed ON public.message_grouping_queue USING btree (processed);


--
-- Name: idx_message_grouping_ready; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_grouping_ready ON public.message_grouping_queue USING btree (process_after, processed) WHERE (processed = false);


--
-- Name: idx_message_processing_queue_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_processing_queue_priority ON public.message_processing_queue USING btree (priority DESC);


--
-- Name: idx_message_processing_queue_scheduled_for; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_processing_queue_scheduled_for ON public.message_processing_queue USING btree (scheduled_for);


--
-- Name: idx_message_processing_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_processing_queue_status ON public.message_processing_queue USING btree (status);


--
-- Name: idx_messages_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation_id ON public.messages USING btree (conversation_id);


--
-- Name: idx_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_created_at ON public.messages USING btree (created_at DESC);


--
-- Name: idx_messages_from_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_from_type ON public.messages USING btree (from_type);


--
-- Name: idx_messages_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_sent_at ON public.messages USING btree (sent_at DESC);


--
-- Name: idx_messages_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_status ON public.messages USING btree (status);


--
-- Name: idx_messages_whatsapp_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_whatsapp_message_id ON public.messages USING btree (whatsapp_message_id);


--
-- Name: idx_nina_processing_queue_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nina_processing_queue_conversation_id ON public.nina_processing_queue USING btree (conversation_id);


--
-- Name: idx_nina_processing_queue_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nina_processing_queue_message_id ON public.nina_processing_queue USING btree (message_id);


--
-- Name: idx_nina_processing_queue_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nina_processing_queue_priority ON public.nina_processing_queue USING btree (priority DESC);


--
-- Name: idx_nina_processing_queue_scheduled_for; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nina_processing_queue_scheduled_for ON public.nina_processing_queue USING btree (scheduled_for);


--
-- Name: idx_nina_processing_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nina_processing_queue_status ON public.nina_processing_queue USING btree (status);


--
-- Name: idx_nina_settings_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nina_settings_is_active ON public.nina_settings USING btree (is_active);


--
-- Name: idx_pipeline_stages_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_stages_is_active ON public.pipeline_stages USING btree (is_active);


--
-- Name: idx_pipeline_stages_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_stages_position ON public.pipeline_stages USING btree ("position");


--
-- Name: idx_procedures_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procedures_category ON public.procedures USING btree (category) WHERE (is_active = true);


--
-- Name: idx_procedures_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procedures_name ON public.procedures USING gin (to_tsvector('portuguese'::regconfig, name));


--
-- Name: idx_reminders_appointment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_appointment ON public.appointment_reminders USING btree (appointment_id);


--
-- Name: idx_reminders_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_due ON public.appointment_reminders USING btree (scheduled_for, status) WHERE (status = 'scheduled'::text);


--
-- Name: idx_send_queue_contact_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_send_queue_contact_id ON public.send_queue USING btree (contact_id);


--
-- Name: idx_send_queue_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_send_queue_conversation_id ON public.send_queue USING btree (conversation_id);


--
-- Name: idx_send_queue_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_send_queue_priority ON public.send_queue USING btree (priority DESC);


--
-- Name: idx_send_queue_scheduled_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_send_queue_scheduled_at ON public.send_queue USING btree (scheduled_at);


--
-- Name: idx_send_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_send_queue_status ON public.send_queue USING btree (status);


--
-- Name: idx_tag_definitions_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tag_definitions_category ON public.tag_definitions USING btree (category);


--
-- Name: idx_tag_definitions_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tag_definitions_key ON public.tag_definitions USING btree (key);


--
-- Name: messages_whatsapp_message_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX messages_whatsapp_message_id_unique ON public.messages USING btree (whatsapp_message_id) WHERE (whatsapp_message_id IS NOT NULL);


--
-- Name: contacts auto_create_deal_on_contact; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER auto_create_deal_on_contact AFTER INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.create_deal_for_new_contact();


--
-- Name: procedures procedures_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER procedures_set_updated_at BEFORE UPDATE ON public.procedures FOR EACH ROW EXECUTE FUNCTION public.touch_procedures_updated_at();


--
-- Name: contacts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: conversation_states set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversation_states FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: conversations set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: message_processing_queue set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.message_processing_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: nina_processing_queue set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.nina_processing_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: nina_settings set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.nina_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: send_queue set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.send_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tag_definitions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tag_definitions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: appointments update_appointments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: contacts update_contacts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: messages update_conversation_last_message_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_conversation_last_message_trigger AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.update_conversation_last_message();


--
-- Name: conversation_states update_conversation_states_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_conversation_states_updated_at BEFORE UPDATE ON public.conversation_states FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: conversations update_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: deal_activities update_deal_activities_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_deal_activities_updated_at BEFORE UPDATE ON public.deal_activities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: deals update_deals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: message_processing_queue update_message_processing_queue_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_message_processing_queue_updated_at BEFORE UPDATE ON public.message_processing_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: nina_processing_queue update_nina_processing_queue_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_nina_processing_queue_updated_at BEFORE UPDATE ON public.nina_processing_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: nina_settings update_nina_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_nina_settings_updated_at BEFORE UPDATE ON public.nina_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: pipeline_stages update_pipeline_stages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_pipeline_stages_updated_at BEFORE UPDATE ON public.pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: send_queue update_send_queue_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_send_queue_updated_at BEFORE UPDATE ON public.send_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tag_definitions update_tag_definitions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_tag_definitions_updated_at BEFORE UPDATE ON public.tag_definitions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: team_functions update_team_functions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_team_functions_updated_at BEFORE UPDATE ON public.team_functions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: team_members update_team_members_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_team_members_updated_at BEFORE UPDATE ON public.team_members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: teams update_teams_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: appointment_reminders appointment_reminders_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_reminders
    ADD CONSTRAINT appointment_reminders_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: appointment_reminders appointment_reminders_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_reminders
    ADD CONSTRAINT appointment_reminders_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: appointment_reminders appointment_reminders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_reminders
    ADD CONSTRAINT appointment_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: appointments appointments_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: contact_photos contact_photos_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_photos
    ADD CONSTRAINT contact_photos_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_photos contact_photos_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_photos
    ADD CONSTRAINT contact_photos_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: contact_photos contact_photos_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_photos
    ADD CONSTRAINT contact_photos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: conversation_states conversation_states_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_states
    ADD CONSTRAINT conversation_states_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: deal_activities deal_activities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_activities
    ADD CONSTRAINT deal_activities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.team_members(id);


--
-- Name: deal_activities deal_activities_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_activities
    ADD CONSTRAINT deal_activities_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;


--
-- Name: deals deals_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: deals deals_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.team_members(id);


--
-- Name: deals deals_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id);


--
-- Name: deals deals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: google_calendar_credentials google_calendar_credentials_professional_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_credentials
    ADD CONSTRAINT google_calendar_credentials_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: google_calendar_credentials google_calendar_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_credentials
    ADD CONSTRAINT google_calendar_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: google_calendar_sync_log google_calendar_sync_log_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_sync_log
    ADD CONSTRAINT google_calendar_sync_log_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;


--
-- Name: google_calendar_sync_log google_calendar_sync_log_credential_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_sync_log
    ADD CONSTRAINT google_calendar_sync_log_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.google_calendar_credentials(id) ON DELETE CASCADE;


--
-- Name: google_calendar_sync_log google_calendar_sync_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_sync_log
    ADD CONSTRAINT google_calendar_sync_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: message_grouping_queue message_grouping_queue_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_grouping_queue
    ADD CONSTRAINT message_grouping_queue_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id);


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.messages(id);


--
-- Name: nina_settings nina_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nina_settings
    ADD CONSTRAINT nina_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pipeline_stages pipeline_stages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: procedures procedures_professional_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procedures
    ADD CONSTRAINT procedures_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: procedures procedures_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procedures
    ADD CONSTRAINT procedures_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reminder_templates reminder_templates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_templates
    ADD CONSTRAINT reminder_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: send_queue send_queue_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.send_queue
    ADD CONSTRAINT send_queue_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id);


--
-- Name: tag_definitions tag_definitions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_definitions
    ADD CONSTRAINT tag_definitions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: team_functions team_functions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_functions
    ADD CONSTRAINT team_functions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_function_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_function_id_fkey FOREIGN KEY (function_id) REFERENCES public.team_functions(id) ON DELETE SET NULL;


--
-- Name: team_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: teams teams_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: nina_settings Admins can modify nina_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can modify nina_settings" ON public.nina_settings TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: pipeline_stages Admins can modify pipeline_stages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can modify pipeline_stages" ON public.pipeline_stages TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: tag_definitions Admins can modify tag_definitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can modify tag_definitions" ON public.tag_definitions TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: team_functions Admins can modify team_functions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can modify team_functions" ON public.team_functions TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: team_members Admins can modify team_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can modify team_members" ON public.team_members TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: teams Admins can modify teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can modify teams" ON public.teams TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: nina_settings Admins can read nina_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read nina_settings" ON public.nina_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: pipeline_stages Authenticated can read pipeline_stages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read pipeline_stages" ON public.pipeline_stages FOR SELECT TO authenticated USING (true);


--
-- Name: tag_definitions Authenticated can read tag_definitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read tag_definitions" ON public.tag_definitions FOR SELECT TO authenticated USING (true);


--
-- Name: team_functions Authenticated can read team_functions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read team_functions" ON public.team_functions FOR SELECT TO authenticated USING (true);


--
-- Name: team_members Authenticated can read team_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read team_members" ON public.team_members FOR SELECT TO authenticated USING (true);


--
-- Name: teams Authenticated can read teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read teams" ON public.teams FOR SELECT TO authenticated USING (true);


--
-- Name: google_calendar_sync_log Authenticated read sync log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read sync log" ON public.google_calendar_sync_log FOR SELECT TO authenticated USING ((auth.role() = 'authenticated'::text));


--
-- Name: appointments Authenticated users can access all appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can access all appointments" ON public.appointments TO authenticated USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: contacts Authenticated users can access all contacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can access all contacts" ON public.contacts USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: conversations Authenticated users can access all conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can access all conversations" ON public.conversations USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: deals Authenticated users can access all deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can access all deals" ON public.deals TO authenticated USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: messages Authenticated users can access all messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can access all messages" ON public.messages USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: procedures Authenticated users can access all procedures; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can access all procedures" ON public.procedures TO authenticated USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: appointment_reminders Authenticated users can access appointment reminders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can access appointment reminders" ON public.appointment_reminders TO authenticated USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: contact_photos Authenticated users can access contact photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can access contact photos" ON public.contact_photos TO authenticated USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: google_calendar_credentials Authenticated users can access google calendar creds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can access google calendar creds" ON public.google_calendar_credentials TO authenticated USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: reminder_templates Authenticated users can access reminder templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can access reminder templates" ON public.reminder_templates TO authenticated USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: app_config Authenticated users can read app_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read app_config" ON public.app_config FOR SELECT TO authenticated USING ((auth.role() = 'authenticated'::text));


--
-- Name: app_config Authenticated users can write app_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can write app_config" ON public.app_config TO authenticated USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: message_grouping_queue Service role manages message_grouping_queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages message_grouping_queue" ON public.message_grouping_queue TO service_role USING (true) WITH CHECK (true);


--
-- Name: message_processing_queue Service role manages message_processing_queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages message_processing_queue" ON public.message_processing_queue TO service_role USING (true) WITH CHECK (true);


--
-- Name: nina_processing_queue Service role manages nina_processing_queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages nina_processing_queue" ON public.nina_processing_queue TO service_role USING (true) WITH CHECK (true);


--
-- Name: send_queue Service role manages send_queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages send_queue" ON public.send_queue TO service_role USING (true) WITH CHECK (true);


--
-- Name: deal_activities Users can access activities of their deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can access activities of their deals" ON public.deal_activities USING ((EXISTS ( SELECT 1
   FROM public.deals
  WHERE ((deals.id = deal_activities.deal_id) AND (deals.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.deals
  WHERE ((deals.id = deal_activities.deal_id) AND (deals.user_id = auth.uid())))));


--
-- Name: conversation_states Users can access states of their conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can access states of their conversations" ON public.conversation_states USING ((EXISTS ( SELECT 1
   FROM public.conversations
  WHERE ((conversations.id = conversation_states.conversation_id) AND (conversations.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.conversations
  WHERE ((conversations.id = conversation_states.conversation_id) AND (conversations.user_id = auth.uid())))));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_roles Users can view own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: app_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

--
-- Name: appointment_reminders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointment_reminders ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_states ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_activities ENABLE ROW LEVEL SECURITY;

--
-- Name: deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

--
-- Name: google_calendar_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.google_calendar_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: google_calendar_sync_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.google_calendar_sync_log ENABLE ROW LEVEL SECURITY;

--
-- Name: message_grouping_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_grouping_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: message_processing_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_processing_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: nina_processing_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nina_processing_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: nina_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nina_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: procedures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reminder_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: send_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.send_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: tag_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tag_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: team_functions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_functions ENABLE ROW LEVEL SECURITY;

--
-- Name: team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION app_config_get(p_key text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.app_config_get(p_key text) TO anon;
GRANT ALL ON FUNCTION public.app_config_get(p_key text) TO authenticated;
GRANT ALL ON FUNCTION public.app_config_get(p_key text) TO service_role;


--
-- Name: FUNCTION auto_create_deal_on_contact(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.auto_create_deal_on_contact() TO anon;
GRANT ALL ON FUNCTION public.auto_create_deal_on_contact() TO authenticated;
GRANT ALL ON FUNCTION public.auto_create_deal_on_contact() TO service_role;


--
-- Name: TABLE message_processing_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.message_processing_queue TO anon;
GRANT ALL ON TABLE public.message_processing_queue TO authenticated;
GRANT ALL ON TABLE public.message_processing_queue TO service_role;


--
-- Name: FUNCTION claim_message_processing_batch(p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.claim_message_processing_batch(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.claim_message_processing_batch(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.claim_message_processing_batch(p_limit integer) TO service_role;


--
-- Name: TABLE nina_processing_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nina_processing_queue TO anon;
GRANT ALL ON TABLE public.nina_processing_queue TO authenticated;
GRANT ALL ON TABLE public.nina_processing_queue TO service_role;


--
-- Name: FUNCTION claim_nina_processing_batch(p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.claim_nina_processing_batch(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.claim_nina_processing_batch(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.claim_nina_processing_batch(p_limit integer) TO service_role;


--
-- Name: TABLE send_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.send_queue TO anon;
GRANT ALL ON TABLE public.send_queue TO authenticated;
GRANT ALL ON TABLE public.send_queue TO service_role;


--
-- Name: FUNCTION claim_send_queue_batch(p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.claim_send_queue_batch(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.claim_send_queue_batch(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.claim_send_queue_batch(p_limit integer) TO service_role;


--
-- Name: FUNCTION cleanup_processed_message_queue(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleanup_processed_message_queue() TO anon;
GRANT ALL ON FUNCTION public.cleanup_processed_message_queue() TO authenticated;
GRANT ALL ON FUNCTION public.cleanup_processed_message_queue() TO service_role;


--
-- Name: FUNCTION cleanup_processed_queues(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleanup_processed_queues() TO anon;
GRANT ALL ON FUNCTION public.cleanup_processed_queues() TO authenticated;
GRANT ALL ON FUNCTION public.cleanup_processed_queues() TO service_role;


--
-- Name: FUNCTION create_deal_for_new_contact(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_deal_for_new_contact() TO anon;
GRANT ALL ON FUNCTION public.create_deal_for_new_contact() TO authenticated;
GRANT ALL ON FUNCTION public.create_deal_for_new_contact() TO service_role;


--
-- Name: FUNCTION get_auth_user_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_auth_user_id() TO anon;
GRANT ALL ON FUNCTION public.get_auth_user_id() TO authenticated;
GRANT ALL ON FUNCTION public.get_auth_user_id() TO service_role;


--
-- Name: TABLE conversation_states; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversation_states TO anon;
GRANT ALL ON TABLE public.conversation_states TO authenticated;
GRANT ALL ON TABLE public.conversation_states TO service_role;


--
-- Name: FUNCTION get_or_create_conversation_state(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_or_create_conversation_state(p_conversation_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_or_create_conversation_state(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_or_create_conversation_state(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION has_role(_user_id uuid, _role public.app_role); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO anon;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO authenticated;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO service_role;


--
-- Name: FUNCTION nina_invoke_gcal_watch_renew(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.nina_invoke_gcal_watch_renew() TO anon;
GRANT ALL ON FUNCTION public.nina_invoke_gcal_watch_renew() TO authenticated;
GRANT ALL ON FUNCTION public.nina_invoke_gcal_watch_renew() TO service_role;


--
-- Name: FUNCTION nina_invoke_reminders(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.nina_invoke_reminders() TO anon;
GRANT ALL ON FUNCTION public.nina_invoke_reminders() TO authenticated;
GRANT ALL ON FUNCTION public.nina_invoke_reminders() TO service_role;


--
-- Name: FUNCTION touch_procedures_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_procedures_updated_at() TO anon;
GRANT ALL ON FUNCTION public.touch_procedures_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_procedures_updated_at() TO service_role;


--
-- Name: FUNCTION update_client_memory(p_contact_id uuid, p_new_memory jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_client_memory(p_contact_id uuid, p_new_memory jsonb) TO anon;
GRANT ALL ON FUNCTION public.update_client_memory(p_contact_id uuid, p_new_memory jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.update_client_memory(p_contact_id uuid, p_new_memory jsonb) TO service_role;


--
-- Name: FUNCTION update_conversation_last_message(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_conversation_last_message() TO anon;
GRANT ALL ON FUNCTION public.update_conversation_last_message() TO authenticated;
GRANT ALL ON FUNCTION public.update_conversation_last_message() TO service_role;


--
-- Name: FUNCTION update_conversation_state(p_conversation_id uuid, p_new_state text, p_action text, p_context jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_conversation_state(p_conversation_id uuid, p_new_state text, p_action text, p_context jsonb) TO anon;
GRANT ALL ON FUNCTION public.update_conversation_state(p_conversation_id uuid, p_new_state text, p_action text, p_context jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.update_conversation_state(p_conversation_id uuid, p_new_state text, p_action text, p_context jsonb) TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: TABLE app_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_config TO anon;
GRANT ALL ON TABLE public.app_config TO authenticated;
GRANT ALL ON TABLE public.app_config TO service_role;


--
-- Name: TABLE appointment_reminders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.appointment_reminders TO anon;
GRANT ALL ON TABLE public.appointment_reminders TO authenticated;
GRANT ALL ON TABLE public.appointment_reminders TO service_role;


--
-- Name: TABLE appointments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.appointments TO anon;
GRANT ALL ON TABLE public.appointments TO authenticated;
GRANT ALL ON TABLE public.appointments TO service_role;


--
-- Name: TABLE contact_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contact_photos TO anon;
GRANT ALL ON TABLE public.contact_photos TO authenticated;
GRANT ALL ON TABLE public.contact_photos TO service_role;


--
-- Name: TABLE contacts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contacts TO anon;
GRANT ALL ON TABLE public.contacts TO authenticated;
GRANT ALL ON TABLE public.contacts TO service_role;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversations TO anon;
GRANT ALL ON TABLE public.conversations TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;


--
-- Name: TABLE contacts_with_stats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contacts_with_stats TO anon;
GRANT ALL ON TABLE public.contacts_with_stats TO authenticated;
GRANT ALL ON TABLE public.contacts_with_stats TO service_role;


--
-- Name: TABLE deal_activities; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.deal_activities TO anon;
GRANT ALL ON TABLE public.deal_activities TO authenticated;
GRANT ALL ON TABLE public.deal_activities TO service_role;


--
-- Name: TABLE deals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.deals TO anon;
GRANT ALL ON TABLE public.deals TO authenticated;
GRANT ALL ON TABLE public.deals TO service_role;


--
-- Name: TABLE google_calendar_credentials; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.google_calendar_credentials TO anon;
GRANT ALL ON TABLE public.google_calendar_credentials TO authenticated;
GRANT ALL ON TABLE public.google_calendar_credentials TO service_role;


--
-- Name: TABLE google_calendar_sync_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.google_calendar_sync_log TO anon;
GRANT ALL ON TABLE public.google_calendar_sync_log TO authenticated;
GRANT ALL ON TABLE public.google_calendar_sync_log TO service_role;


--
-- Name: TABLE message_grouping_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.message_grouping_queue TO anon;
GRANT ALL ON TABLE public.message_grouping_queue TO authenticated;
GRANT ALL ON TABLE public.message_grouping_queue TO service_role;


--
-- Name: TABLE nina_cron_status; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nina_cron_status TO anon;
GRANT ALL ON TABLE public.nina_cron_status TO authenticated;
GRANT ALL ON TABLE public.nina_cron_status TO service_role;


--
-- Name: TABLE nina_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nina_settings TO anon;
GRANT ALL ON TABLE public.nina_settings TO authenticated;
GRANT ALL ON TABLE public.nina_settings TO service_role;


--
-- Name: TABLE nina_public_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nina_public_settings TO anon;
GRANT ALL ON TABLE public.nina_public_settings TO authenticated;
GRANT ALL ON TABLE public.nina_public_settings TO service_role;


--
-- Name: TABLE pipeline_stages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pipeline_stages TO anon;
GRANT ALL ON TABLE public.pipeline_stages TO authenticated;
GRANT ALL ON TABLE public.pipeline_stages TO service_role;


--
-- Name: TABLE procedures; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.procedures TO anon;
GRANT ALL ON TABLE public.procedures TO authenticated;
GRANT ALL ON TABLE public.procedures TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE reminder_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reminder_templates TO anon;
GRANT ALL ON TABLE public.reminder_templates TO authenticated;
GRANT ALL ON TABLE public.reminder_templates TO service_role;


--
-- Name: TABLE tag_definitions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tag_definitions TO anon;
GRANT ALL ON TABLE public.tag_definitions TO authenticated;
GRANT ALL ON TABLE public.tag_definitions TO service_role;


--
-- Name: TABLE team_functions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_functions TO anon;
GRANT ALL ON TABLE public.team_functions TO authenticated;
GRANT ALL ON TABLE public.team_functions TO service_role;


--
-- Name: TABLE team_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_members TO anon;
GRANT ALL ON TABLE public.team_members TO authenticated;
GRANT ALL ON TABLE public.team_members TO service_role;


--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teams TO anon;
GRANT ALL ON TABLE public.teams TO authenticated;
GRANT ALL ON TABLE public.teams TO service_role;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--


