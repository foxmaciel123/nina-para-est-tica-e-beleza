import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUserOrgId } from "../_shared/tenant.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// F3.2 — OAuth callback do Google Calendar
//
// Setup externo necessário:
//   1. Google Cloud Console → Criar OAuth 2.0 Client ID (tipo: Web application)
//   2. Authorized redirect URI: <edge_function_url>/google-calendar-oauth?action=callback
//   3. Salvar como secrets do Lovable Cloud:
//        GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI
//   4. Frontend chama:
//        GET ?action=authorize&user_id=<uuid>&professional_id=<uuid>
//        → retorna { authorize_url } pra abrir em popup
//      Após consent, Google redireciona pra ?action=callback&code=...&state=...
//      → salva tokens em google_calendar_credentials e fecha popup.

// state assinado (HMAC-SHA256) para o callback não aceitar um user_id forjado
const STATE_TTL_MS = 15 * 60 * 1000;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(data: string): Promise<string> {
  const secret = Deno.env.get('OAUTH_STATE_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))));
}

async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}

async function verifyState(state: string): Promise<{ user_id: string; professional_id: string | null } | null> {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = await hmac(body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.ts !== 'number' || Date.now() - payload.ts > STATE_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  const redirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI');

  if (!clientId || !clientSecret || !redirectUri) {
    return new Response(
      JSON.stringify({
        error: 'A integração com o Google Agenda ainda não foi ativada pelo administrador da plataforma.',
        todo: 'Defina GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET em /opt/nina/nina-functions.env'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'authorize') {
      // Usuário vem do token de login, nunca do endereço
      const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Faça login novamente.' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const userId = user.id;
      const professionalId = url.searchParams.get('professional_id');

      const state = await signState({ user_id: userId, professional_id: professionalId, ts: Date.now() });
      const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', SCOPES);
      authorizeUrl.searchParams.set('access_type', 'offline');
      authorizeUrl.searchParams.set('prompt', 'consent');
      authorizeUrl.searchParams.set('state', state);

      return new Response(
        JSON.stringify({ authorize_url: authorizeUrl.toString() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (!code || !state) {
        return new Response('Missing code/state', { status: 400, headers: corsHeaders });
      }

      const stateData = await verifyState(state);
      if (!stateData) {
        return new Response('Link de autorização inválido ou expirado. Tente conectar de novo.', { status: 400, headers: corsHeaders });
      }

      // Troca code por tokens
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        })
      });

      if (!tokenResp.ok) {
        const err = await tokenResp.text();
        return new Response(`OAuth error: ${err}`, { status: 400, headers: corsHeaders });
      }

      const tokens = await tokenResp.json();

      // Busca email do usuário Google
      const userInfoResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` }
      });
      const userInfo = await userInfoResp.json();

      const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

      // Upsert credentials (na clínica do usuário)
      const orgId = await getUserOrgId(supabase, stateData.user_id);
      if (!orgId) {
        return new Response('Usuário sem clínica vinculada', { status: 403, headers: corsHeaders });
      }
      const { error: upsertErr } = await supabase
        .from('google_calendar_credentials')
        .upsert({
          organization_id: orgId,
          user_id: stateData.user_id,
          professional_id: stateData.professional_id || null,
          google_email: userInfo.email,
          calendar_id: 'primary',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
          scope: SCOPES,
          is_active: true
        }, { onConflict: 'professional_id,google_email' });

      if (upsertErr) {
        return new Response(`DB error: ${upsertErr.message}`, { status: 500, headers: corsHeaders });
      }

      // F3.2 two-way — dispara criação do watch channel (best-effort, não bloqueia)
      fetch(`${supabaseUrl}/functions/v1/google-calendar-watch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({ user_id: stateData.user_id })
      }).catch(err => console.warn('[OAuth callback] watch trigger failed:', err));

      // HTML simples que fecha a janela e avisa o opener
      const html = `<!DOCTYPE html><html><body>
        <p style="font-family:sans-serif">Google Calendar conectado com sucesso ✨<br>Você já pode fechar esta janela.</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'google-calendar-connected', email: ${JSON.stringify(String(userInfo.email ?? '')).replace(/</g, '\\u003c')} }, '*');
            setTimeout(() => window.close(), 1500);
          }
        </script>
      </body></html>`;

      return new Response(html, {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    return new Response('Unknown action', { status: 400, headers: corsHeaders });
  } catch (err) {
    console.error('[google-calendar-oauth] error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
