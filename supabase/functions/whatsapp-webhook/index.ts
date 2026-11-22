import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GROUPING_DELAY_MS = 10000; // 10 seconds

// Valida o cabeçalho X-Hub-Signature-256 ("sha256=<hex>") enviado pela Meta
async function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string | null | undefined): Promise<boolean> {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  const received = header.slice('sha256='.length).toLowerCase();
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // GET request = Webhook verification from WhatsApp
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      // Todas as clínicas usam a mesma URL de webhook; aceita o token de qualquer uma
      const { data: settings } = token
        ? await supabase
            .from('nina_settings')
            .select('id')
            .eq('whatsapp_verify_token', token)
            .limit(1)
            .maybeSingle()
        : { data: null };

      // App da Meta da plataforma (botão Conectar WhatsApp): token próprio em app_config
      const { data: platform } = token && !settings
        ? await supabase
            .from('app_config')
            .select('key')
            .eq('key', 'meta_webhook_verify_token')
            .eq('value', token)
            .maybeSingle()
        : { data: null };

      if (mode === 'subscribe' && (settings || platform)) {
        console.log('[Webhook] Verification successful');
        return new Response(challenge, { status: 200, headers: corsHeaders });
      } else {
        console.error('[Webhook] Verification failed');
        return new Response('Forbidden', { status: 403, headers: corsHeaders });
      }
    }

    // POST request = Incoming message from WhatsApp
    if (req.method === 'POST') {
      // A assinatura da Meta é calculada sobre o corpo cru: ler antes de interpretar
      const rawBody = await req.text();
      let body: any;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return new Response('Bad request', { status: 400, headers: corsHeaders });
      }

      // A Meta pode juntar várias contas (WABAs) e números no mesmo envio:
      // percorre todas as entradas, não só a primeira.
      const values: any[] = (body.entry ?? [])
        .flatMap((e: any) => (e?.changes ?? []).map((c: any) => c?.value))
        .filter((v: any) => v?.metadata?.phone_number_id);

      if (values.length === 0) {
        console.log('[Webhook] No value in payload, ignoring');
        return new Response(JSON.stringify({ status: 'ignored' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Clínicas donas dos números que receberam as mensagens
      const phoneIds = [...new Set(values.map((v) => String(v.metadata.phone_number_id)))];
      const { data: ownerRows } = await supabase
        .from('nina_settings')
        .select('organization_id, user_id, whatsapp_app_secret, whatsapp_phone_number_id')
        .in('whatsapp_phone_number_id', phoneIds);
      const knownOwners = (ownerRows ?? []).filter((o: any) => o.organization_id);

      if (knownOwners.length === 0) {
        console.warn('[Webhook] Nenhuma clínica com phone_number_id', phoneIds.join(','), '- ignorando');
        return new Response(JSON.stringify({ status: 'ignored', reason: 'unknown_phone_number_id' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Só aceita o que a Meta assinou com o App Secret do app que enviou.
      // Cada clínica pode ter o próprio app ou todas usarem o mesmo app da agência.
      const signatureHeader = req.headers.get('x-hub-signature-256');
      let verifiedSecret: string | null = null;
      for (const secret of new Set(knownOwners.map((o: any) => o.whatsapp_app_secret).filter(Boolean))) {
        if (await verifyMetaSignature(rawBody, signatureHeader, secret as string)) {
          verifiedSecret = secret as string;
          break;
        }
      }
      if (!verifiedSecret) {
        console.warn('[Webhook] Assinatura inválida ou App Secret não cadastrado para', phoneIds.join(','));
        return new Response('Forbidden', { status: 403, headers: corsHeaders });
      }

      let queuedAny = false;

      for (const value of values) {
        const phoneNumberId = String(value.metadata.phone_number_id);
        const messages = value.messages;
        const contacts = value.contacts;

        // Um app só pode falar pelas clínicas que usam o mesmo App Secret
        const ownerSettings = knownOwners.find(
          (o: any) => o.whatsapp_phone_number_id === phoneNumberId && o.whatsapp_app_secret === verifiedSecret,
        );
        if (!ownerSettings) {
          console.warn('[Webhook] Número', phoneNumberId, 'sem clínica para este app - ignorando');
          continue;
        }
        const orgId: string = ownerSettings.organization_id;
        const ownerId: string | null = ownerSettings.user_id || null;

        // Handle status updates (delivered, read, etc)
        if (value.statuses) {
          for (const status of value.statuses) {
            console.log('[Webhook] Status update:', status);
          
            // Update message status in database
            if (status.id) {
              const statusMap: Record<string, string> = {
                'sent': 'sent',
                'delivered': 'delivered',
                'read': 'read',
                'failed': 'failed'
              };
            
              const newStatus = statusMap[status.status];
              if (newStatus) {
                await supabase
                  .from('messages')
                  .update({ 
                    status: newStatus,
                    ...(newStatus === 'delivered' && { delivered_at: new Date().toISOString() }),
                    ...(newStatus === 'read' && { read_at: new Date().toISOString() })
                  })
                  .eq('whatsapp_message_id', status.id);
              }
            }
          }
        }

        // Process incoming messages - CREATE RECORDS IMMEDIATELY
        if (messages && messages.length > 0) {
          const processAfter = new Date(Date.now() + GROUPING_DELAY_MS).toISOString();

          for (const message of messages) {
            const contactInfo = contacts?.find((c: any) => c.wa_id === message.from);
            const phoneNumber = message.from;
            const whatsappId = contactInfo?.wa_id || phoneNumber;
            const contactName = contactInfo?.profile?.name || null;

            // 1. Get or create contact IMMEDIATELY
            let { data: contact } = await supabase
              .from('contacts')
              .select('*')
              .eq('organization_id', orgId)
              .eq('phone_number', phoneNumber)
              .maybeSingle();

            if (!contact) {
              const { data: newContact, error: contactError } = await supabase
                .from('contacts')
                .insert({
                  organization_id: orgId,
                  phone_number: phoneNumber,
                  whatsapp_id: whatsappId,
                  name: contactName,
                  call_name: contactName?.split(' ')[0] || null,
                  user_id: null
                })
                .select()
                .single();

              if (contactError) {
                console.error('[Webhook] Error creating contact:', contactError);
                continue;
              }
              contact = newContact;
              console.log('[Webhook] Created new contact:', contact.id);
            } else {
              // Update contact activity
              const updates: any = { last_activity: new Date().toISOString() };
              if (contactName && !contact.name) {
                updates.name = contactName;
                updates.call_name = contactName.split(' ')[0];
              }
              // Removed user_id update to maintain single-tenant null pattern
            
              await supabase
                .from('contacts')
                .update(updates)
                .eq('id', contact.id);
            }

            // 1b. Veio de anúncio de clique para o WhatsApp? A Meta manda o
            // "referral" (id do anúncio, título, ctwa_clid) na 1ª mensagem.
            if (message.referral && (message.referral.source_id || message.referral.ctwa_clid)) {
              const { error: touchError } = await supabase.rpc('record_lead_touch', {
                p_org: orgId,
                p_contact: contact.id,
                p_message_id: message.id,
                p_referral: message.referral,
                p_channel: 'meta',
              });
              if (touchError) console.warn('[Webhook] Falha ao gravar origem do anúncio:', touchError.message);
              else console.log('[Webhook] Lead de anúncio:', message.referral.source_id);
            }

            // 2. Get or create conversation IMMEDIATELY
            let { data: conversation } = await supabase
              .from('conversations')
              .select('*')
              .eq('contact_id', contact.id)
              .eq('is_active', true)
              .maybeSingle();

            if (!conversation) {
              const { data: newConversation, error: convError } = await supabase
                .from('conversations')
                .insert({
                  contact_id: contact.id,
                  status: 'nina',
                  is_active: true,
                  user_id: null
                })
                .select()
                .single();

              if (convError) {
                console.error('[Webhook] Error creating conversation:', convError);
                continue;
              }
              conversation = newConversation;
              console.log('[Webhook] Created new conversation:', conversation.id);
            }
            // Removed user_id update to maintain single-tenant null pattern

            // 3. Determine message content and type
            let messageContent = '';
            let messageType = 'text';
            let mediaType = null;

            switch (message.type) {
              case 'text':
                messageContent = message.text?.body || '';
                messageType = 'text';
                break;
              case 'image':
                messageContent = message.image?.caption || '[imagem recebida]';
                messageType = 'image';
                mediaType = 'image';
                break;
              case 'audio':
                // Audio will be transcribed by message-grouper
                messageContent = '[áudio - processando transcrição...]';
                messageType = 'audio';
                mediaType = 'audio';
                break;
              case 'video':
                messageContent = message.video?.caption || '[vídeo recebido]';
                messageType = 'video';
                mediaType = 'video';
                break;
              case 'document':
                messageContent = message.document?.filename || '[documento recebido]';
                messageType = 'document';
                mediaType = 'document';
                break;
              default:
                messageContent = `[${message.type}]`;
            }

            // 4. Create message IMMEDIATELY (for realtime updates)
            const { data: dbMessage, error: msgError } = await supabase
              .from('messages')
              .insert({
                conversation_id: conversation.id,
                whatsapp_message_id: message.id,
                content: messageContent,
                type: messageType,
                from_type: 'user',
                status: 'sent',
                media_type: mediaType,
                sent_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
                metadata: { 
                  original_type: message.type,
                  media_id: message.audio?.id || message.image?.id || message.video?.id || message.document?.id || null
                }
              })
              .select()
              .single();

            if (msgError) {
              // If duplicate key error, message was already processed
              if (msgError.code === '23505') {
                console.log('[Webhook] Duplicate message ignored:', message.id);
                continue;
              }
              console.error('[Webhook] Error creating message:', msgError);
              continue;
            }

            console.log('[Webhook] Created message:', dbMessage.id, 'for conversation:', conversation.id);

            // F3.4 — Captura de foto da cliente: arquiva metadata em contact_photos
            // (download do binário fica pra outro job — aqui só registra a referência).
            if (message.type === 'image' && message.image?.id) {
              try {
                await supabase.from('contact_photos').insert({
                  user_id: ownerId,
                  contact_id: contact.id,
                  conversation_id: conversation.id,
                  message_id: dbMessage.id,
                  storage_path: `whatsapp/${message.image.id}`,
                  storage_url: null,
                  caption: message.image.caption || null,
                  taken_at: new Date(parseInt(message.timestamp) * 1000).toISOString()
                });
                console.log('[Webhook] Foto da cliente arquivada em contact_photos');
              } catch (photoErr) {
                console.warn('[Webhook] Falha arquivando foto:', photoErr);
              }
            }

            // 5. Update conversation last_message_at
            await supabase
              .from('conversations')
              .update({ last_message_at: new Date().toISOString() })
              .eq('id', conversation.id);

            // 6. FIRST reset timer for all pending messages from same phone, THEN insert new queue entry
            await supabase
              .from('message_grouping_queue')
              .update({ process_after: processAfter })
              .eq('processed', false)
              .eq('phone_number_id', phoneNumberId)
              .filter('message_data->>from', 'eq', phoneNumber);

            // 7. Insert into message_grouping_queue with message_id reference
            const { error: queueError } = await supabase
              .from('message_grouping_queue')
              .insert({
                whatsapp_message_id: message.id,
                phone_number_id: phoneNumberId,
                message_id: dbMessage.id,
                message_data: message,
                contacts_data: contactInfo || null,
                process_after: processAfter
              });

            if (queueError) {
              if (queueError.code === '23505') {
                console.log('[Webhook] Duplicate queue entry ignored:', message.id);
              } else {
                console.error('[Webhook] Queue insert error:', queueError);
              }
            } else {
              console.log('[Webhook] Message queued:', message.id, 'process_after:', processAfter);
            }
          }

          queuedAny = true;
        }
      }

      // Trigger message-grouper in background (non-blocking)
      if (queuedAny) {
        EdgeRuntime.waitUntil(
          fetch(`${supabaseUrl}/functions/v1/message-grouper`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({ triggered_by: 'whatsapp-webhook' })
          }).catch(err => console.error('[Webhook] Error triggering message-grouper:', err))
        );
      }

      return new Response(JSON.stringify({ status: 'processed' }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  } catch (error) {
    console.error('[Webhook] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
