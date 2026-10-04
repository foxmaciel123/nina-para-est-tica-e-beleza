import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// O supabase-js guarda a sessão em `sb-<1º pedaço do host>-auth-token`.
// Lê VITE_SUPABASE_URL do ambiente ou do .env — nunca hardcode o host aqui.
function readSupabaseUrl(): string {
  if (process.env.VITE_SUPABASE_URL) return process.env.VITE_SUPABASE_URL;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const match = env.match(/^VITE_SUPABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    return match?.[1] ?? '';
  } catch {
    return '';
  }
}

const SUPABASE_PROJECT_REF = (() => {
  try {
    return new URL(readSupabaseUrl()).hostname.split('.')[0];
  } catch {
    return '';
  }
})();

/**
 * Injeta uma sessão Supabase fake no localStorage antes do app carregar.
 *
 * Suficiente pra UI estática (Sidebar, Settings, modais) renderizar como
 * "logado". Queries reais ao Supabase vão falhar com 401, então estes
 * testes devem cobrir UI/state que NÃO dependem de dados do banco.
 */
export async function bypassAuth(page: Page) {
  const projectRef = SUPABASE_PROJECT_REF;
  const fakeSession = {
    access_token: 'fake-jwt-for-ui-testing',
    refresh_token: 'fake-refresh',
    token_type: 'bearer',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'qa@nina-beleza.test',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: { provider: 'email' },
      user_metadata: { full_name: 'QA Bot' },
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };

  await page.addInitScript(
    ({ ref, session }) => {
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
      // Wizard de onboarding como "já visto" pra não cobrir a tela em testes
      localStorage.setItem('onboarding_wizard_seen', 'true');
      // Tema dark fixo pros tests serem determinísticos
      localStorage.setItem('nina-beleza-theme', 'dark');
    },
    { ref: projectRef, session: fakeSession }
  );

  // Intercepta requests pra REST/RPC do Supabase → devolve [] vazio
  // (queries de dados retornam estado vazio em vez de 401)
  await page.route(/\/rest\/v1\//, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  // Intercepta auth refresh — devolve sucesso
  await page.route(/\/auth\/v1\/(token|user)/, async (route) => {
    const url = route.request().url();
    if (url.includes('/user')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fakeSession.user),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: fakeSession.access_token,
          refresh_token: fakeSession.refresh_token,
          user: fakeSession.user,
          expires_in: 3600,
          token_type: 'bearer',
        }),
      });
    }
  });

  // RPCs: devolve vazio por padrão (testes registram mocks específicos com mockRpc)
  await page.route(/\/rest\/v1\/rpc\//, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
  });

  // Bloqueia chamadas a edge functions (functions/v1/*) com 200 vazio
  await page.route(/\/functions\/v1\//, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
}

/**
 * Responde uma RPC do Supabase (`/rest/v1/rpc/<name>`) com dados fixos.
 * Registre depois do bypassAuth: no Playwright a rota registrada por último vence.
 */
export async function mockRpc(page: Page, name: string, data: unknown) {
  await page.route(new RegExp(`/rest/v1/rpc/${name}(\\?|$)`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}
