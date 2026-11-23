import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { toNumber } from '../_shared/evolution.ts';

// Webhook da Evolution API da Nina (WhatsApp por QR code).
// URL: /functions/v1/evolution-webhook?token=<evolution_token da clínica>
// Eventos: connection.update e messages.upsert. Mensagens seguem o mesmo
// caminho do whatsapp-webhook (Meta): contato → conversa → mensagem →
// message_grouping_queue → message-grouper → nina-orchestrator.

declare const EdgeRuntime: { waitUntil(promise: Promise<any>): void };

const GROUPING_DELAY_MS = 10000;
const ok = (body: unknown = { status: 'ok' }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// Converte a mensagem da Evolution (Baileys) para o formato que o resto do
// sistema já entende (mesmo do webhook da Meta)
function normalize(data: any) {
  const key = data?.key ?? {};
  const m = data?.message ?? {};
  const jidCandidates = [key.remoteJid, key.remoteJidAlt, key.senderPn, data?.remoteJidAlt];
  const jid: string | undefined = jidCandidates.find((j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net'));
  if (!jid) return null;

  const base = {
    id: String(key.id ?? ''),
    from: toNumber(jid.split('@')[0]),
    timestamp: String(data?.messageTimestamp ?? Math.floor(Date.now() / 1000)),
  };

  const text = m.conversation ?? m.extendedTextMessage?.text;
  if (text) return { ...base, type: 'text', text: { body: text }, content: text, mediaType: null };
  if (m.audioMessage) return { ...base, type: 'audio', audio: { id: base.id }, content: '[áudio - processando transcrição...]', mediaType: 'audio' };
  if (m.imageMessage) return { ...base, type: 'image', image: { id: base.id, caption: m.imageMessage.caption }, content: m.imageMessage.caption || '[imagem recebida]', mediaType: 'image' };
  if (m.videoMessage) return { ...base, type: 'video', video: { id: base.id }, content: m.videoMessage.caption || '[vídeo recebido]', mediaType: 'video' };
  if (m.documentMessage) return { ...base, type: 'document', document: { id: base.id }, content: m.documentMessage.fileName || '[documento recebido]', mediaType: 'document' };
  return { ...base, type: String(data?.messageType ?? 'unknown'), content: `[${data?.messageType ?? 'mensagem'}]`, mediaType: null };
}

// Anúncio de clique para o WhatsApp no WhatsApp por QR (Baileys): a origem vem
// em contextInfo.externalAdReply. Converte para o mesmo formato do "referral"
// da API oficial. Nem toda versão do WhatsApp manda o ctwa_clid por aqui.
function adReferral(data: any): Record<string, string> | null {
  const m = data?.message ?? {};
  const infos = [
    data?.contextInfo,
    ...Object.values(m).map((part: any) => part?.contextInfo),
  ].filter(Boolean);
  for (const info of infos) {
    const ad = info?.externalAdReply;
    if (!ad) continue;
    const sourceId = ad.sourceId ?? ad.source_id;
    const clid = ad.ctwaClid ?? ad.ctwa_clid ?? info?.ctwaClid;
    if (!sourceId && !clid) continue;
    const out: Record<string, string> = {};
    if (sourceId) out.source_id = String(sourceId);
    if (clid) out.ctwa_clid = String(clid);
    if (ad.sourceType) out.source_type = String(ad.sourceType);
    if (ad.sourceUrl) out.source_url = String(ad.sourceUrl);
    if (ad.title) out.headline = String(ad.title);
    if (ad.body) out.body = String(ad.body);
    if (ad.mediaType !== undefined) out.media_type = String(ad.mediaType);
    return out;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const token = new URL(req.url).searchParams.get('token');
  if (!token) return new Response('Forbidden', { status: 403 });

  const { data: settings } = await supabase
    .from('nina_settings')
    .select('organization_id, user_id, evolution_instance, evolution_status')
    .eq('evolution_token', token)
    .maybeSingle();
  if (!settings) return new Response('Forbidden', { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return ok({ status: 'ignored' });
  }
  if (body?.instance && body.instance !== settings.evolution_instance) {
    console.warn('[evolution-webhook] instância não confere:', body.instance);
    return new Response('Forbidden', { status: 403 });
  }

  const event = String(body?.event ?? '').toLowerCase().replace('_', '.');
  const orgId = settings.organization_id;

  try {
    if (event === 'connection.update') {
      const state = String(body?.data?.state ?? '');
      const updates: Record<string, unknown> = { evolution_status: state };
      if (state === 'open') {
        updates.whatsapp_provider = 'evolution';
        if (settings.evolution_status !== 'open') updates.evolution_connected_at = new Date().toISOString();
        const wuid = body?.data?.wuid;
        if (typeof wuid === 'string') updates.evolution_phone = toNumber(wuid.split('@')[0]);
      }
      await supabase.from('nina_settings').update(updates).eq('organization_id', orgId);
      return ok();
    }

    if (event !== 'messages.upsert') return ok({ status: 'ignored' });

    const items = Array.isArray(body?.data) ? body.data : [body?.data];
    const phoneNumberId = `evo:${settings.evolution_instance}`;
    const processAfter = new Date(Date.now() + GROUPING_DELAY_MS).toISOString();
    let queued = 0;

    for (const data of items) {
      if (!data?.key || data.key.fromMe) continue; // mensagens enviadas pela própria clínica
      const msg = normalize(data);
      if (!msg || !msg.id || !msg.from) continue; // grupos, status, canais

      const contactName: string | null = data.pushName || null;

      let { data: contact } = await supabase
        .from('contacts')
        .select('*')
        .eq('organization_id', orgId)
        .eq('phone_number', msg.from)
        .maybeSingle();

      if (!contact) {
        const { data: created, error } = await supabase
          .from('contacts')
          .insert({
            organization_id: orgId,
            phone_number: msg.from,
            whatsapp_id: msg.from,
            name: contactName,
            call_name: contactName?.split(' ')[0] || null,
            user_id: null,
          })
          .select()
          .single();
        if (error) {
          console.error('[evolution-webhook] contato:', error);
          continue;
        }
        contact = created;
      } else {
        const updates: Record<string, unknown> = { last_activity: new Date().toISOString() };
        if (contactName && !contact.name) {
          updates.name = contactName;
          updates.call_name = contactName.split(' ')[0];
        }
        await supabase.from('contacts').update(updates).eq('id', contact.id);
      }

      let { data: conversation } = await supabase
        .from('conversations')
        .select('*')
        .eq('contact_id', contact.id)
        .eq('is_active', true)
        .maybeSingle();
      if (!conversation) {
        const { data: created, error } = await supabase
          .from('conversations')
          .insert({ contact_id: contact.id, status: 'nina', is_active: true, user_id: null })
          .select()
          .single();
        if (error) {
          console.error('[evolution-webhook] conversa:', error);
          continue;
        }
        conversation = created;
      }

      const { data: dbMessage, error: msgError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          whatsapp_message_id: msg.id,
          content: msg.content,
          type: ['text', 'audio', 'image', 'video', 'document'].includes(msg.type) ? msg.type : 'text',
          from_type: 'user',
          status: 'sent',
          media_type: msg.mediaType,
          sent_at: new Date(Number(msg.timestamp) * 1000).toISOString(),
          metadata: { original_type: msg.type, media_id: msg.mediaType ? msg.id : null, provider: 'evolution' },
        })
        .select()
        .single();
      if (msgError) {
        if (msgError.code !== '23505') console.error('[evolution-webhook] mensagem:', msgError);
        continue; // 23505 = mensagem repetida
      }

      const referral = adReferral(data);
      if (referral) {
        const { error: touchError } = await supabase.rpc('record_lead_touch', {
          p_org: orgId,
          p_contact: contact.id,
          p_message_id: msg.id,
          p_referral: referral,
          p_channel: 'evolution',
        });
        if (touchError) console.warn('[evolution-webhook] origem do anúncio:', touchError.message);
      }

      if (msg.type === 'image') {
        await supabase.from('contact_photos').insert({
          user_id: settings.user_id,
          contact_id: contact.id,
          conversation_id: conversation.id,
          message_id: dbMessage.id,
          storage_path: `evolution/${msg.id}`,
          storage_url: null,
          caption: (msg as any).image?.caption || null,
          taken_at: dbMessage.sent_at,
        });
      }

      await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id);

      await supabase
        .from('message_grouping_queue')
        .update({ process_after: processAfter })
        .eq('processed', false)
        .eq('phone_number_id', phoneNumberId)
        .filter('message_data->>from', 'eq', msg.from);

      const { error: queueError } = await supabase.from('message_grouping_queue').insert({
        whatsapp_message_id: msg.id,
        phone_number_id: phoneNumberId,
        message_id: dbMessage.id,
        message_data: msg,
        contacts_data: { wa_id: msg.from, profile: { name: contactName } },
        process_after: processAfter,
      });
      if (queueError && queueError.code !== '23505') console.error('[evolution-webhook] fila:', queueError);
      queued++;
    }

    if (queued > 0) {
      EdgeRuntime.waitUntil(
        fetch(`${supabaseUrl}/functions/v1/message-grouper`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ triggered_by: 'evolution-webhook' }),
        }).catch((err) => console.error('[evolution-webhook] message-grouper:', err))
      );
    }
    return ok({ status: 'processed', queued });
  } catch (err) {
    console.error('[evolution-webhook]', err);
    return ok({ status: 'error' }); // 200 para a Evolution não reenviar em loop
  }
});
