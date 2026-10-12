import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('Branding & SEO (white label)', () => {
  test('metadata.json descreve o vertical de beleza', async () => {
    const meta = JSON.parse(
      readFileSync(resolve(__dirname, '..', 'metadata.json'), 'utf-8')
    );
    expect(meta.name).not.toMatch(/nina/i);
    expect(meta.description.toLowerCase()).toContain('estética');
    expect(meta.description.toLowerCase()).toContain('clínica');
  });

  test('package.json foi renomeado para nina-beleza-estetica', async () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')
    );
    expect(pkg.name).toBe('nina-beleza-estetica');
  });

  test('prompt padrão foi reescrito para beleza/estética e sem nome fixo', async () => {
    const promptFile = readFileSync(
      resolve(__dirname, '..', 'src', 'prompts', 'default-nina-prompt.ts'),
      'utf-8'
    );
    // Termos esperados no prompt de beleza
    for (const expected of [
      'beleza',
      'estética',
      'avaliação',
      'protocolo',
    ]) {
      expect(promptFile.toLowerCase()).toContain(expected);
    }
    // Termos do prompt genérico que NÃO devem mais aparecer
    expect(promptFile).not.toContain('Viver de IA');
    expect(promptFile).not.toContain('SaaS');
    expect(promptFile).not.toContain('SDR no WhatsApp com IA');
    expect(promptFile).not.toMatch(/Você é a Nina/);
    expect(promptFile).toContain('{{ assistente_nome }}');
  });

  test('mock data inclui procedimentos do mercado de beleza', async () => {
    const constants = readFileSync(
      resolve(__dirname, '..', 'src', 'constants.ts'),
      'utf-8'
    );
    for (const term of [
      'Botox',
      'Limpeza de Pele',
      'Drenagem',
      'Microagulhamento',
    ]) {
      expect(constants).toContain(term);
    }
  });

  test('open-graph meta tags vendem clínicas, não SaaS genérico', async ({ page }) => {
    await page.goto('/auth');
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    const ogDesc = await page.locator('meta[property="og:description"]').getAttribute('content');
    expect(ogTitle).not.toMatch(/nina/i);
    expect(await page.title()).not.toMatch(/nina/i);
    expect(ogDesc?.toLowerCase()).toContain('beleza');
  });
});
