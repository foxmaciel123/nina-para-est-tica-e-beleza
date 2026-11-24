import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bypassAuth, mockRpc } from './helpers/auth';
import { NICHES, DEFAULT_NICHE_ID, getNiche } from '../src/niches/registry';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

test.describe('Nichos: lista única (tela e servidor)', () => {
  test('cópia do servidor é igual à da tela (npm run sync:niches)', () => {
    const front = readFileSync(resolve(root, 'src/niches/registry.ts'), 'utf-8');
    const back = readFileSync(resolve(root, 'supabase/functions/_shared/niches.ts'), 'utf-8');
    expect(back).toBe(front);
    expect(front).not.toMatch(/^import /m);
  });

  test('21 nichos válidos e estética continua o padrão', () => {
    expect(NICHES).toHaveLength(21);
    expect(DEFAULT_NICHE_ID).toBe('estetica');
    expect(getNiche('nao-existe').id).toBe('estetica');
    const ids = new Set<string>();
    for (const n of NICHES) {
      expect(n.id).toMatch(/^[a-z_]{2,30}$/);
      expect(ids.has(n.id)).toBe(false);
      ids.add(n.id);
      expect(n.stages.length).toBeGreaterThanOrEqual(1);
      expect(n.stages.length).toBeLessThanOrEqual(10);
      for (const s of n.stages) expect(s.title.length).toBeLessThanOrEqual(60);
      expect(n.tags.map((t) => t.key).sort()).toEqual(
        ['cold_lead', 'demo_requested', 'follow_up', 'hot_lead', 'interested', 'qualified', 'unqualified', 'warm_lead'],
      );
      for (const c of n.categories) expect(c.value).toMatch(/^[a-z_]{1,40}$/);
      expect(n.features.agenda || n.features.pedidos).toBe(true);
    }
  });
});

const ORDERS = [
  {
    id: 'o1', number: 12, status: 'novo', source: 'ia',
    items: [{ name: 'X-Burger', quantity: 2, unit_price: 25.5 }, { name: 'Refri lata', quantity: 1, unit_price: 7 }],
    subtotal: 58, delivery_fee: 6, discount: 0, total: 64, delivery_method: 'entrega',
    delivery_address: 'Rua das Flores, 120', payment_method: 'Pix', customer_name: 'Mariana', customer_phone: '5511999990000',
    notes: null, contact_id: null, conversation_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), contact: null,
  },
  {
    id: 'o2', number: 11, status: 'preparando', source: 'manual',
    items: [{ name: 'Pizza G', quantity: 1, unit_price: 59.9 }],
    subtotal: 59.9, delivery_fee: 0, discount: 0, total: 59.9, delivery_method: 'retirada',
    delivery_address: null, payment_method: 'Cartão', customer_name: 'Carlos', customer_phone: null,
    notes: null, contact_id: null, conversation_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), contact: null,
  },
];

async function asNiche(page: Page, niche: string, extra: Record<string, unknown> = {}) {
  await bypassAuth(page);
  await mockRpc(page, 'org_profile', {
    company_name: 'Burger do Zé', sdr_name: 'Lia', business_niche: niche,
    company_logo_url: null, can_undo_niche: false, previous_niche: null, ...extra,
  });
}

// A aba "Seu negócio" só deixa trocar para admin (user_roles)
async function asAdmin(page: Page) {
  await page.route(/\/rest\/v1\/user_roles/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ role: 'admin' }]) }));
}

// O menu existe duas vezes (computador e celular): olha o primeiro
const navLink = (page: Page, href: string) => page.locator(`[data-testid="sidebar-nav"] a[href="${href}"]`).first();

test.describe('Nichos: menu e telas', () => {
  test('estética (padrão) mantém o menu de sempre', async ({ page }) => {
    await bypassAuth(page);
    await page.goto('/dashboard');
    await expect(navLink(page, '/scheduling')).toHaveCount(1);
    await expect(navLink(page, '/pedidos')).toHaveCount(0);
    await expect(navLink(page, '/pipeline')).toContainText('Funil de Clientes');
    await expect(navLink(page, '/team')).toContainText('Profissionais');
  });

  test('delivery mostra Pedidos e esconde a Agenda', async ({ page }) => {
    await asNiche(page, 'delivery');
    await page.goto('/dashboard');
    await expect(navLink(page, '/pedidos')).toHaveCount(1);
    await expect(navLink(page, '/scheduling')).toHaveCount(0);
    await expect(page.getByTestId('company-name').first()).toHaveText('Burger do Zé');
  });

  test('advocacia troca as palavras do menu', async ({ page }) => {
    await asNiche(page, 'advocacia');
    await page.goto('/dashboard');
    await expect(navLink(page, '/pipeline')).toContainText('Funil de Casos');
    await expect(navLink(page, '/scheduling')).toContainText('Consultas');
    await expect(navLink(page, '/team')).toContainText('Advogados');
    await expect(navLink(page, '/pedidos')).toHaveCount(0);
  });

  test('logo da empresa aparece no menu', async ({ page }) => {
    await asNiche(page, 'moda', { company_logo_url: 'https://exemplo.invalid/logo.png' });
    await page.goto('/dashboard');
    await expect(page.getByTestId('company-logo').first()).toHaveAttribute('src', 'https://exemplo.invalid/logo.png');
  });

  test('tela de Pedidos mostra o quadro e o pedido da IA', async ({ page }) => {
    await asNiche(page, 'delivery');
    await page.route(/\/rest\/v1\/orders/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDERS) }));
    await page.goto('/pedidos');
    await expect(page.getByTestId('orders-title')).toHaveText('Pedidos');
    await expect(page.getByTestId('orders-col-novo')).toContainText('#12 · Mariana');
    await expect(page.getByTestId('orders-col-novo')).toContainText('IA');
    await expect(page.getByTestId('orders-col-preparando')).toContainText('Preparando');
    await page.getByTestId('order-card').first().click();
    await expect(page.getByText('Rua das Flores, 120')).toBeVisible();
    await expect(page.getByTestId('order-next')).toContainText('Confirmado');
  });

  test('loja chama a etapa de "Separando" e "Enviado"', async ({ page }) => {
    await asNiche(page, 'atacado');
    await page.route(/\/rest\/v1\/orders/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDERS) }));
    await page.goto('/pedidos');
    await expect(page.getByTestId('orders-col-preparando')).toContainText('Separando');
    await expect(page.getByTestId('orders-col-enviado')).toContainText('Enviado');
  });

  test('aba "Seu negócio" troca o nicho chamando o servidor com o funil do nicho', async ({ page }) => {
    await bypassAuth(page);
    await asAdmin(page);
    await page.goto('/settings');
    await page.getByRole('tab', { name: /seu negócio/i }).click();
    await expect(page.getByTestId('current-niche')).toContainText('Clínica de Estética');
    await expect(page.locator('[data-testid^="niche-option-"]')).toHaveCount(21);
    await page.getByTestId('niche-option-restaurante').click();
    const call = page.waitForRequest(/\/rpc\/apply_business_niche/);
    await page.getByTestId('apply-niche').click();
    await page.getByTestId('confirm-niche').click();
    const body = (await call).postDataJSON();
    expect(body.p_niche).toBe('restaurante');
    expect(body.p_config.stages.map((s: { title: string }) => s.title)).toEqual(getNiche('restaurante').stages.map((s) => s.title));
    expect(body.p_config.tags).toHaveLength(8);
  });

  test('desfazer aparece depois de uma troca', async ({ page }) => {
    await asNiche(page, 'restaurante', { can_undo_niche: true, previous_niche: 'estetica' });
    await asAdmin(page);
    await page.goto('/settings');
    await page.getByRole('tab', { name: /seu negócio/i }).click();
    const undo = page.getByTestId('undo-niche');
    await expect(undo).toContainText('Clínica de Estética');
    const call = page.waitForRequest(/\/rpc\/undo_business_niche/);
    await undo.click();
    await call;
  });
});
