import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { evo, evolutionConfigured, toNumber } from '../_shared/evolution.ts';

// Conexão do WhatsApp por QR code (Evolution API exclusiva da Nina).
// Pode chamar: o dono da plataforma (informando organization_id) ou a admin
// da própria clínica (sem organization_id).
//
// POST { action: 'status' | 'connect' | 'disconnect', organization_id? }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

class UserError extends Error {}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

async function resolveOrg(supabase: any, userId: string, requested?: string): Promise<{ orgId: string; isOwner: boolean }> {
  const { data: profile } = await supabase.from('profiles').select('is_platform_owner').eq('user_id', userId).maybeSingle();
  const isOwner = !!profile?.is_platform_owner;

  if (requested) {
    if (!isOwner) throw new UserError('Acesso restrito ao dono da plataforma.');
    return { orgId: requested, isOwner };
  }

  const { data: member } = await supabase
    .from('organization_members')
    .select('organization_id, role, organizations!inner(status)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!member) throw new UserError('Seu usuário não está vinculado a uma clínica.');
  if (member.role !== 'admin') throw new UserError('Só a administradora da clínica pode conectar o WhatsApp.');
  if (member.organizations?.status !== 'active') throw new UserError('O acesso da clínica está suspenso.');
  return { orgId: member.organization_id, isOwner };
}

async function readState(instance: string) {
  const { ok, status, data } = await evo(`/instance/connectionState/${instance}`);
  if (status === 404) return { exists: false, state: 'close' };
  if (!ok) throw new Error(`connectionState ${status}`);
  return { exists: true, state: String(data?.instance?.state ?? 'close') };
}

async function readPhone(instance: string): Promise<string | null> {
  const { data } = await evo(`/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`);
  const item = Array.isArray(data) ? data[0] : null;
  const jid: string | null = item?.ownerJid ?? item?.number ?? null;
  return jid ? toNumber(jid.split('@')[0]) : null;
}

// Atualiza o banco com o estado real da Evolution e devolve o resumo para a tela
async function syncStatus(supabase: any, orgId: string, settings: any) {
  if (!settings?.evolution_instance) {
    return { provider: settings?.whatsapp_provider ?? 'meta', status: 'none', phone: null };
  }
  const { exists, state } = await readState(settings.evolution_instance);
  const updates: Record<string, unknown> = { evolution_status: exists ? state : 'close' };
  let phone = settings.evolution_phone;
  if (state === 'open') {
    phone = (await readPhone(settings.evolution_instance)) ?? phone;
    updates.evolution_phone = phone;
    updates.whatsapp_provider = 'evolution';
    if (settings.evolution_status !== 'open') updates.evolution_connected_at = new Date().toISOString();
  }
  await supabase.from('nina_settings').update(updates).eq('organization_id', orgId);
  return {
    provider: (updates.whatsapp_provider as string) ?? settings.whatsapp_provider,
    status: updates.evolution_status,
    phone,
  };
}

async function connect(supabase: any, orgId: string, settings: any) {
  // Já tem instância: reaproveita (gera um QR novo se não estiver conectada)
  if (settings.evolution_instance) {
    const { exists, state } = await readState(settings.evolution_instance);
    if (exists && state === 'open') return { ...(await syncStatus(supabase, orgId, settings)), qr: null };
    if (exists) {
      const { ok, data } = await evo(`/instance/connect/${settings.evolution_instance}`);
      if (ok && data?.base64) {
        await supabase.from('nina_settings').update({ evolution_status: 'connecting' }).eq('organization_id', orgId);
        return { provider: settings.whatsapp_provider, status: 'connecting', phone: null, qr: data.base64 };
      }
    }
  }

  const instance = `nina_${orgId.replace(/-/g, '').slice(0, 12)}_${randomHex(2)}`;
  const token = randomHex(24);
  const webhookUrl = `${Deno.env.get('EVOLUTION_WEBHOOK_URL')}?token=${token}`;

  const { ok, data } = await evo('/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName: instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      groupsIgnore: true,
      rejectCall: false,
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
      },
    }),
  });
  if (!ok || !data?.qrcode?.base64) {
    console.error('[whatsapp-qr] create:', data);
    throw new Error('Não foi possível gerar o QR code');
  }

  // Se havia uma instância antiga quebrada, remove
  if (settings.evolution_instance && settings.evolution_instance !== instance) {
    await evo(`/instance/delete/${settings.evolution_instance}`, { method: 'DELETE' });
  }

  await supabase.from('nina_settings').update({
    evolution_instance: instance,
    evolution_token: token,
    evolution_status: 'connecting',
    evolution_phone: null,
  }).eq('organization_id', orgId);

  return { provider: settings.whatsapp_provider, status: 'connecting', phone: null, qr: data.qrcode.base64 };
}

async function disconnect(supabase: any, orgId: string, settings: any) {
  if (settings.evolution_instance) {
    await evo(`/instance/logout/${settings.evolution_instance}`, { method: 'DELETE' });
    await evo(`/instance/delete/${settings.evolution_instance}`, { method: 'DELETE' });
  }
  await supabase.from('nina_settings').update({
    evolution_instance: null,
    evolution_token: null,
    evolution_status: null,
    evolution_phone: null,
    evolution_connected_at: null,
    whatsapp_provider: 'meta',
  }).eq('organization_id', orgId);
  return { provider: 'meta', status: 'none', phone: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return json({ error: 'Faça login novamente.' }, 401);

  try {
    const body = await req.json();
    if (!evolutionConfigured()) throw new UserError('A conexão por QR code ainda não está disponível no servidor.');
    const { orgId, isOwner } = await resolveOrg(supabase, user.id, body.organization_id || undefined);

    const { data: settings } = await supabase
      .from('nina_settings')
      .select('whatsapp_provider, evolution_instance, evolution_status, evolution_phone')
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!settings) throw new UserError('A clínica ainda não tem a configuração da Nina.');

    let result;
    switch (body.action) {
      case 'status': result = await syncStatus(supabase, orgId, settings); break;
      case 'connect': result = await connect(supabase, orgId, settings); break;
      case 'disconnect': result = await disconnect(supabase, orgId, settings); break;
      default: return json({ error: 'Ação desconhecida' }, 400);
    }

    if (isOwner && body.organization_id && body.action !== 'status') {
      await supabase.from('owner_audit_log').insert({
        organization_id: orgId, actor_id: user.id,
        action: body.action === 'connect' ? 'whatsapp_qr_requested' : 'whatsapp_qr_disconnected', details: {},
      });
    }
    return json(result);
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, 400);
    console.error('[whatsapp-qr]', err);
    return json({ error: 'Não foi possível falar com o serviço de WhatsApp. Tente de novo.' }, 500);
  }
});
