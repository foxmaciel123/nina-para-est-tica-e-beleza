import { test, expect } from '@playwright/test';
import { mockRpc } from './helpers/auth';

test.describe('Página de autenticação', () => {
  test.beforeEach(async ({ page }) => {
    await mockRpc(page, 'public_brand', { name: 'Marca QA', tagline: 'Estética com IA', accent_color: '#C2185B' });
    // O app redireciona "/" → "/auth" quando o usuário não está logado.
    // Vamos direto para a rota /auth para não depender do estado de loading do Supabase.
    await page.goto('/auth');
  });

  test('exibe a marca configurada na aba do navegador', async ({ page }) => {
    await expect(page).toHaveTitle('Marca QA · Estética com IA');
  });

  test('mostra a marca configurada e nada de "Nina"', async ({ page }) => {
    await expect(page.getByText('Marca QA · Estética com IA')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/nina/i);
  });

  test('aplica a cor de destaque da marca', async ({ page }) => {
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))).toBe('336 78% 43%');
  });

  test('título inicial é o de login (modo "bem-vinda de volta")', async ({ page }) => {
    const title = page.getByTestId('auth-title');
    await expect(title).toBeVisible();
    await expect(title).toHaveText(/bem-vinda de volta/i);
  });

  test('subtítulo fala da clínica/agenda e não de SaaS genérico', async ({ page }) => {
    await expect(
      page.getByText(/atendimentos, agenda e funil de clientes/i)
    ).toBeVisible();
  });

  test('não oferece cadastro público (acesso criado pelo suporte)', async ({ page }) => {
    await expect(page.getByRole('button', { name: /criar conta/i })).toHaveCount(0);
    await expect(page.getByText(/o acesso das clínicas é criado pelo suporte/i)).toBeVisible();
  });

  test('esqueci minha senha pede o e-mail antes', async ({ page }) => {
    await page.getByTestId('forgot-password').click();
    await expect(page.getByText(/digite seu e-mail acima/i)).toBeVisible();
  });

  test('esqueci minha senha responde sem revelar se o e-mail existe', async ({ page }) => {
    await page.route(/\/auth\/v1\/recover/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    );
    await page.getByLabel('Email').fill('cliente@suaclinica.com.br');
    await page.getByTestId('forgot-password').click();
    await expect(page.getByText(/se este e-mail tiver acesso/i)).toBeVisible();
  });

  test('valida senha curta sem chamar Supabase', async ({ page }) => {
    await page.getByLabel('Email').fill('cliente@suaclinica.com.br');
    await page.getByLabel('Senha').fill('123');
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page.getByText(/senha deve ter pelo menos 6 caracteres/i)).toBeVisible();
  });

  test('valida e-mail inválido (bypass de HTML5 para chegar no Zod)', async ({ page }) => {
    // Garante que o form já está renderizado pelo React antes de mexer no DOM.
    await page.waitForSelector('form');
    // O input tem type="email" + form sem noValidate, o que aciona a validação
    // nativa do navegador antes do Zod. Marcamos o form como noValidate via JS
    // para que o submit chegue até o validador Zod do app.
    await page.evaluate(() => {
      document.querySelector<HTMLFormElement>('form')?.setAttribute('novalidate', 'true');
    });
    await page.getByLabel('Email').fill('isso-nao-eh-email');
    await page.getByLabel('Senha').fill('senha123');
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page.getByText('Email inválido')).toBeVisible({ timeout: 15_000 });
  });

  test('rota protegida redireciona para /auth quando não autenticado', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/auth$/);
  });

  test('aplica design system definido (não fallback cyan/violet do SDR genérico)', async ({ page }) => {
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
    );
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );
    // Garante que CSS vars estão setadas no formato HSL "hue sat% light%"
    expect(primary).toMatch(/^\d+\s+\d+%\s+\d+%$/);
    expect(accent).toMatch(/^\d+\s+\d+%\s+\d+%$/);
    // Veta a paleta genérica cyan (hue 180-200) / violet (hue 250-280) do fork SDR
    const primaryHue = parseInt(primary.split(' ')[0]);
    expect(primaryHue >= 180 && primaryHue <= 200).toBe(false);
    expect(primaryHue >= 250 && primaryHue <= 280).toBe(false);
  });
});
