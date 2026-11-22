import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { seedClinicDefaults } from '../_shared/clinic-defaults.ts';
import { GRAPH_API } from '../_shared/meta.ts';

// Ações dos painéis do Dono e da Agência que precisam da service_role (criar
// usuário, gerar link de acesso, chamar a API da Meta com o token salvo).
// Clínicas: o dono (qualquer uma) ou a agência (só as dela). Agências: só o dono.
//
// POST { action: 'create_clinic', clinic_name, owner_name, email, contact_phone?, monthly_fee?, first_due_date?, agency_id? }
// POST { action: 'resend_access', organization_id }
// POST { action: 'test_whatsapp', organization_id }   (também liga o recebimento de mensagens da WABA)
// POST { action: 'register_whatsapp', organization_id, pin }   (ativa o número na API oficial)
// POST { action: 'create_agency', agency_name, owner_name, email, contact_phone?, fee_per_clinic? }   (só o dono)
// POST { action: 'resend_agency_access', agency_id }                                                 (só o dono)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class UserError extends Error {}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface Caller {
  userId: string;
  isOwner: boolean;
  agencyId: string | null; // agência ativa do usuário
}

// Página do painel onde a pessoa cria a senha
function accessRedirect(req: Request): string {
  const origin = req.headers.get('origin') || Deno.env.get('NINA_SITE_URL') || '';
  return `${origin.replace(/\/$/, '')}/primeiro-acesso`;
}

async function generateAccessLink(supabase: any, email: string, redirectTo: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    console.error('[owner-actions] generateLink:', error);
    throw new Error('Não foi possível gerar o link de acesso');
  }
  return data.properties.action_link;
}

async function log(
  supabase: any, orgId: string | null, actorId: string, action: string,
  details: Record<string, unknown> = {}, agencyId: string | null = null,
) {
  await supabase.from('owner_audit_log').insert({ organization_id: orgId, agency_id: agencyId, actor_id: actorId, action, details });
}

async function assertCanManage(supabase: any, caller: Caller, orgId: string) {
  const { data, error } = await supabase.rpc('can_user_manage_org', { p_user: caller.userId, p_org: orgId });
  if (error || data !== true) throw new UserError('Você não tem acesso a esta clínica.');
}

// Conta com e-mail já confirmado; a senha é criada pelo link de primeiro acesso
async function createAccount(supabase: any, email: string, fullName: string, takenMessage: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message ?? '')) throw new UserError(takenMessage);
    throw error;
  }
  return data.user.id;
}

async function createClinic(supabase: any, req: Request, caller: Caller, body: any) {
  const clinicName = String(body.clinic_name ?? '').trim();
  const ownerName = String(body.owner_name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const contactPhone = String(body.contact_phone ?? '').trim() || null;
  const monthlyFee = Number(body.monthly_fee ?? 0);
  const firstDueDate = body.first_due_date ? String(body.first_due_date) : null;

  if (!clinicName) throw new UserError('Informe o nome da clínica.');
  if (!ownerName) throw new UserError('Informe o nome da dona da clínica.');
  if (!EMAIL_RE.test(email)) throw new UserError('Informe um e-mail válido.');
  if (!Number.isFinite(monthlyFee) || monthlyFee < 0) throw new UserError('Informe uma mensalidade válida.');
  if (firstDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) throw new UserError('Data do primeiro vencimento inválida.');

  // A agência sempre cria para ela mesma; o dono cria direto ou para uma agência
  const agencyId: string | null = caller.isOwner ? (body.agency_id ? String(body.agency_id) : null) : caller.agencyId;
  if (!caller.isOwner && !agencyId) throw new UserError('Acesso restrito.');
  if (caller.isOwner && agencyId) {
    const { data: agency } = await supabase.from('agencies').select('id').eq('id', agencyId).maybeSingle();
    if (!agency) throw new UserError('Agência não encontrada.');
  }

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({ name: clinicName, monthly_fee: monthlyFee, contact_name: ownerName, contact_phone: contactPhone, agency_id: agencyId })
    .select('id')
    .single();
  if (orgError) throw orgError;

  let userId: string | null = null;
  try {
    userId = await createAccount(supabase, email, ownerName, 'Já existe uma conta com esse e-mail. Use outro e-mail para a dona da clínica.');

    // handle_new_user cria perfil e papel 'user'; a dona é admin da clínica dela
    await supabase.from('user_roles').delete().eq('user_id', userId);
    const { error: roleError } = await supabase.from('user_roles').insert({ user_id: userId, role: 'admin' });
    if (roleError) throw roleError;

    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({ organization_id: org.id, user_id: userId, role: 'admin' });
    if (memberError) throw memberError;

    await seedClinicDefaults(supabase, org.id, clinicName);

    if (firstDueDate && monthlyFee > 0) {
      const { error: chargeError } = await supabase
        .from('organization_billing_charges')
        .insert({ organization_id: org.id, due_date: firstDueDate, amount: monthlyFee, notes: 'Primeira mensalidade' });
      if (chargeError) throw chargeError;
    }

    const link = await generateAccessLink(supabase, email, accessRedirect(req));
    await log(supabase, org.id, caller.userId, 'clinic_created', { name: clinicName, email }, agencyId);
    return { organization_id: org.id, access_link: link, email };
  } catch (err) {
    // Desfaz tudo: clínica (cascata em configurações/membros) e usuário criado
    await supabase.from('organizations').delete().eq('id', org.id);
    if (userId) await supabase.auth.admin.deleteUser(userId);
    throw err;
  }
}

async function resendAccess(supabase: any, req: Request, caller: Caller, body: any) {
  const orgId = String(body.organization_id ?? '');
  await assertCanManage(supabase, caller, orgId);
  const { data: member } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!member) throw new UserError('Esta clínica não tem uma conta de administradora.');

  const { data: userData, error } = await supabase.auth.admin.getUserById(member.user_id);
  if (error || !userData?.user?.email) throw new UserError('Não encontrei o e-mail da administradora.');

  const link = await generateAccessLink(supabase, userData.user.email, accessRedirect(req));
  await log(supabase, orgId, caller.userId, 'access_link_sent', { email: userData.user.email });
  return { access_link: link, email: userData.user.email };
}

async function loadWhatsappSettings(supabase: any, caller: Caller, body: any) {
  const orgId = String(body.organization_id ?? '');
  await assertCanManage(supabase, caller, orgId);
  const { data: s } = await supabase
    .from('nina_settings')
    .select('whatsapp_phone_number_id, whatsapp_access_token, whatsapp_business_account_id')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!s?.whatsapp_phone_number_id || !s?.whatsapp_access_token) {
    throw new UserError('Salve o Phone Number ID e o token antes de testar.');
  }
  return s;
}

async function graph(path: string, token: string, init: RequestInit = {}) {
  const resp = await fetch(`${GRAPH_API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

function metaErrorMessage(status: number, data: any): string {
  const code = data?.error?.code;
  if (status === 401 || code === 190) return 'Token inválido ou expirado. Gere o token permanente do usuário do sistema e salve de novo.';
  if (code === 10 || code === 200) return 'O token não tem permissão. Marque whatsapp_business_messaging e whatsapp_business_management ao gerar o token.';
  if (status === 404 || code === 100) return 'Phone Number ID não encontrado para esse token.';
  return `A Meta recusou a conexão (código ${code ?? status}).`;
}

async function testWhatsapp(supabase: any, caller: Caller, body: any) {
  const s = await loadWhatsappSettings(supabase, caller, body);
  const phonePath = encodeURIComponent(s.whatsapp_phone_number_id);

  let phone = await graph(`${phonePath}?fields=display_phone_number,verified_name,quality_rating,platform_type,status`, s.whatsapp_access_token);
  if (!phone.ok && phone.data?.error?.code === 100 && /field/i.test(phone.data?.error?.message ?? '')) {
    // Campo novo que a versão da API não conhece: tenta só o básico
    phone = await graph(`${phonePath}?fields=display_phone_number,verified_name,quality_rating`, s.whatsapp_access_token);
  }
  if (!phone.ok) return { ok: false, message: metaErrorMessage(phone.status, phone.data) };

  // Sem a WABA "assinada" no app, a Meta não manda as mensagens recebidas para a Nina.
  // O pedido é idempotente: pode repetir a cada teste.
  let webhookSubscribed: boolean | null = null;
  if (s.whatsapp_business_account_id) {
    const sub = await graph(`${encodeURIComponent(s.whatsapp_business_account_id)}/subscribed_apps`, s.whatsapp_access_token, { method: 'POST' });
    webhookSubscribed = sub.ok && sub.data?.success !== false;
    if (!webhookSubscribed) console.warn('[owner-actions] subscribed_apps falhou', sub.status, sub.data?.error?.code);
  }

  const platform = phone.data.platform_type ?? null;
  const needsRegister = !!platform && platform !== 'CLOUD_API';

  const notes: string[] = [];
  if (needsRegister) notes.push('O número ainda não está ativado na API oficial: use "Ativar número" com um PIN de 6 dígitos.');
  if (webhookSubscribed === false) notes.push('Não consegui ligar o recebimento de mensagens dessa conta (WABA). Confira o ID da conta Business e as permissões do token.');
  if (webhookSubscribed === null) notes.push('Preencha o ID da conta Business (WABA) e teste de novo para ligar o recebimento de mensagens.');
  if (phone.data.quality_rating === 'RED') notes.push('A qualidade do número está VERMELHA na Meta: reduza envios ativos até voltar ao verde.');

  return {
    ok: !needsRegister && webhookSubscribed !== false,
    message: notes.length ? `Token e número OK. ${notes.join(' ')}` : 'Conexão funcionando e recebimento de mensagens ligado.',
    display_phone_number: phone.data.display_phone_number ?? null,
    verified_name: phone.data.verified_name ?? null,
    quality_rating: phone.data.quality_rating ?? null,
    needs_register: needsRegister,
    webhook_subscribed: webhookSubscribed,
  };
}

async function registerWhatsapp(supabase: any, caller: Caller, body: any) {
  const pin = String(body.pin ?? '').trim();
  if (!/^\d{6}$/.test(pin)) throw new UserError('O PIN precisa ter 6 números.');
  const s = await loadWhatsappSettings(supabase, caller, body);
  const reg = await graph(`${encodeURIComponent(s.whatsapp_phone_number_id)}/register`, s.whatsapp_access_token, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  });
  if (!reg.ok) {
    const msg = String(reg.data?.error?.error_user_msg ?? reg.data?.error?.message ?? '');
    if (/pin/i.test(msg)) return { ok: false, message: 'PIN recusado. Se o número já tem verificação em duas etapas, use o mesmo PIN (ou troque no WhatsApp Manager).' };
    return { ok: false, message: metaErrorMessage(reg.status, reg.data) };
  }
  return { ok: true, message: 'Número ativado na API oficial. Guarde esse PIN: a Meta pede ele de novo se o número for reativado.' };
}

async function createAgency(supabase: any, req: Request, caller: Caller, body: any) {
  const agencyName = String(body.agency_name ?? '').trim();
  const ownerName = String(body.owner_name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const contactPhone = String(body.contact_phone ?? '').trim() || null;
  const rawFee = body.fee_per_clinic;
  const fee = rawFee === null || rawFee === undefined || rawFee === '' ? null : Number(rawFee);

  if (!agencyName) throw new UserError('Informe o nome da agência.');
  if (!ownerName) throw new UserError('Informe o nome do responsável.');
  if (!EMAIL_RE.test(email)) throw new UserError('Informe um e-mail válido.');
  if (fee !== null && (!Number.isFinite(fee) || fee < 0)) throw new UserError('Informe um valor por clínica válido.');

  const { data: agency, error: agencyError } = await supabase
    .from('agencies')
    .insert({ name: agencyName, contact_name: ownerName, contact_phone: contactPhone, fee_per_clinic: fee })
    .select('id')
    .single();
  if (agencyError) throw agencyError;

  let userId: string | null = null;
  try {
    userId = await createAccount(supabase, email, ownerName, 'Já existe uma conta com esse e-mail. Use outro e-mail para a agência.');
    const { error: memberError } = await supabase.from('agency_members').insert({ agency_id: agency.id, user_id: userId, role: 'admin' });
    if (memberError) throw memberError;

    const link = await generateAccessLink(supabase, email, accessRedirect(req));
    await log(supabase, null, caller.userId, 'agency_created', { name: agencyName, email }, agency.id);
    return { agency_id: agency.id, access_link: link, email };
  } catch (err) {
    await supabase.from('agencies').delete().eq('id', agency.id);
    if (userId) await supabase.auth.admin.deleteUser(userId);
    throw err;
  }
}

async function resendAgencyAccess(supabase: any, req: Request, caller: Caller, body: any) {
  const agencyId = String(body.agency_id ?? '');
  const { data: member } = await supabase
    .from('agency_members')
    .select('user_id')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!member) throw new UserError('Esta agência não tem uma conta de acesso.');

  const { data: userData, error } = await supabase.auth.admin.getUserById(member.user_id);
  if (error || !userData?.user?.email) throw new UserError('Não encontrei o e-mail da agência.');

  const link = await generateAccessLink(supabase, userData.user.email, accessRedirect(req));
  await log(supabase, null, caller.userId, 'agency_access_link_sent', { email: userData.user.email }, agencyId);
  return { access_link: link, email: userData.user.email };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Dono da plataforma ou agência ativa
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return json({ error: 'Faça login novamente.' }, 401);
  const { data: profile } = await supabase.from('profiles').select('is_platform_owner').eq('user_id', user.id).maybeSingle();
  const { data: agencyMember } = await supabase
    .from('agency_members')
    .select('agency_id, agencies!inner(status)')
    .eq('user_id', user.id)
    .maybeSingle();
  const caller: Caller = {
    userId: user.id,
    isOwner: !!profile?.is_platform_owner,
    agencyId: agencyMember?.agencies?.status === 'active' ? agencyMember.agency_id : null,
  };
  if (!caller.isOwner && !caller.agencyId) return json({ error: 'Acesso restrito.' }, 403);

  try {
    const body = await req.json();
    const ownerOnly = body.action === 'create_agency' || body.action === 'resend_agency_access';
    if (ownerOnly && !caller.isOwner) return json({ error: 'Acesso restrito ao dono da plataforma.' }, 403);
    switch (body.action) {
      case 'create_clinic': return json(await createClinic(supabase, req, caller, body));
      case 'resend_access': return json(await resendAccess(supabase, req, caller, body));
      case 'test_whatsapp': return json(await testWhatsapp(supabase, caller, body));
      case 'register_whatsapp': return json(await registerWhatsapp(supabase, caller, body));
      case 'create_agency': return json(await createAgency(supabase, req, caller, body));
      case 'resend_agency_access': return json(await resendAgencyAccess(supabase, req, caller, body));
      default: return json({ error: 'Ação desconhecida' }, 400);
    }
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, 400);
    console.error('[owner-actions]', err);
    return json({ error: 'Algo deu errado no servidor. Tente de novo.' }, 500);
  }
});
