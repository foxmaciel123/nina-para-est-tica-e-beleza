import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { seedClinicDefaults } from '../_shared/clinic-defaults.ts';

// Ações do Painel do Dono que precisam da service_role (criar usuário, gerar
// link de acesso, chamar a API da Meta com o token salvo). Só o dono da
// plataforma pode chamar.
//
// POST { action: 'create_clinic', clinic_name, owner_name, email, contact_phone?, monthly_fee?, first_due_date? }
// POST { action: 'resend_access', organization_id }
// POST { action: 'test_whatsapp', organization_id }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GRAPH_API = 'https://graph.facebook.com/v18.0';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class UserError extends Error {}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Página do painel onde a dona cria a senha
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

async function log(supabase: any, orgId: string, actorId: string, action: string, details: Record<string, unknown> = {}) {
  await supabase.from('owner_audit_log').insert({ organization_id: orgId, actor_id: actorId, action, details });
}

async function createClinic(supabase: any, req: Request, actorId: string, body: any) {
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

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({ name: clinicName, monthly_fee: monthlyFee, contact_name: ownerName, contact_phone: contactPhone })
    .select('id')
    .single();
  if (orgError) throw orgError;

  let userId: string | null = null;
  try {
    const { data: created, error: userError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: ownerName },
    });
    if (userError) {
      if (/already|registered|exists/i.test(userError.message ?? '')) {
        throw new UserError('Já existe uma conta com esse e-mail. Use outro e-mail para a dona da clínica.');
      }
      throw userError;
    }
    userId = created.user.id;

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
    await log(supabase, org.id, actorId, 'clinic_created', { name: clinicName, email });
    return { organization_id: org.id, access_link: link, email };
  } catch (err) {
    // Desfaz tudo: clínica (cascata em configurações/membros) e usuário criado
    await supabase.from('organizations').delete().eq('id', org.id);
    if (userId) await supabase.auth.admin.deleteUser(userId);
    throw err;
  }
}

async function resendAccess(supabase: any, req: Request, actorId: string, body: any) {
  const orgId = String(body.organization_id ?? '');
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
  await log(supabase, orgId, actorId, 'access_link_sent', { email: userData.user.email });
  return { access_link: link, email: userData.user.email };
}

async function testWhatsapp(supabase: any, body: any) {
  const orgId = String(body.organization_id ?? '');
  const { data: s } = await supabase
    .from('nina_settings')
    .select('whatsapp_phone_number_id, whatsapp_access_token')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!s?.whatsapp_phone_number_id || !s?.whatsapp_access_token) {
    throw new UserError('Salve o Phone Number ID e o token antes de testar.');
  }

  const resp = await fetch(
    `${GRAPH_API}/${encodeURIComponent(s.whatsapp_phone_number_id)}?fields=display_phone_number,verified_name,quality_rating`,
    { headers: { Authorization: `Bearer ${s.whatsapp_access_token}` } },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const code = data?.error?.code;
    if (resp.status === 401 || code === 190) return { ok: false, message: 'Token inválido ou expirado.' };
    if (resp.status === 404 || code === 100) return { ok: false, message: 'Phone Number ID não encontrado para esse token.' };
    return { ok: false, message: `A Meta recusou a conexão (código ${code ?? resp.status}).` };
  }
  return {
    ok: true,
    message: 'Conexão funcionando.',
    display_phone_number: data.display_phone_number ?? null,
    verified_name: data.verified_name ?? null,
    quality_rating: data.quality_rating ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Só o dono da plataforma
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return json({ error: 'Faça login novamente.' }, 401);
  const { data: profile } = await supabase.from('profiles').select('is_platform_owner').eq('user_id', user.id).maybeSingle();
  if (!profile?.is_platform_owner) return json({ error: 'Acesso restrito ao dono da plataforma.' }, 403);

  try {
    const body = await req.json();
    switch (body.action) {
      case 'create_clinic': return json(await createClinic(supabase, req, user.id, body));
      case 'resend_access': return json(await resendAccess(supabase, req, user.id, body));
      case 'test_whatsapp': return json(await testWhatsapp(supabase, body));
      default: return json({ error: 'Ação desconhecida' }, 400);
    }
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, 400);
    console.error('[owner-actions]', err);
    return json({ error: 'Algo deu errado no servidor. Tente de novo.' }, 500);
  }
});
