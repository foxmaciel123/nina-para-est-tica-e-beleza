import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, '..');

/**
 * Cobertura de regressão por filesystem — barato e captura "alguém apagou
 * um arquivo importante" sem precisar logar/renderizar.
 *
 * Testes mais profundos de comportamento ficam nas specs *.spec.ts que
 * usam helpers/auth.
 */
test.describe('Features novas — presença e conteúdo', () => {
  test('docs/INTEGRATIONS.md descreve contrato de 4 operações', () => {
    const doc = readFileSync(resolve(repo, 'docs', 'INTEGRATIONS.md'), 'utf-8');
    expect(doc).toMatch(/Calendar Adapter/);
    expect(doc).toMatch(/OAuth/);
    expect(doc).toMatch(/Outbound/);
    expect(doc).toMatch(/Inbound/);
    expect(doc).toMatch(/Disconnect/);
    expect(doc).toMatch(/Trinks/);
    expect(doc).toMatch(/iClinic/);
  });

  test('migrations do SaaS existem (multi-clínica, dono, cobrança, configuração, QR, segurança)', () => {
    const files = [
      '20261004194000_export_full_schema.sql',
      '20261005000000_multi_tenant_foundation.sql',
      '20261005010000_owner_panel.sql',
      '20261005020000_owner_billing_usage_alerts.sql',
      '20261005030000_owner_clinic_config.sql',
      '20261005040000_whatsapp_evolution.sql',
      '20261012000000_security_hardening.sql',
    ];
    for (const f of files) expect(existsSync(resolve(repo, 'supabase/migrations', f))).toBe(true);
    const mt = readFileSync(resolve(repo, 'supabase/migrations/20261005000000_multi_tenant_foundation.sql'), 'utf-8');
    expect(mt).toMatch(/current_org_id/);
    expect(mt).toMatch(/organization_id = public\.current_org_id\(\)/);
  });

  test('webhook da Meta valida a assinatura X-Hub-Signature-256', () => {
    const code = readFileSync(resolve(repo, 'supabase/functions/whatsapp-webhook/index.ts'), 'utf-8');
    expect(code).toMatch(/verifyMetaSignature/);
    expect(code).toMatch(/x-hub-signature-256/);
    expect(code).toMatch(/status: 403/);
  });

  test('OAuth do Google usa state assinado e login real', () => {
    const code = readFileSync(resolve(repo, 'supabase/functions/google-calendar-oauth/index.ts'), 'utf-8');
    expect(code).toMatch(/signState/);
    expect(code).toMatch(/verifyState/);
    expect(code).not.toMatch(/searchParams\.get\('user_id'\)/);
  });

  test('tela de login não oferece cadastro público', () => {
    const code = readFileSync(resolve(repo, 'src/pages/Auth.tsx'), 'utf-8');
    expect(code).toMatch(/Esqueci minha senha/);
    expect(code).not.toMatch(/'Criar conta' : 'Fazer login'/);
  });
  test('edge functions de Google Calendar 2-way existem', () => {
    const fns = [
      'supabase/functions/google-calendar-oauth/index.ts',
      'supabase/functions/google-calendar-watch/index.ts',
      'supabase/functions/google-calendar-webhook/index.ts',
    ];
    for (const f of fns) expect(existsSync(resolve(repo, f))).toBe(true);
  });

  test('edge function appointment-reminders existe e respeita contrato', () => {
    const code = readFileSync(
      resolve(repo, 'supabase/functions/appointment-reminders/index.ts'),
      'utf-8'
    );
    expect(code).toMatch(/appointment_reminders/);
    expect(code).toMatch(/send_queue/);
    expect(code).toMatch(/whatsapp-sender/);
    expect(code).toMatch(/cliente_nome/); // placeholder
  });

  test('nina-orchestrator tem tools list_procedures + appointment com enum beleza', () => {
    const code = readFileSync(
      resolve(repo, 'supabase/functions/nina-orchestrator/index.ts'),
      'utf-8'
    );
    expect(code).toMatch(/listProceduresTool/);
    expect(code).toMatch(/queryProcedures/);
    expect(code).toMatch(/syncRescheduleToGoogleCalendar/);
    expect(code).toMatch(/syncCancelToGoogleCalendar/);
    // Enum novo do create_appointment
    expect(code).toMatch(/"evaluation",\s*"procedure",\s*"followup",\s*"return"/);
    // Não deve mais ter o enum antigo SDR
    expect(code).not.toMatch(/"demo",\s*"meeting",\s*"support",\s*"followup"\]/);
  });

  test('StepFinish removeu form de teste sintético', () => {
    const code = readFileSync(
      resolve(repo, 'src/components/onboarding/StepFinish.tsx'),
      'utf-8'
    );
    // Removido: form de envio de mensagem teste
    expect(code).not.toMatch(/test-whatsapp-message/);
    expect(code).not.toMatch(/handleSendTest/);
    expect(code).not.toMatch(/Enviar Teste/);
    // Adicionado: instrução de teste real (cliente → Nina)
    expect(code).toMatch(/Teste a \{assistantName\} de verdade/);
    expect(code).toMatch(/Smartphone/);
  });

  test('UIs novas existem como componentes', () => {
    const components = [
      'src/components/settings/ProceduresManager.tsx',
      'src/components/settings/GoogleCalendarConnect.tsx',
      'src/components/settings/RemindersManager.tsx',
      'src/components/settings/AppConfigCard.tsx',
      'src/components/ContactPhotosSheet.tsx',
      'src/components/ThemeToggle.tsx',
      'src/hooks/useTheme.tsx',
    ];
    for (const f of components) expect(existsSync(resolve(repo, f))).toBe(true);
  });

  test('ApiSettings ganhou campo Business Account ID (WABA)', () => {
    const code = readFileSync(
      resolve(repo, 'src/components/settings/ApiSettings.tsx'),
      'utf-8'
    );
    expect(code).toMatch(/whatsapp_business_account_id/);
    expect(code).toMatch(/Business Account ID/);
  });

  test('prompt padrão veta vocabulário agressivo de venda', () => {
    const promptFile = readFileSync(
      resolve(repo, 'src/prompts/default-nina-prompt.ts'),
      'utf-8'
    );
    // Proibições clínicas explícitas
    expect(promptFile).toMatch(/última vaga/i);
    expect(promptFile).toMatch(/promoção relâmpago/i);
    expect(promptFile).toMatch(/diagnóstico/i);
    // Tom acolhedor
    expect(promptFile).toMatch(/acolhimento/i);
    expect(promptFile).toMatch(/avaliação/i);
  });

  test('rastreamento de anúncios: migration, função, webhook e tela', () => {
    const mig = readFileSync(resolve(repo, 'supabase/migrations/20261124000000_rastreamento_anuncios.sql'), 'utf-8');
    expect(mig).toMatch(/record_lead_touch/);
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS public\.sales/);
    expect(mig).toMatch(/ads_report/);
    expect(mig).toMatch(/REVOKE ALL ON public\.meta_ads_connections FROM anon, authenticated/);
    expect(existsSync(resolve(repo, 'supabase/functions/meta-ads-sync/index.ts'))).toBe(true);
    expect(existsSync(resolve(repo, 'supabase/tests/rastreamento_anuncios.sql'))).toBe(true);
    const webhook = readFileSync(resolve(repo, 'supabase/functions/whatsapp-webhook/index.ts'), 'utf-8');
    expect(webhook).toMatch(/message\.referral/);
    const app = readFileSync(resolve(repo, 'src/App.tsx'), 'utf-8');
    expect(app).toMatch(/path="\/anuncios"/);
  });
});
