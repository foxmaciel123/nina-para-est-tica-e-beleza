import { test, expect, type Page } from '@playwright/test';
import { bypassAuth } from './helpers/auth';

// O botão é remontado pelo framer-motion; clicar via JS evita flakiness.
async function openPicker(page: Page) {
  await page.locator('[data-testid="theme-picker"]').first().waitFor({ timeout: 10_000 });
  await page.evaluate(() => {
    (document.querySelector('[data-testid="theme-picker"]') as HTMLButtonElement | null)?.click();
  });
}

async function pick(page: Page, id: 'marinho' | 'grafite' | 'claro') {
  await openPicker(page);
  await page.locator(`[data-testid="theme-option-${id}"]`).click();
}

test.describe('Seletor de tema (3 temas)', () => {
  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
  });

  test('valor antigo "dark" abre no Azul-marinho', async ({ page }) => {
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveClass(/theme-marinho/);
  });

  test('seletor mostra os 3 temas', async ({ page }) => {
    await openPicker(page);
    await expect(page.locator('[data-testid="theme-option-marinho"]')).toBeVisible();
    await expect(page.locator('[data-testid="theme-option-grafite"]')).toBeVisible();
    await expect(page.locator('[data-testid="theme-option-claro"]')).toBeVisible();
  });

  test('Grafite + Verde continua escuro e troca a paleta', async ({ page }) => {
    await pick(page, 'grafite');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveClass(/theme-grafite/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('nina-beleza-theme'))).toBe('grafite');
  });

  test('Claro Azul liga o modo claro e salva a escolha', async ({ page }) => {
    await pick(page, 'claro');
    await expect(page.locator('html')).toHaveClass(/light/);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('nina-beleza-theme'))).toBe('claro');
  });

  test('no Claro Azul a letra principal é escura', async ({ page }) => {
    await pick(page, 'claro');
    const color = await page.evaluate(() => getComputedStyle(document.body).color);
    const [r, g, b] = (color.match(/\d+/g) || []).map(Number);
    expect(r + g + b).toBeLessThan(150);
  });
});
