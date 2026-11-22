import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GRAPH_API } from '../_shared/meta.ts';

// Botão "Conectar WhatsApp" (Cadastro Incorporado da Meta / Embedded Signup).
// A tela abre a janela do Facebook com o app da plataforma e manda para cá o
// código de autorização e os IDs escolhidos. Aqui o código vira o token da
// clínica, a conta (WABA) é ligada ao app e o número é ativado na API oficial.
// Nenhum token passa pela tela.
//
// Pode chamar: o dono ou a agência da clínica (informando organization_id) ou a
// admin da própria clínica (sem organization_id).
//
// POST { code, waba_id?, phone_number_id?, mode?: 'cloud' | 'coexistence', organization_id? }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

class UserError extends Error {}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ID_RE = /^\d{5,25}$/;

async function resolveOrg(supabase: any, userId: string, requested?: string): Promise<{ orgId: string; byManager: boolean }> {
  if (requested) {
    const { data: allowed } = await supabase.rpc('can_user_manage_org', { p_user: userId, p_org: requested });
    if (allowed !== true) throw new UserError('Você não tem acesso a esta clínica.');
    return { orgId: requested, byManager: true };
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
  return { orgId: member.organization_id, byManager: false };
}

async function appConfig(supabase: any, keys: string[]): Promise<Record<string, string | null>> {
  const { data } = await supabase.from('app_config').select('key, value').in('key', keys);
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = null;
  for (const row of data ?? []) out[row.key] = row.value ? String(row.value).trim() || null : null;
  return out;
}

async function graph(path: string, token: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(`${GRAPH_API}/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

function randomPin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

// Se a janela não devolveu os IDs, descobre pela permissão concedida ao token
async function discoverIds(appId: string, appSecret: string, token: string, wabaId: string | null, phoneId: string | null) {
  if (!wabaId) {
    const dbg = await graph(
      `debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
      null,
    );
    const scopes: any[] = dbg.data?.data?.granular_scopes ?? [];
    const mgmt = scopes.find((s) => s.scope === 'whatsapp_business_management');
    const targets: string[] = mgmt?.target_ids ?? [];
    if (targets.length === 1) wabaId = String(targets[0]);
  }
  if (wabaId && !phoneId) {
    const nums = await graph(`${encodeURIComponent(wabaId)}/phone_numbers?fields=id`, token);
    const list: any[] = nums.data?.data ?? [];
    if (list.length === 1) phoneId = String(list[0].id);
  }
  return { wabaId, phoneId };
}

async function connect(supabase: any, orgId: string, body: any) {
  const code = String(body.code ?? '').trim();
  if (!code) throw new UserError('A janela do Facebook não devolveu a autorização. Tente de novo.');
  const mode = body.mode === 'coexistence' ? 'coexistence' : 'cloud';

  const cfg = await appConfig(supabase, ['meta_app_id', 'meta_app_secret']);
  if (!cfg.meta_app_id || !cfg.meta_app_secret) {
    throw new UserError('O app da Meta da plataforma ainda não foi configurado no Painel do Dono.');
  }

  // 1. Código -> token da clínica (token de integração do negócio, não vence)
  const ex = await graph(
    `oauth/access_token?client_id=${encodeURIComponent(cfg.meta_app_id)}&client_secret=${encodeURIComponent(cfg.meta_app_secret)}&code=${encodeURIComponent(code)}`,
    null,
  );
  const token: string | undefined = ex.data?.access_token;
  if (!ex.ok || !token) {
    console.warn('[whatsapp-connect] troca do código falhou', ex.status, ex.data?.error?.code);
    throw new UserError('A Meta não aceitou a autorização (ela vale poucos minutos). Clique em Conectar WhatsApp de novo.');
  }

  // 2. IDs da conta e do número
  let wabaId = ID_RE.test(String(body.waba_id ?? '')) ? String(body.waba_id) : null;
  let phoneId = ID_RE.test(String(body.phone_number_id ?? '')) ? String(body.phone_number_id) : null;
  ({ wabaId, phoneId } = await discoverIds(cfg.meta_app_id, cfg.meta_app_secret, token, wabaId, phoneId));
  if (!wabaId || !phoneId) {
    throw new UserError('Não consegui identificar o número escolhido. Refaça a conexão e escolha um número só.');
  }

  const { data: taken } = await supabase
    .from('nina_settings')
    .select('organization_id')
    .eq('whatsapp_phone_number_id', phoneId)
    .neq('organization_id', orgId)
    .limit(1)
    .maybeSingle();
  if (taken) throw new UserError('Esse número já está conectado em outra clínica.');

  // 3. Liga o recebimento de mensagens da conta no app da plataforma
  const sub = await graph(`${encodeURIComponent(wabaId)}/subscribed_apps`, token, { method: 'POST' });
  if (!sub.ok) {
    console.warn('[whatsapp-connect] subscribed_apps falhou', sub.status, sub.data?.error?.code);
    throw new UserError('Não consegui ligar o recebimento de mensagens dessa conta. Tente de novo em alguns minutos.');
  }

  // 4. Ativa o número na API oficial (na coexistência o número segue no app do celular e não é registrado)
  const { data: current } = await supabase
    .from('nina_settings')
    .select('whatsapp_two_step_pin, whatsapp_phone_number_id')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!current) throw new UserError('A clínica ainda não tem a configuração da assistente.');

  let pin: string | null = current.whatsapp_phone_number_id === phoneId ? current.whatsapp_two_step_pin : null;
  if (mode === 'cloud') {
    pin = pin ?? randomPin();
    const reg = await graph(`${encodeURIComponent(phoneId)}/register`, token, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });
    if (!reg.ok) {
      const msg = String(reg.data?.error?.error_user_msg ?? reg.data?.error?.message ?? '');
      console.warn('[whatsapp-connect] register falhou', reg.status, reg.data?.error?.code, msg);
      if (/pin|two.?step|2fa/i.test(msg)) {
        throw new UserError('Esse número já tem um PIN de verificação em duas etapas. Desative o PIN no WhatsApp Manager ou use "Ativar número" com o PIN atual.');
      }
      if (!/already|registered/i.test(msg)) {
        throw new UserError('A Meta não ativou o número agora. Tente de novo em alguns minutos.');
      }
    }
  }

  const info = await graph(`${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name,quality_rating`, token);

  // 5. Grava tudo na clínica
  const { error: upErr } = await supabase
    .from('nina_settings')
    .update({
      whatsapp_provider: 'meta',
      whatsapp_access_token: token,
      whatsapp_phone_number_id: phoneId,
      whatsapp_business_account_id: wabaId,
      whatsapp_app_secret: cfg.meta_app_secret,
      whatsapp_two_step_pin: pin,
      whatsapp_connected_via: mode === 'coexistence' ? 'embedded_signup_coexistence' : 'embedded_signup',
    })
    .eq('organization_id', orgId);
  if (upErr) throw upErr;

  return {
    ok: true,
    message: mode === 'coexistence'
      ? 'WhatsApp conectado. O número continua funcionando também no app do celular.'
      : 'WhatsApp conectado na API oficial.',
    display_phone_number: info.data?.display_phone_number ?? null,
    verified_name: info.data?.verified_name ?? null,
    quality_rating: info.data?.quality_rating ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return json({ error: 'Faça login novamente.' }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const { orgId, byManager } = await resolveOrg(supabase, user.id, body.organization_id || undefined);
    const result = await connect(supabase, orgId, body);

    if (byManager) {
      await supabase.from('owner_audit_log').insert({
        organization_id: orgId, actor_id: user.id, action: 'whatsapp_embedded_signup',
        details: { mode: body.mode === 'coexistence' ? 'coexistence' : 'cloud' },
      });
    }
    return json(result);
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, 400);
    console.error('[whatsapp-connect]', err);
    return json({ error: 'Não foi possível conectar o WhatsApp agora. Tente de novo.' }, 500);
  }
});
