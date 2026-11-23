import { test, expect } from '@playwright/test';
import { bypassAuth } from './helpers/auth';

// No celular a tela aparecia vazia: o menu abria sozinho por cima e a barra
// do topo ocupava a largura toda, deixando o conteúdo com largura zero.
test.describe('Celular: menu e conteúdo', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('conteúdo aparece, menu começa fechado e fecha ao tocar num item', async ({ page }) => {
    await bypassAuth(page);
    await page.goto('/dashboard');
    const main = page.locator('main');
    await expect(main).toBeVisible();
    expect((await main.boundingBox())?.width ?? 0).toBeGreaterThan(300);

    // fechado: nenhum link do menu visível
    await expect(page.locator('[data-testid="sidebar-nav"] a[href="/pipeline"]:visible')).toHaveCount(0);

    await page.locator('svg.lucide-menu').first().click();
    const link = page.locator('[data-testid="sidebar-nav"] a[href="/pipeline"]:visible');
    await expect(link).toHaveCount(1);
    await link.click();
    await expect(page).toHaveURL(/\/pipeline$/);
    await expect(page.locator('[data-testid="sidebar-nav"] a[href="/pipeline"]:visible')).toHaveCount(0);
  });
});
