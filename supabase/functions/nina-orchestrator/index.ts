import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AI_CHAT_URL, getAiApiKey, resolveModel } from "../_shared/ai.ts";
import { DEFAULT_NINA_PROMPT } from "../_shared/default-nina-prompt.ts";
import { isOrgActive } from "../_shared/tenant.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";

// Tool definition for appointment creation — Nina Beleza & Estética
const createAppointmentTool = {
  type: "function",
  function: {
    name: "create_appointment",
    description: "Agendar avaliação, sessão de procedimento, retorno ou recall com a cliente. Use quando a cliente confirmar interesse em uma data/horário específicos para vir à clínica.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Título do agendamento (ex: 'Avaliação Facial', 'Sessão de Botox', 'Drenagem Linfática - sessão 3/10', 'Retorno pós-microagulhamento')"
        },
        date: {
          type: "string",
          description: "Data no formato YYYY-MM-DD. Use a data mencionada pela cliente."
        },
        time: {
          type: "string",
          description: "Horário no formato HH:MM (24h). Ex: '14:00', '09:30'"
        },
        duration: {
          type: "number",
          description: "Duração em minutos. Padrão: 60. Comuns: 30 (avaliação curta), 45 (limpeza simples), 60 (avaliação completa), 90 (procedimento médio), 120 (procedimento longo)"
        },
        type: {
          type: "string",
          enum: ["evaluation", "procedure", "followup", "return"],
          description: "Tipo do agendamento: evaluation (avaliação inicial gratuita ou paga), procedure (sessão do procedimento contratado), followup (retorno pós-procedimento/check-up), return (recall de manutenção)"
        },
        description: {
          type: "string",
          description: "Procedimento/queixa principal e orientações pré (ex: 'Avaliação para botox frontal - vir sem maquiagem', 'Sessão 3/10 drenagem - hidratação na véspera')."
        }
      },
      required: ["title", "date", "time", "type"]
    }
  }
};

// Tool definition for rescheduling appointments
const rescheduleAppointmentTool = {
  type: "function",
  function: {
    name: "reschedule_appointment",
    description: "Reagendar um atendimento existente. Use quando a cliente pedir para mudar a data ou horário de uma avaliação, sessão ou retorno já marcado.",
    parameters: {
      type: "object",
      properties: {
        new_date: {
          type: "string",
          description: "Nova data no formato YYYY-MM-DD"
        },
        new_time: {
          type: "string",
          description: "Novo horário no formato HH:MM (24h). Ex: '14:00', '09:30'"
        },
        reason: {
          type: "string",
          description: "Motivo do reagendamento (opcional, ex: 'imprevisto no trabalho', 'menstruação no dia')"
        }
      },
      required: ["new_date", "new_time"]
    }
  }
};

// Tool definition for canceling appointments
const cancelAppointmentTool = {
  type: "function",
  function: {
    name: "cancel_appointment",
    description: "Cancelar um atendimento existente da cliente. Use quando a cliente pedir para desmarcar uma avaliação, sessão ou retorno. Ofereça remarcar antes de cancelar definitivamente.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Motivo do cancelamento (registrar pra entender objeções recorrentes)"
        }
      },
      required: []
    }
  }
};

// Tool definition for listing procedures — consulta o catálogo da clínica
const listProceduresTool = {
  type: "function",
  function: {
    name: "list_procedures",
    description: "Consultar o catálogo de procedimentos cadastrados da clínica. Use quando a cliente perguntar 'vocês fazem X?', 'que procedimentos vocês têm pra Y?' ou quando você precisar saber duração/contraindicação antes de oferecer agendamento. NUNCA invente procedimentos — sempre consulte aqui primeiro.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["facial", "corporal", "harmonizacao", "capilar", "bem_estar", "pos_operatorio", "outro"],
          description: "Filtrar por categoria. Omita para listar todos."
        },
        name_query: {
          type: "string",
          description: "Buscar por nome ou parte do nome (ex: 'botox', 'limpeza'). Omita para listar todos da categoria."
        }
      },
      required: []
    }
  }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const aiApiKey = getAiApiKey()!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('[Nina] Starting orchestration...');

    // Claim batch of messages to process
    const { data: queueItems, error: claimError } = await supabase
      .rpc('claim_nina_processing_batch', { p_limit: 10 });

    if (claimError) {
      console.error('[Nina] Error claiming batch:', claimError);
      throw claimError;
    }

    if (!queueItems || queueItems.length === 0) {
      console.log('[Nina] No messages to process');
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[Nina] Processing ${queueItems.length} messages`);

    let processed = 0;

    for (const item of queueItems) {
      try {
        // Clínica dona da conversa → configurações dessa clínica
        const { data: conversation } = await supabase
          .from('conversations')
          .select('user_id, organization_id')
          .eq('id', item.conversation_id)
          .single();

        if (!conversation) {
          console.log('[Nina] Conversation not found:', item.conversation_id);
          await supabase
            .from('nina_processing_queue')
            .update({ 
              status: 'failed', 
              processed_at: new Date().toISOString(),
              error_message: 'Conversation not found'
            })
            .eq('id', item.id);
          continue;
        }

        if (!(await isOrgActive(supabase, conversation.organization_id))) {
          console.log('[Nina] Clínica suspensa, não responde:', conversation.organization_id);
          await supabase
            .from('nina_processing_queue')
            .update({
              status: 'completed',
              processed_at: new Date().toISOString(),
              error_message: 'Clínica suspensa'
            })
            .eq('id', item.id);
          continue;
        }

        const { data: settings } = await supabase
          .from('nina_settings')
          .select('*')
          .eq('organization_id', conversation.organization_id)
          .maybeSingle();

        // Use default settings if nothing found
        const effectiveSettings = settings || {
          is_active: true,
          auto_response_enabled: true,
          system_prompt_override: null,
          ai_model_mode: 'flash',
          response_delay_min: 1000,
          response_delay_max: 3000,
          message_breaking_enabled: false,
          audio_response_enabled: false,
          elevenlabs_api_key: null,
          ai_scheduling_enabled: true,
          user_id: conversation.user_id,
          organization_id: conversation.organization_id
        };
        
        if (!settings) {
          console.log('[Nina] No settings found in database, using hardcoded defaults');
        }

        // Check if Nina is active for this user
        if (!effectiveSettings.is_active) {
          console.log('[Nina] Nina is disabled for user:', conversation.user_id);
          await supabase
            .from('nina_processing_queue')
            .update({ 
              status: 'completed', 
              processed_at: new Date().toISOString(),
              error_message: 'Nina disabled for this user'
            })
            .eq('id', item.id);
          continue;
        }

        // Use default prompt if not configured
        const systemPrompt = effectiveSettings.system_prompt_override || getDefaultSystemPrompt();
        
        console.log('[Nina] Processing with settings:', {
          is_active: effectiveSettings.is_active,
          auto_response_enabled: effectiveSettings.auto_response_enabled,
          ai_model_mode: effectiveSettings.ai_model_mode,
          has_system_prompt: !!effectiveSettings.system_prompt_override,
          has_whatsapp_config: !!effectiveSettings.whatsapp_phone_number_id,
          has_elevenlabs: !!effectiveSettings.elevenlabs_api_key,
        });
        
        await processQueueItem(supabase, aiApiKey, item, systemPrompt, effectiveSettings);
        
        // Mark as completed
        await supabase
          .from('nina_processing_queue')
          .update({ 
            status: 'completed', 
            processed_at: new Date().toISOString() 
          })
          .eq('id', item.id);
        
        processed++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Nina] Error processing item ${item.id}:`, error);
        
        // Mark as failed with retry
        const newRetryCount = (item.retry_count || 0) + 1;
        const shouldRetry = newRetryCount < 3;
        
        await supabase
          .from('nina_processing_queue')
          .update({ 
            status: shouldRetry ? 'pending' : 'failed',
            retry_count: newRetryCount,
            error_message: errorMessage,
            scheduled_for: shouldRetry 
              ? new Date(Date.now() + newRetryCount * 30000).toISOString() 
              : null
          })
          .eq('id', item.id);
      }
    }

    console.log(`[Nina] Processed ${processed}/${queueItems.length} messages`);

    return new Response(JSON.stringify({ processed, total: queueItems.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Nina] Orchestrator error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Generate audio using ElevenLabs
async function generateAudioElevenLabs(settings: any, text: string): Promise<ArrayBuffer | null> {
  if (!settings.elevenlabs_api_key) {
    console.log('[Nina] ElevenLabs API key not configured');
    return null;
  }

  try {
    const voiceId = settings.elevenlabs_voice_id || '33B4UnXyTNbgLmdEDh5P'; // Keren - Young Brazilian Female
    const model = settings.elevenlabs_model || 'eleven_turbo_v2_5';

    console.log('[Nina] Generating audio with ElevenLabs, voice:', voiceId);

    const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': settings.elevenlabs_api_key,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: settings.elevenlabs_stability || 0.75,
          similarity_boost: settings.elevenlabs_similarity_boost || 0.80,
          style: settings.elevenlabs_style || 0.30,
          use_speaker_boost: settings.elevenlabs_speaker_boost !== false
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Nina] ElevenLabs error:', response.status, errorText);
      return null;
    }

    return await response.arrayBuffer();
  } catch (error) {
    console.error('[Nina] Error generating audio:', error);
    return null;
  }
}

// Upload audio to Supabase Storage
async function uploadAudioToStorage(
  supabase: any, 
  audioBuffer: ArrayBuffer, 
  conversationId: string
): Promise<string | null> {
  try {
    const fileName = `${conversationId}/${Date.now()}.mp3`;
    
    const { data, error } = await supabase.storage
      .from('audio-messages')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/mpeg',
        cacheControl: '3600'
      });

    if (error) {
      console.error('[Nina] Error uploading audio:', error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('audio-messages')
      .getPublicUrl(fileName);

    console.log('[Nina] Audio uploaded:', urlData.publicUrl);
    return urlData.publicUrl;
  } catch (error) {
    console.error('[Nina] Error uploading audio to storage:', error);
    return null;
  }
}

// Create appointment from AI tool call
// Helper function to parse time string to minutes
function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

async function createAppointmentFromAI(
  supabase: any,
  contactId: string,
  conversationId: string,
  orgId: string | null,
  args: {
    title: string;
    date: string;
    time: string;
    duration?: number;
    type: 'evaluation' | 'procedure' | 'followup' | 'return';
    description?: string;
  }
): Promise<any> {
  console.log('[Nina] Creating appointment from AI:', args, 'for user:', orgId);
  
  // Validate date is not in the past
  const appointmentDate = new Date(`${args.date}T${args.time}:00`);
  const now = new Date();
  
  if (appointmentDate < now) {
    console.log('[Nina] Attempted to create appointment in the past, skipping');
    return { error: 'date_in_past' };
  }
  
  // Check for time conflicts (only for this user's appointments)
  const query = supabase
    .from('appointments')
    .select('id, time, duration, title')
    .eq('date', args.date)
    .eq('status', 'scheduled');
  
  if (orgId) {
    query.eq('organization_id', orgId);
  }
  
  const { data: existingAppointments } = await query;
  
  const requestedStart = parseTimeToMinutes(args.time);
  const requestedDuration = args.duration || 60;
  const requestedEnd = requestedStart + requestedDuration;
  
  for (const existing of existingAppointments || []) {
    const existingStart = parseTimeToMinutes(existing.time);
    const existingEnd = existingStart + (existing.duration || 60);
    
    // Check for overlap: new appointment starts before existing ends AND new appointment ends after existing starts
    if (requestedStart < existingEnd && requestedEnd > existingStart) {
      console.log('[Nina] Time conflict detected with appointment:', existing.id);
      return { 
        error: 'time_conflict', 
        conflictWith: existing.time,
        conflictTitle: existing.title 
      };
    }
  }
  
  const insertData: any = {
    title: args.title,
    date: args.date,
    time: args.time,
    duration: args.duration || 60,
    type: args.type,
    description: args.description || null,
    contact_id: contactId,
    status: 'scheduled',
    metadata: {
      source: 'nina_ai',
      conversation_id: conversationId,
      created_at_conversation: new Date().toISOString()
    }
  };
  
  // Clínica dona do agendamento
  if (orgId) {
    insertData.organization_id = orgId;
  }
  
  const { data, error } = await supabase
    .from('appointments')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    console.error('[Nina] Error creating appointment:', error);
    return { error: error.message };
  }

  console.log('[Nina] Appointment created successfully:', data.id);

  // F3.2 — Sync com Google Calendar (best-effort, não bloqueia)
  syncAppointmentToGoogleCalendar(supabase, data, orgId).catch(err =>
    console.warn('[Nina] Google Calendar sync skipped/failed:', err?.message || err)
  );

  // F3.3 — Agenda lembretes pré/pós procedimento (best-effort, não bloqueia)
  scheduleAppointmentReminders(supabase, data, orgId).catch(err =>
    console.warn('[Nina] Reminders scheduling failed:', err?.message || err)
  );

  return data;
}

// F3.1 — Query do catálogo de procedimentos da clínica
async function queryProcedures(
  supabase: any,
  orgId: string | null,
  args: { category?: string; name_query?: string }
): Promise<any[]> {
  let query = supabase
    .from('procedures')
    .select('id, name, category, description, duration_minutes, price_min, price_max, price_visible, contraindications, pre_care, post_care')
    .eq('is_active', true)
    .limit(20);

  if (args.category) {
    query = query.eq('category', args.category);
  }

  if (args.name_query) {
    query = query.ilike('name', `%${args.name_query}%`);
  }

  if (orgId) {
    query = query.eq('organization_id', orgId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[Nina] queryProcedures error:', error);
    return [];
  }

  // Esconde preço se a clínica configurou price_visible=false
  return (data || []).map((p: any) => {
    if (!p.price_visible) {
      const { price_min: _pm, price_max: _px, ...rest } = p;
      return { ...rest, price_visible: false };
    }
    return p;
  });
}

// F3.2 — Sync de appointment para Google Calendar (best-effort)
// TODO setup externo: configurar OAuth Google Cloud Console e popular
// google_calendar_credentials via fluxo OAuth na UI de configurações.
//
// Para adicionar OUTRO provider (Trinks, iClinic, Vagaro, etc): siga o
// contrato em docs/INTEGRATIONS.md. Padrão: criar funções
// syncAppointmentTo{Provider}, syncRescheduleTo{Provider},
// syncCancelTo{Provider} análogas, e disparar do mesmo lugar
// (createAppointmentFromAI / rescheduleAppointmentFromAI / cancelAppointmentFromAI)
// com .catch() best-effort. Loop guard via appointment.last_sync_source.
async function syncAppointmentToGoogleCalendar(
  supabase: any,
  appointment: any,
  orgId: string | null
): Promise<void> {
  if (!orgId) return;

  // Loop guard: se essa mudança veio do Google via webhook, NÃO devolve pro Google
  if (appointment.last_sync_source === 'google') {
    console.log('[Nina] Skipping sync: appointment originated from Google webhook');
    return;
  }

  const { data: creds } = await supabase
    .from('google_calendar_credentials')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!creds) {
    console.log('[Nina] Google Calendar não configurado, pulando sync');
    return;
  }

  const accessToken = await refreshGoogleAccessTokenIfNeeded(supabase, creds);
  if (!accessToken) {
    console.warn('[Nina] Falha ao obter access token do Google');
    return;
  }

  const startDateTime = `${appointment.date}T${appointment.time}:00-03:00`;
  const endDate = new Date(`${appointment.date}T${appointment.time}:00-03:00`);
  endDate.setMinutes(endDate.getMinutes() + (appointment.duration || 60));
  const endDateTime = endDate.toISOString();

  const event = {
    summary: appointment.title,
    description: appointment.description || '',
    start: { dateTime: startDateTime, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: endDateTime, timeZone: 'America/Sao_Paulo' },
  };

  const calId = encodeURIComponent(creds.calendar_id || 'primary');
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    console.warn('[Nina] Google Calendar create event failed:', resp.status, errText);
    return;
  }

  const gEvent = await resp.json();

  await supabase
    .from('appointments')
    .update({
      google_event_id: gEvent.id,
      google_calendar_id: creds.calendar_id,
      google_synced_at: new Date().toISOString(),
      last_sync_source: 'local'
    })
    .eq('id', appointment.id);

  await supabase
    .from('google_calendar_credentials')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('id', creds.id);

  await logSync(supabase, {
    user_id: creds.user_id,
    credential_id: creds.id,
    appointment_id: appointment.id,
    direction: 'outbound_create',
    google_event_id: gEvent.id,
    status: 'success'
  });

  console.log('[Nina] Appointment sincronizado no Google Calendar:', gEvent.id);
}

// F3.2 two-way — Reschedule local → PATCH no Google
async function syncRescheduleToGoogleCalendar(
  supabase: any,
  appointment: any,
  orgId: string | null
): Promise<void> {
  if (!orgId) return;
  if (appointment.last_sync_source === 'google') {
    console.log('[Nina] Skipping reschedule sync: originated from Google');
    return;
  }
  if (!appointment.google_event_id) {
    // Sem event_id, faz CREATE em vez de UPDATE (cenário: Google ficou indisponível na criação)
    return syncAppointmentToGoogleCalendar(supabase, appointment, orgId);
  }

  const { data: creds } = await supabase
    .from('google_calendar_credentials')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!creds) return;

  const accessToken = await refreshGoogleAccessTokenIfNeeded(supabase, creds);
  if (!accessToken) return;

  const startDateTime = `${appointment.date}T${appointment.time}:00-03:00`;
  const endDate = new Date(`${appointment.date}T${appointment.time}:00-03:00`);
  endDate.setMinutes(endDate.getMinutes() + (appointment.duration || 60));

  const calId = encodeURIComponent(appointment.google_calendar_id || creds.calendar_id || 'primary');
  const eventId = encodeURIComponent(appointment.google_event_id);

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        start: { dateTime: startDateTime, timeZone: 'America/Sao_Paulo' },
        end: { dateTime: endDate.toISOString(), timeZone: 'America/Sao_Paulo' }
      })
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    console.warn('[Nina] Google Calendar PATCH failed:', resp.status, errText);
    await logSync(supabase, {
      user_id: creds.user_id,
      credential_id: creds.id,
      appointment_id: appointment.id,
      direction: 'outbound_update',
      google_event_id: appointment.google_event_id,
      status: 'failed',
      details: { status: resp.status, error: errText }
    });
    return;
  }

  await supabase
    .from('appointments')
    .update({ google_synced_at: new Date().toISOString(), last_sync_source: 'local' })
    .eq('id', appointment.id);

  await logSync(supabase, {
    user_id: creds.user_id,
    credential_id: creds.id,
    appointment_id: appointment.id,
    direction: 'outbound_update',
    google_event_id: appointment.google_event_id,
    status: 'success'
  });

  console.log('[Nina] Reschedule sincronizado no Google:', appointment.google_event_id);
}

// F3.2 two-way — Cancel local → DELETE no Google
async function syncCancelToGoogleCalendar(
  supabase: any,
  appointment: any,
  orgId: string | null
): Promise<void> {
  if (!orgId) return;
  if (appointment.last_sync_source === 'google') {
    console.log('[Nina] Skipping cancel sync: originated from Google');
    return;
  }
  if (!appointment.google_event_id) {
    console.log('[Nina] No google_event_id, nothing to delete');
    return;
  }

  const { data: creds } = await supabase
    .from('google_calendar_credentials')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!creds) return;

  const accessToken = await refreshGoogleAccessTokenIfNeeded(supabase, creds);
  if (!accessToken) return;

  const calId = encodeURIComponent(appointment.google_calendar_id || creds.calendar_id || 'primary');
  const eventId = encodeURIComponent(appointment.google_event_id);

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }
  );

  // 410 Gone = evento já não existe no Google → tratamos como sucesso idempotente
  if (!resp.ok && resp.status !== 410 && resp.status !== 404) {
    const errText = await resp.text();
    console.warn('[Nina] Google Calendar DELETE failed:', resp.status, errText);
    await logSync(supabase, {
      user_id: creds.user_id,
      credential_id: creds.id,
      appointment_id: appointment.id,
      direction: 'outbound_delete',
      google_event_id: appointment.google_event_id,
      status: 'failed',
      details: { status: resp.status, error: errText }
    });
    return;
  }

  await supabase
    .from('appointments')
    .update({ google_synced_at: new Date().toISOString(), last_sync_source: 'local' })
    .eq('id', appointment.id);

  await logSync(supabase, {
    user_id: creds.user_id,
    credential_id: creds.id,
    appointment_id: appointment.id,
    direction: 'outbound_delete',
    google_event_id: appointment.google_event_id,
    status: 'success'
  });

  console.log('[Nina] Cancel sincronizado no Google:', appointment.google_event_id);
}

// Helper: registra evento de sync pra debugging
async function logSync(supabase: any, entry: {
  user_id: string;
  credential_id?: string;
  appointment_id?: string;
  direction: string;
  google_event_id?: string;
  status: 'success' | 'failed' | 'skipped';
  details?: any;
}): Promise<void> {
  try {
    await supabase.from('google_calendar_sync_log').insert(entry);
  } catch (err) {
    console.warn('[Nina] Failed to write sync log:', err);
  }
}

async function refreshGoogleAccessTokenIfNeeded(supabase: any, creds: any): Promise<string | null> {
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    console.warn('[Nina] GOOGLE_OAUTH_CLIENT_ID/SECRET não configurados — TODO setup externo');
    return null;
  }

  const expiresAt = creds.token_expires_at ? new Date(creds.token_expires_at) : null;
  if (creds.access_token && expiresAt && expiresAt.getTime() > Date.now() + 60_000) {
    return creds.access_token;
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token'
    })
  });

  if (!resp.ok) {
    console.warn('[Nina] Failed to refresh Google token:', resp.status);
    return null;
  }

  const tokenData = await resp.json();
  const newExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

  await supabase
    .from('google_calendar_credentials')
    .update({
      access_token: tokenData.access_token,
      token_expires_at: newExpiresAt
    })
    .eq('id', creds.id);

  return tokenData.access_token;
}

// F3.3 — Agenda lembretes pré/pós procedimento
async function scheduleAppointmentReminders(
  supabase: any,
  appointment: any,
  orgId: string | null
): Promise<void> {
  const apptDate = new Date(`${appointment.date}T${appointment.time}:00-03:00`);
  const now = new Date();

  // Categoria do procedimento (best-effort por título)
  const titleLower = (appointment.title || '').toLowerCase();
  let category: string | null = null;
  if (/botox|preench|harm/.test(titleLower)) category = 'harmonizacao';
  else if (/facial|peeling|microagul|limpeza/.test(titleLower)) category = 'facial';
  else if (/drenag|criolip|radiofreq|modelad/.test(titleLower)) category = 'corporal';

  const reminderTypes: Array<{ type: string; offsetMs: number }> = [
    { type: 'pre_24h', offsetMs: -24 * 60 * 60 * 1000 },
    { type: 'pre_2h', offsetMs: -2 * 60 * 60 * 1000 },
    { type: 'post_24h', offsetMs: 24 * 60 * 60 * 1000 },
    { type: 'post_7d_nps', offsetMs: 7 * 24 * 60 * 60 * 1000 },
    { type: 'recall_30d', offsetMs: 30 * 24 * 60 * 60 * 1000 },
  ];

  for (const r of reminderTypes) {
    const scheduledFor = new Date(apptDate.getTime() + r.offsetMs);
    if (scheduledFor.getTime() < now.getTime()) continue;

    // Busca template (preferência: categoria específica → fallback genérico)
    const { data: tmpl } = await supabase
      .from('reminder_templates')
      .select('template_body')
      .eq('organization_id', orgId)
      .eq('reminder_type', r.type)
      .or(`procedure_category.eq.${category},procedure_category.is.null`)
      .eq('is_active', true)
      .order('procedure_category', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (!tmpl) continue;

    await supabase.from('appointment_reminders').insert({
      user_id: appointment.user_id ?? null,
      appointment_id: appointment.id,
      contact_id: appointment.contact_id,
      reminder_type: r.type,
      scheduled_for: scheduledFor.toISOString(),
      message_body: tmpl.template_body,
      status: 'scheduled'
    });
  }

  console.log('[Nina] Lembretes agendados para appointment:', appointment.id);
}

// Reschedule an existing appointment
async function rescheduleAppointmentFromAI(
  supabase: any,
  contactId: string,
  orgId: string | null,
  args: {
    new_date: string;
    new_time: string;
    reason?: string;
  }
): Promise<any> {
  console.log('[Nina] Rescheduling appointment for contact:', contactId, 'user:', orgId, args);
  
  // Find the most recent scheduled appointment for this contact
  const query = supabase
    .from('appointments')
    .select('*')
    .eq('contact_id', contactId)
    .eq('status', 'scheduled')
    .order('date', { ascending: true })
    .order('time', { ascending: true })
    .limit(1);
  
  if (orgId) {
    query.eq('organization_id', orgId);
  }
  
  const { data: existingAppointments } = await query;
  
  if (!existingAppointments || existingAppointments.length === 0) {
    console.log('[Nina] No appointment found to reschedule');
    return { error: 'no_appointment_found' };
  }
  
  const appointment = existingAppointments[0];
  
  // Validate new date is not in the past
  const newAppointmentDate = new Date(`${args.new_date}T${args.new_time}:00`);
  const now = new Date();
  
  if (newAppointmentDate < now) {
    console.log('[Nina] Attempted to reschedule to a past date');
    return { error: 'date_in_past' };
  }
  
  // Check for conflicts at new time (only for this user's appointments)
  const conflictQuery = supabase
    .from('appointments')
    .select('id, time, duration, title')
    .eq('date', args.new_date)
    .eq('status', 'scheduled')
    .neq('id', appointment.id);
  
  if (orgId) {
    conflictQuery.eq('organization_id', orgId);
  }
  
  const { data: conflictingAppointments } = await conflictQuery;
  
  const requestedStart = parseTimeToMinutes(args.new_time);
  const requestedEnd = requestedStart + (appointment.duration || 60);
  
  for (const existing of conflictingAppointments || []) {
    const existingStart = parseTimeToMinutes(existing.time);
    const existingEnd = existingStart + (existing.duration || 60);
    
    if (requestedStart < existingEnd && requestedEnd > existingStart) {
      console.log('[Nina] Time conflict detected at new time');
      return { 
        error: 'time_conflict', 
        conflictWith: existing.time,
        conflictTitle: existing.title 
      };
    }
  }
  
  // Update the appointment
  const { data, error } = await supabase
    .from('appointments')
    .update({
      date: args.new_date,
      time: args.new_time,
      metadata: {
        ...appointment.metadata,
        rescheduled_at: new Date().toISOString(),
        rescheduled_reason: args.reason || null,
        previous_date: appointment.date,
        previous_time: appointment.time
      }
    })
    .eq('id', appointment.id)
    .select()
    .single();
  
  if (error) {
    console.error('[Nina] Error rescheduling appointment:', error);
    return { error: error.message };
  }
  
  console.log('[Nina] Appointment rescheduled successfully:', data.id);

  // F3.2 two-way — Propaga reschedule pro Google (best-effort, não bloqueia)
  syncRescheduleToGoogleCalendar(supabase, data, orgId).catch(err =>
    console.warn('[Nina] Google Calendar reschedule sync failed:', err?.message || err)
  );

  return { ...data, previous_date: appointment.date, previous_time: appointment.time };
}

// Cancel an existing appointment
async function cancelAppointmentFromAI(
  supabase: any,
  contactId: string,
  orgId: string | null,
  args: {
    reason?: string;
  }
): Promise<any> {
  console.log('[Nina] Canceling appointment for contact:', contactId, 'user:', orgId);
  
  // Find the most recent scheduled appointment for this contact
  const query = supabase
    .from('appointments')
    .select('*')
    .eq('contact_id', contactId)
    .eq('status', 'scheduled')
    .order('date', { ascending: true })
    .order('time', { ascending: true })
    .limit(1);
  
  if (orgId) {
    query.eq('organization_id', orgId);
  }
  
  const { data: existingAppointments } = await query;
  
  if (!existingAppointments || existingAppointments.length === 0) {
    console.log('[Nina] No appointment found to cancel');
    return { error: 'no_appointment_found' };
  }
  
  const appointment = existingAppointments[0];
  
  // Update status to cancelled
  const { data, error } = await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      metadata: {
        ...appointment.metadata,
        cancelled_at: new Date().toISOString(),
        cancelled_reason: args.reason || null,
        cancelled_by: 'nina_ai'
      }
    })
    .eq('id', appointment.id)
    .select()
    .single();
  
  if (error) {
    console.error('[Nina] Error canceling appointment:', error);
    return { error: error.message };
  }
  
  console.log('[Nina] Appointment cancelled successfully:', data.id);

  // F3.2 two-way — Propaga cancelamento pro Google (best-effort, não bloqueia)
  syncCancelToGoogleCalendar(supabase, data, orgId).catch(err =>
    console.warn('[Nina] Google Calendar cancel sync failed:', err?.message || err)
  );

  return data;
}

async function processQueueItem(
  supabase: any,
  aiApiKey: string,
  item: any,
  systemPrompt: string,
  settings: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  console.log(`[Nina] Processing queue item: ${item.id}`);

  // Get the message
  const { data: message } = await supabase
    .from('messages')
    .select('*')
    .eq('id', item.message_id)
    .maybeSingle();

  if (!message) {
    throw new Error('Message not found');
  }

  // Get conversation with contact info
  const { data: conversation } = await supabase
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', item.conversation_id)
    .maybeSingle();

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Check if conversation is still in Nina mode
  if (conversation.status !== 'nina') {
    console.log('[Nina] Conversation no longer in Nina mode, skipping');
    return;
  }

  // Check if auto-response is enabled
  if (!settings?.auto_response_enabled) {
    console.log('[Nina] Auto-response disabled, marking as processed without responding');
    await supabase
      .from('messages')
      .update({ processed_by_nina: true })
      .eq('id', message.id);
    return;
  }

  // Get recent messages for context (last 20)
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversation.id)
    .order('sent_at', { ascending: false })
    .limit(20);

  // Build conversation history for AI
  const conversationHistory = (recentMessages || [])
    .reverse()
    .map((msg: any) => ({
      role: msg.from_type === 'user' ? 'user' : 'assistant',
      content: msg.content || '[media]'
    }));

  // Get client memory
  const clientMemory = conversation.contact?.client_memory || {};

  // Build enhanced system prompt with context
  const enhancedSystemPrompt = buildEnhancedPrompt(
    systemPrompt, 
    conversation.contact, 
    clientMemory
  );

  // Process template variables ({{ data_hora }}, {{ dia_semana }}, etc.)
  const processedPrompt = processPromptTemplate(enhancedSystemPrompt, conversation.contact, settings);

  console.log('[Nina] Calling Gemini...');

  // Get AI model settings based on user configuration
  const aiSettings = getModelSettings(settings, conversationHistory, message, conversation.contact, clientMemory);

  console.log('[Nina] Using AI settings:', aiSettings);

  // Build tools array - only add appointment tools if enabled
  const tools: any[] = [];
  if (settings?.ai_scheduling_enabled !== false) {
    tools.push(createAppointmentTool);
    tools.push(rescheduleAppointmentTool);
    tools.push(cancelAppointmentTool);
    console.log('[Nina] AI scheduling enabled, adding appointment tools (create, reschedule, cancel)');
  }
  // Catálogo de procedimentos sempre disponível (Nina deve consultar antes de inventar)
  if (settings?.procedures_catalog_enabled !== false) {
    tools.push(listProceduresTool);
    console.log('[Nina] Adding list_procedures tool');
  }

  // Build request body
  const requestBody: any = {
    model: resolveModel(aiSettings.model),
    messages: [
      { role: 'system', content: processedPrompt },
      ...conversationHistory
    ],
    temperature: aiSettings.temperature,
    max_tokens: 1000
  };

  // Only add tools if we have any
  if (tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = "auto";
  }

  // Call Gemini (OpenAI-compatible endpoint)
  const aiResponse = await fetch(AI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${aiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error('[Nina] AI response error:', aiResponse.status, errorText);
    
    if (aiResponse.status === 429) {
      throw new Error('Rate limit exceeded, will retry later');
    }
    if (aiResponse.status === 402) {
      throw new Error('Payment required - please add credits');
    }
    throw new Error(`AI error: ${aiResponse.status}`);
  }

  const aiData = await aiResponse.json();
  const aiMessage = aiData.choices?.[0]?.message;
  let aiContent = aiMessage?.content || '';
  const toolCalls = aiMessage?.tool_calls || [];

  console.log('[Nina] AI response received, content length:', aiContent?.length || 0, ', tool_calls:', toolCalls.length);

  // Process tool calls
  let appointmentCreated = null;
  let appointmentRescheduled = null;
  let appointmentCancelled = null;
  
  for (const toolCall of toolCalls) {
    if (toolCall.function?.name === 'create_appointment') {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        console.log('[Nina] Processing create_appointment tool call:', args);
        
        appointmentCreated = await createAppointmentFromAI(
          supabase, 
          conversation.contact_id,
          conversation.id,
          settings?.organization_id || null,
          args
        );
        
        // Add confirmation to response if appointment was created successfully
        if (appointmentCreated && !appointmentCreated.error) {
          const dateFormatted = args.date.split('-').reverse().join('/');
          const confirmationMsg = `\n\n✅ Agendamento confirmado para ${dateFormatted} às ${args.time}!`;
          aiContent = (aiContent || '') + confirmationMsg;
          console.log('[Nina] Appointment confirmation added to response');
        } else if (appointmentCreated?.error === 'date_in_past') {
          aiContent = (aiContent || '') + '\n\n⚠️ Não foi possível agendar para uma data passada. Por favor, escolha uma data futura.';
        } else if (appointmentCreated?.error === 'time_conflict') {
          aiContent = (aiContent || '') + `\n\n⚠️ Já existe um agendamento para esse horário (${appointmentCreated.conflictWith}). Podemos agendar em outro horário?`;
        }
      } catch (parseError) {
        console.error('[Nina] Error parsing create_appointment arguments:', parseError);
      }
    }
    
    if (toolCall.function?.name === 'reschedule_appointment') {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        console.log('[Nina] Processing reschedule_appointment tool call:', args);
        
        appointmentRescheduled = await rescheduleAppointmentFromAI(
          supabase,
          conversation.contact_id,
          settings?.organization_id || null,
          args
        );
        
        if (appointmentRescheduled && !appointmentRescheduled.error) {
          const newDateFormatted = args.new_date.split('-').reverse().join('/');
          const oldDateFormatted = appointmentRescheduled.previous_date.split('-').reverse().join('/');
          const confirmationMsg = `\n\n✅ Agendamento reagendado! De ${oldDateFormatted} às ${appointmentRescheduled.previous_time} para ${newDateFormatted} às ${args.new_time}.`;
          aiContent = (aiContent || '') + confirmationMsg;
          console.log('[Nina] Reschedule confirmation added to response');
        } else if (appointmentRescheduled?.error === 'no_appointment_found') {
          aiContent = (aiContent || '') + '\n\n⚠️ Não encontrei nenhum agendamento ativo para você. Deseja criar um novo?';
        } else if (appointmentRescheduled?.error === 'date_in_past') {
          aiContent = (aiContent || '') + '\n\n⚠️ Não foi possível reagendar para uma data passada. Por favor, escolha uma data futura.';
        } else if (appointmentRescheduled?.error === 'time_conflict') {
          aiContent = (aiContent || '') + `\n\n⚠️ Já existe um agendamento para esse horário (${appointmentRescheduled.conflictWith}). Podemos reagendar para outro horário?`;
        }
      } catch (parseError) {
        console.error('[Nina] Error parsing reschedule_appointment arguments:', parseError);
      }
    }
    
    if (toolCall.function?.name === 'cancel_appointment') {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        console.log('[Nina] Processing cancel_appointment tool call:', args);

        appointmentCancelled = await cancelAppointmentFromAI(
          supabase,
          conversation.contact_id,
          settings?.organization_id || null,
          args
        );

        if (appointmentCancelled && !appointmentCancelled.error) {
          const dateFormatted = appointmentCancelled.date.split('-').reverse().join('/');
          const confirmationMsg = `\n\n✅ Agendamento de ${dateFormatted} às ${appointmentCancelled.time} foi cancelado com sucesso.`;
          aiContent = (aiContent || '') + confirmationMsg;
          console.log('[Nina] Cancel confirmation added to response');
        } else if (appointmentCancelled?.error === 'no_appointment_found') {
          aiContent = (aiContent || '') + '\n\n⚠️ Não encontrei nenhum agendamento ativo para cancelar.';
        }
      } catch (parseError) {
        console.error('[Nina] Error parsing cancel_appointment arguments:', parseError);
      }
    }
  }

  // list_procedures é informativa — Nina precisa receber o resultado e responder
  // num segundo turn de AI com os procedimentos em mãos.
  const listProcCall = toolCalls.find((t: any) => t.function?.name === 'list_procedures');
  if (listProcCall && !aiContent) {
    try {
      const args = JSON.parse(listProcCall.function.arguments || '{}');
      const procedures = await queryProcedures(supabase, settings?.organization_id || null, args);
      console.log(`[Nina] list_procedures retornou ${procedures.length} procedimentos`);

      const secondResponse = await fetch(AI_CHAT_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${aiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: resolveModel(aiSettings.model),
          messages: [
            { role: 'system', content: processedPrompt },
            ...conversationHistory,
            aiMessage,
            {
              role: 'tool',
              tool_call_id: listProcCall.id,
              content: JSON.stringify({ procedures })
            }
          ],
          temperature: aiSettings.temperature,
          max_tokens: 1000
        })
      });

      if (secondResponse.ok) {
        const secondData = await secondResponse.json();
        aiContent = secondData.choices?.[0]?.message?.content || aiContent;
        console.log('[Nina] Segunda chamada após list_procedures concluída');
      } else {
        console.error('[Nina] Erro na segunda chamada após list_procedures:', secondResponse.status);
      }
    } catch (err) {
      console.error('[Nina] Erro processando list_procedures:', err);
    }
  }

  // If no content and we only got tool calls, generate a default response
  if (!aiContent && toolCalls.length > 0) {
    if (appointmentCreated && !appointmentCreated.error) {
      aiContent = `Perfeito! Já agendei para você. ✅ Agendamento confirmado para ${appointmentCreated.date.split('-').reverse().join('/')} às ${appointmentCreated.time}!`;
    } else if (appointmentRescheduled && !appointmentRescheduled.error) {
      aiContent = `Pronto! ✅ Seu agendamento foi reagendado para ${appointmentRescheduled.date.split('-').reverse().join('/')} às ${appointmentRescheduled.time}.`;
    } else if (appointmentCancelled && !appointmentCancelled.error) {
      aiContent = `Certo! ✅ Seu agendamento foi cancelado com sucesso. Se precisar de algo mais, estou à disposição!`;
    } else {
      aiContent = 'Entendi! Como posso ajudar?';
    }
  }

  // Fallback for empty AI response - use default greeting instead of throwing error
  if (!aiContent) {
    console.warn('[Nina] Empty AI response received, using fallback');
    aiContent = 'Olá! Como posso ajudar você hoje? 😊';
  }

  console.log('[Nina] Final response length:', aiContent.length);

  // Calculate response time
  const responseTime = Date.now() - new Date(message.sent_at).getTime();

  // Update original message as processed
  await supabase
    .from('messages')
    .update({ 
      processed_by_nina: true,
      nina_response_time: responseTime
    })
    .eq('id', message.id);

  // Add response delay if configured
  const delayMin = settings?.response_delay_min || 1000;
  const delayMax = settings?.response_delay_max || 3000;
  const delay = Math.random() * (delayMax - delayMin) + delayMin;

  // Check if audio response should be sent - pure mirroring: only respond with audio if incoming was audio
  const incomingWasAudio = message.type === 'audio';
  const shouldSendAudio = incomingWasAudio && settings?.elevenlabs_api_key;

  if (shouldSendAudio) {
    console.log(`[Nina] Audio response enabled (incoming was audio: ${incomingWasAudio})`);
    
    const audioBuffer = await generateAudioElevenLabs(settings, aiContent);
    
    if (audioBuffer) {
      const audioUrl = await uploadAudioToStorage(supabase, audioBuffer, conversation.id);
      
      if (audioUrl) {
        const { error: sendQueueError } = await supabase
          .from('send_queue')
          .insert({
            conversation_id: conversation.id,
            contact_id: conversation.contact_id,
            content: aiContent,
            from_type: 'nina',
            message_type: 'audio',
            media_url: audioUrl,
            priority: 1,
            scheduled_at: new Date(Date.now() + delay).toISOString(),
            metadata: {
              response_to_message_id: message.id,
              ai_model: aiSettings.model,
              audio_generated: true,
              text_content: aiContent,
              appointment_created: appointmentCreated?.id || null
            }
          });

        if (sendQueueError) {
          console.error('[Nina] Error queuing audio response:', sendQueueError);
          throw sendQueueError;
        }

        console.log('[Nina] Audio response queued for sending');
      } else {
        console.log('[Nina] Failed to upload audio, falling back to text');
        await queueTextResponse(supabase, conversation, message, aiContent, settings, aiSettings, delay, appointmentCreated);
      }
    } else {
      console.log('[Nina] Failed to generate audio, falling back to text');
      await queueTextResponse(supabase, conversation, message, aiContent, settings, aiSettings, delay, appointmentCreated);
    }
  } else {
    await queueTextResponse(supabase, conversation, message, aiContent, settings, aiSettings, delay, appointmentCreated);
  }

  // Trigger whatsapp-sender
  try {
    const senderUrl = `${supabaseUrl}/functions/v1/whatsapp-sender`;
    console.log('[Nina] Triggering whatsapp-sender at:', senderUrl);
    
    fetch(senderUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ triggered_by: 'nina-orchestrator' })
    }).catch(err => console.error('[Nina] Error triggering whatsapp-sender:', err));
  } catch (err) {
    console.error('[Nina] Failed to trigger whatsapp-sender:', err);
  }

  // Trigger analyze-conversation
  fetch(`${supabaseUrl}/functions/v1/analyze-conversation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseServiceKey}`
    },
    body: JSON.stringify({
      contact_id: conversation.contact_id,
      conversation_id: conversation.id,
      user_message: message.content,
      ai_response: aiContent,
      current_memory: clientMemory
    })
  }).catch(err => console.error('[Nina] Error triggering analyze-conversation:', err));
}

// Helper function to queue text response with chunking
async function queueTextResponse(
  supabase: any,
  conversation: any,
  message: any,
  aiContent: string,
  settings: any,
  aiSettings: any,
  delay: number,
  appointmentCreated?: any
) {
  // Break message into chunks if enabled
  const messageChunks = settings?.message_breaking_enabled 
    ? breakMessageIntoChunks(aiContent)
    : [aiContent];

  console.log(`[Nina] Sending ${messageChunks.length} text message chunk(s)`);

  // Queue each chunk for sending
  for (let i = 0; i < messageChunks.length; i++) {
    const chunkDelay = delay + (i * 1500);
    
    const { error: sendQueueError } = await supabase
      .from('send_queue')
      .insert({
        conversation_id: conversation.id,
        contact_id: conversation.contact_id,
        content: messageChunks[i],
        from_type: 'nina',
        message_type: 'text',
        priority: 1,
        scheduled_at: new Date(Date.now() + chunkDelay).toISOString(),
        metadata: {
          response_to_message_id: message.id,
          ai_model: aiSettings.model,
          chunk_index: i,
          total_chunks: messageChunks.length,
          appointment_created: appointmentCreated?.id || null
        }
      });

    if (sendQueueError) {
      console.error('[Nina] Error queuing response chunk:', sendQueueError);
      throw sendQueueError;
    }
  }

  console.log('[Nina] Text response(s) queued for sending');
}

function getDefaultSystemPrompt(): string {
  return DEFAULT_NINA_PROMPT;
}

function processPromptTemplate(prompt: string, contact: any, settings?: any): string {
  const now = new Date();
  const brOptions: Intl.DateTimeFormatOptions = { timeZone: 'America/Sao_Paulo' };
  
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', { 
    ...brOptions, 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric' 
  });
  const timeFormatter = new Intl.DateTimeFormat('pt-BR', { 
    ...brOptions, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false
  });
  const weekdayFormatter = new Intl.DateTimeFormat('pt-BR', { 
    ...brOptions, 
    weekday: 'long' 
  });
  
  const variables: Record<string, string> = {
    'data_hora': `${dateFormatter.format(now)} ${timeFormatter.format(now)}`,
    'data': dateFormatter.format(now),
    'hora': timeFormatter.format(now),
    'dia_semana': weekdayFormatter.format(now),
    'cliente_nome': contact?.name || contact?.call_name || 'Cliente',
    'cliente_telefone': contact?.phone_number || '',
    'clinica_nome': settings?.company_name || 'nossa clínica',
    'profissional': 'equipe',
  };
  
  return prompt.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, varName) => {
    return variables[varName] || match;
  });
}

function buildEnhancedPrompt(basePrompt: string, contact: any, memory: any): string {
  let contextInfo = '';

  if (contact) {
    contextInfo += `\n\nCONTEXTO DO CLIENTE:`;
    if (contact.name) contextInfo += `\n- Nome: ${contact.name}`;
    if (contact.call_name) contextInfo += ` (trate por: ${contact.call_name})`;
    if (contact.tags?.length) contextInfo += `\n- Tags: ${contact.tags.join(', ')}`;
  }

  if (memory && Object.keys(memory).length > 0) {
    contextInfo += `\n\nMEMÓRIA DO CLIENTE:`;
    
    if (memory.lead_profile) {
      const lp = memory.lead_profile;
      if (lp.interests?.length) contextInfo += `\n- Interesses: ${lp.interests.join(', ')}`;
      if (lp.products_discussed?.length) contextInfo += `\n- Produtos discutidos: ${lp.products_discussed.join(', ')}`;
      if (lp.lead_stage) contextInfo += `\n- Estágio: ${lp.lead_stage}`;
    }
    
    if (memory.sales_intelligence) {
      const si = memory.sales_intelligence;
      if (si.pain_points?.length) contextInfo += `\n- Dores: ${si.pain_points.join(', ')}`;
      if (si.next_best_action) contextInfo += `\n- Próxima ação sugerida: ${si.next_best_action}`;
    }
  }

  return basePrompt + contextInfo;
}

function breakMessageIntoChunks(content: string): string[] {
  const chunks = content
    .split(/\n\n+/)
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.length > 0);
  
  return chunks.length > 0 ? chunks : [content];
}

function getModelSettings(
  settings: any,
  conversationHistory: any[],
  message: any,
  contact: any,
  clientMemory: any
): { model: string; temperature: number } {
  const modelMode = settings?.ai_model_mode || 'flash';
  
  switch (modelMode) {
    case 'flash':
      return { model: 'google/gemini-2.5-flash', temperature: 0.7 };
    case 'pro':
      return { model: 'google/gemini-2.5-pro', temperature: 0.7 };
    case 'pro3':
      return { model: 'google/gemini-3-pro-preview', temperature: 0.7 };
    case 'adaptive':
      return getAdaptiveSettings(conversationHistory, message, contact, clientMemory);
    default:
      return { model: 'google/gemini-2.5-flash', temperature: 0.7 };
  }
}

function getAdaptiveSettings(
  conversationHistory: any[], 
  message: any, 
  contact: any,
  clientMemory: any
): { model: string; temperature: number } {
  const defaultSettings = {
    model: 'google/gemini-2.5-flash',
    temperature: 0.7
  };

  const messageCount = conversationHistory.length;
  const userContent = message.content?.toLowerCase() || '';
  
  const isComplaintKeywords = ['problema', 'erro', 'não funciona', 'reclamação', 'péssimo', 'horrível'];
  const isSalesKeywords = ['preço', 'valor', 'desconto', 'comprar', 'contratar', 'plano'];
  const isTechnicalKeywords = ['como funciona', 'integração', 'api', 'configurar', 'instalar'];
  const isUrgentKeywords = ['urgente', 'agora', 'rápido', 'emergência'];

  const isComplaint = isComplaintKeywords.some(k => userContent.includes(k));
  const isSales = isSalesKeywords.some(k => userContent.includes(k));
  const isTechnical = isTechnicalKeywords.some(k => userContent.includes(k));
  const isUrgent = isUrgentKeywords.some(k => userContent.includes(k));
  
  const leadStage = clientMemory?.lead_profile?.lead_stage;
  const qualificationScore = clientMemory?.lead_profile?.qualification_score || 0;

  if (isComplaint || isUrgent) {
    return {
      model: 'google/gemini-2.5-pro',
      temperature: 0.3
    };
  }

  if (isSales && qualificationScore > 50) {
    return {
      model: 'google/gemini-2.5-flash',
      temperature: 0.5
    };
  }

  if (isTechnical) {
    return {
      model: 'google/gemini-2.5-pro',
      temperature: 0.4
    };
  }

  if (messageCount < 5) {
    return {
      model: 'google/gemini-2.5-flash',
      temperature: 0.8
    };
  }

  if (messageCount > 15) {
    return {
      model: 'google/gemini-2.5-flash',
      temperature: 0.5
    };
  }

  return defaultSettings;
}
