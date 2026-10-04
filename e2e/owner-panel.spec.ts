import { test, expect, Page } from '@playwright/test';
import { bypassAuth, mockRpc } from './helpers/auth';

/**
 * Painel do Dono (formato VendaFlow) e convivência com o painel da clínica.
 * Tudo com dados simulados: nenhuma chamada sai para o backend real.
 */

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

const clinics = [
  {
    id: ORG_A, name: 'Minha Clínica', status: 'active', created_at: '2026-09-01T12:00:00Z',
    admin_email: 'qa@nina-beleza.test', members: 1, contacts: 120, conversations_30d: 80,
    ai_messages_30d: 310, appointments_30d: 14, whatsapp_connected: true,
    last_activity_at: new Date().toISOString(), monthly_fee: 397, billing_state: 'ok', next_due_date: '2026-11-10',
  },
  {
    id: ORG_B, name: 'Harmoniza Face', status: 'active', created_at: '2026-09-10T12:00:00Z',
    admin_email: 'dona@harmoniza.test', members: 2, contacts: 45, conversations_30d: 30,
    ai_messages_30d: 90, appointments_30d: 6, whatsapp_connected: false,
    last_activity_at: null, monthly_fee: 297, billing_state: 'overdue', next_due_date: '2026-10-01',
  },
];

const charges = [
  { id: 'c1', organization_id: ORG_B, organization_name: 'Harmoniza Face', due_date: '2026-10-01', amount: 297, status: 'pending', display_status: 'overdue', paid_at: null, payment_method: null, notes: 'Outubro' },
  { id: 'c2', organization_id: ORG_A, organization_name: 'Minha Clínica', due_date: '2026-10-10', amount: 397, status: 'paid', display_status: 'paid', paid_at: '2026-10-09', payment_method: 'Pix', notes: null },
];

const alerts = [
  { severity: 'critical', kind: 'billing_overdue', organization_id: ORG_B, organization_name: 'Harmoniza Face', title: 'Mensalidade atrasada', detail: 'R$ 297,00 em aberto desde 01/10', since: '2026-10-01T00:00:00Z' },
  { severity: 'warning', kind: 'whatsapp_pending', organization_id: ORG_B, organization_name: 'Harmoniza Face', title: 'WhatsApp não conectado', detail: 'A clínica foi criada em 10/09 e ainda não conectou o WhatsApp', since: '2026-09-10T00:00:00Z' },
];

const days = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10);
  return { day: d, count: i % 5, cost_usd: (i % 4) * 0.01, tokens: i * 1000 };
});

const detailB = {
  organization: { id: ORG_B, name: 'Harmoniza Face', status: 'active', created_at: '2026-09-10T12:00:00Z', monthly_fee: 297, contact_name: 'Carla', contact_phone: '11 98888-0000', notes: 'Cobrar todo dia 1' },
  billing: { state: 'overdue', next_due_date: '2026-10-01', overdue_amount: 297 },
  members: [{ email: 'dona@harmoniza.test', role: 'admin', full_name: 'Carla', joined_at: '2026-09-10T12:00:00Z', last_sign_in_at: null }],
  settings: {
    company_name: 'Harmoniza Face', assistant_name: 'Nina', is_active: true, auto_response_enabled: true,
    whatsapp_connected: false, custom_prompt: true, prompt_preview: 'Você é a Nina, assistente da Harmoniza Face...',
    ai_model_mode: 'flash', business_hours: '09:00:00 – 18:00:00', business_days: [1, 2, 3, 4, 5],
    audio_response_enabled: false, ai_scheduling_enabled: true,
  },
  whatsapp: { connected: false, phone_number_id: null, business_account_id: null, has_token: false, verify_token: 'nina-beleza-abc', last_received_at: null, last_sent_at: null, failed_sends_7d: 0 },
  usage_30d: { contacts_total: 45, new_contacts: 10, conversations: 30, messages_received: 200, ai_messages: 90, appointments: 6, ai_tokens: 120000, ai_cost_usd: 0.12 },
  daily_ai_messages: days.map(({ day, count }) => ({ day, count })),
};

async function setup(page: Page, opts: { owner?: boolean; orgStatus?: string } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await bypassAuth(page);
  // Mesmo formato que a edge function validate-setup devolve de verdade
  await page.route(/\/functions\/v1\/validate-setup/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ component: 'identity', status: 'ok', message: 'Nina - Minha Clínica' }],
        overallStatus: 'ok',
        summary: { ok: 1, warning: 0, error: 0, total: 1, percentage: 100 },
      }),
    })
  );
  await mockRpc(page, 'is_platform_owner', opts.owner ?? true);
  await mockRpc(page, 'my_organization', [{ id: ORG_A, name: 'Minha Clínica', status: opts.orgStatus ?? 'active', role: 'admin' }]);
  await mockRpc(page, 'owner_dashboard_summary', {
    clinics_active: 2, clinics_suspended: 0, mrr: 694, received_month: 397, overdue_count: 1,
    overdue_amount: 297, due_soon_count: 0, ai_responses_30d: 400, ai_cost_month_usd: 0.42,
  });
  await mockRpc(page, 'owner_alerts', alerts);
  await mockRpc(page, 'owner_organizations_overview', clinics);
  await mockRpc(page, 'owner_list_charges', charges);
  await mockRpc(page, 'owner_organization_detail', detailB);
  await mockRpc(page, 'owner_get_clinic_config', {
    company_name: 'Harmoniza Face', sdr_name: 'Nina', is_active: true, auto_response_enabled: true,
    ai_model_mode: 'flash', system_prompt_override: null, audio_response_enabled: false,
    ai_scheduling_enabled: true, message_breaking_enabled: true, business_hours_start: '09:00:00',
    business_hours_end: '18:00:00', business_days: [1, 2, 3, 4, 5], timezone: 'America/Sao_Paulo',
    whatsapp_phone_number_id: null, whatsapp_business_account_id: null, has_whatsapp_token: false,
    whatsapp_verify_token: 'nina-beleza-abc',
  });
  await mockRpc(page, 'owner_list_procedures', [
    { id: 'p1', name: 'Botox', category: 'harmonizacao', description: null, duration_minutes: 45, price_min: 800, price_max: 1200,
      price_visible: true, contraindications: null, pre_care: null, post_care: null, is_active: true,
      professional_id: null, user_id: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
  ]);
  await mockRpc(page, 'owner_list_audit', [
    { action: 'clinic_created', details: { email: 'dona@harmoniza.test' }, actor_email: 'qa@nina-beleza.test', created_at: '2026-09-10T12:00:00Z' },
  ]);
  for (const name of ['owner_update_clinic_whatsapp', 'owner_update_clinic_agent', 'owner_update_clinic_hours', 'owner_save_procedure']) {
    await mockRpc(page, name, null);
  }
  await page.route(/\/functions\/v1\/owner-actions/, async (route) => {
    const body = route.request().postDataJSON();
    const replies: Record<string, unknown> = {
      create_clinic: { organization_id: ORG_B, access_link: 'https://nina-api.test/auth/v1/verify?token=abc&type=recovery', email: body?.email },
      resend_access: { access_link: 'https://nina-api.test/auth/v1/verify?token=def&type=recovery', email: 'dona@harmoniza.test' },
      test_whatsapp: { ok: false, message: 'Token inválido ou expirado.' },
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replies[body?.action] ?? {}) });
  });
  await mockRpc(page, 'owner_ai_usage', {
    days: 30,
    totals: { events: 500, prompt_tokens: 900000, completion_tokens: 120000, cost_usd: 0.57 },
    responses: 400,
    by_organization: [
      { id: ORG_A, name: 'Minha Clínica', status: 'active', responses: 310, tokens: 800000, cost_usd: 0.45 },
      { id: ORG_B, name: 'Harmoniza Face', status: 'active', responses: 90, tokens: 220000, cost_usd: 0.12 },
    ],
    by_kind: [{ kind: 'chat', events: 400, cost_usd: 0.5 }, { kind: 'transcription', events: 100, cost_usd: 0.07 }],
    daily: days.map(({ day, cost_usd, tokens }) => ({ day, cost_usd, tokens })),
    prices: [{ model: 'gemini-2.5-flash', input_per_million: 0.3, output_per_million: 2.5 }],
  });
  return errors;
}

async function expectHealthy(page: Page, errors: string[]) {
  await expect(page.getByText('Esta tela encontrou um erro')).toHaveCount(0);
  expect(errors, `erros de JavaScript: ${errors.join(' | ')}`).toEqual([]);
}

const ownerPages = [
  { path: '/dono/dashboard', heading: 'Dashboard', shot: 'dono-dashboard', expectText: 'Mensalidade atrasada' },
  { path: '/dono/clinicas', heading: 'Clínicas', shot: 'dono-clinicas', expectText: 'Harmoniza Face' },
  { path: '/dono/vencimentos', heading: 'Vencimentos', shot: 'dono-vencimentos', expectText: 'Em atraso' },
  { path: '/dono/consumo-ia', heading: 'Consumo de IA', shot: 'dono-consumo-ia', expectText: 'Por clínica' },
  { path: '/dono/alertas', heading: 'Alertas', shot: 'dono-alertas', expectText: 'WhatsApp não conectado' },
  { path: `/dono/clinicas/${ORG_B}`, heading: 'Harmoniza Face', shot: 'clinica-resumo', expectText: 'Uso nos últimos 30 dias' },
  { path: `/dono/clinicas/${ORG_B}/whatsapp`, heading: 'WhatsApp', shot: 'clinica-whatsapp', expectText: 'Token de verificação' },
  { path: `/dono/clinicas/${ORG_B}/agente-ia`, heading: 'Agente IA', shot: 'clinica-agente', expectText: 'Carregar prompt padrão' },
  { path: `/dono/clinicas/${ORG_B}/horarios`, heading: 'Horários', shot: 'clinica-horarios', expectText: 'Dias de atendimento' },
  { path: `/dono/clinicas/${ORG_B}/procedimentos`, heading: 'Procedimentos', shot: 'clinica-procedimentos', expectText: 'Botox' },
  { path: `/dono/clinicas/${ORG_B}/cobranca`, heading: 'Cobrança', shot: 'clinica-cobranca', expectText: 'Histórico' },
];

test.describe('Painel do Dono', () => {
  for (const p of ownerPages) {
    test(`abre ${p.path}`, async ({ page }) => {
      const errors = await setup(page);
      await page.goto(p.path);
      await expect(page.getByTestId('owner-shell')).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: p.heading })).toBeVisible();
      await expect(page.getByText(p.expectText).first()).toBeVisible();
      await page.screenshot({ path: `test-results/screens/${p.shot}.png`, fullPage: true });
      await expectHealthy(page, errors);
    });
  }

  test('/dono leva ao dashboard e tem botão para a clínica', async ({ page }) => {
    const errors = await setup(page);
    await page.goto('/dono');
    await expect(page).toHaveURL(/\/dono\/dashboard$/);
    await page.getByTestId('switch-to-clinic').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('dashboard-title')).toBeVisible();
    await expectHealthy(page, errors);
  });

  test('nova cobrança valida o valor', async ({ page }) => {
    const errors = await setup(page);
    await page.goto('/dono/vencimentos');
    await page.getByRole('button', { name: 'Nova cobrança' }).click();
    await page.locator('#charge-amount').fill('');
    await page.getByRole('button', { name: 'Criar cobrança' }).click();
    await expect(page.getByRole('alert')).toHaveText('Informe um valor maior que zero.');
    await expectHealthy(page, errors);
  });
});

test.describe('Cadastro e configuração de clínica pelo dono', () => {
  test('nova clínica valida e mostra o link de acesso', async ({ page }) => {
    const errors = await setup(page);
    await page.goto('/dono/clinicas');
    await page.getByTestId('new-clinic-button').click();
    await page.getByRole('button', { name: 'Criar clínica' }).click();
    await expect(page.getByRole('alert')).toHaveText('Informe o nome da clínica.');
    await page.locator('#new-clinic-name').fill('Studio Bella Pele');
    await page.locator('#new-clinic-owner').fill('Ana Souza');
    await page.locator('#new-clinic-email').fill('email-invalido');
    await page.getByRole('button', { name: 'Criar clínica' }).click();
    await expect(page.getByRole('alert')).toHaveText('Informe um e-mail válido.');
    await page.locator('#new-clinic-email').fill('ana@bellapele.test');
    await page.locator('#new-clinic-fee').fill('397');
    await page.getByRole('button', { name: 'Criar clínica' }).click();
    await expect(page.getByTestId('clinic-created')).toBeVisible();
    await expect(page.getByTestId('access-link')).toContainText('type=recovery');
    await expect(page.getByText('ana@bellapele.test')).toBeVisible();
    await page.screenshot({ path: 'test-results/screens/dono-nova-clinica.png' });
    await expectHealthy(page, errors);
  });

  test('reenviar acesso mostra um link novo', async ({ page }) => {
    const errors = await setup(page);
    await page.goto(`/dono/clinicas/${ORG_B}`);
    await page.getByTestId('resend-access').click();
    await expect(page.getByTestId('access-link')).toContainText('token=def');
    await expectHealthy(page, errors);
  });

  test('WhatsApp exige token na primeira vez e salva', async ({ page }) => {
    const errors = await setup(page);
    await page.goto(`/dono/clinicas/${ORG_B}/whatsapp`);
    await page.locator('#wa-phone-id').fill('104857362910');
    await page.getByRole('button', { name: 'Salvar WhatsApp' }).click();
    await expect(page.getByRole('alert')).toHaveText('Informe o token de acesso.');
    await page.locator('#wa-token').fill('EAAG-token-de-teste');
    await page.getByRole('button', { name: 'Salvar WhatsApp' }).click();
    await expect(page.getByText('WhatsApp da clínica salvo')).toBeVisible();
    await expectHealthy(page, errors);
  });

  test('agente carrega o prompt padrão e salva', async ({ page }) => {
    const errors = await setup(page);
    await page.goto(`/dono/clinicas/${ORG_B}/agente-ia`);
    await page.getByRole('button', { name: 'Carregar prompt padrão' }).click();
    await expect(page.locator('#agent-prompt')).toHaveValue(/system_instruction/);
    await page.getByRole('radio', { name: 'Avançado', exact: true }).click();
    await page.getByRole('button', { name: 'Salvar agente' }).click();
    await expect(page.getByText('Agente da clínica salvo')).toBeVisible();
    await expectHealthy(page, errors);
  });

  test('horário recusa fim antes do início', async ({ page }) => {
    const errors = await setup(page);
    await page.goto(`/dono/clinicas/${ORG_B}/horarios`);
    await page.locator('#hours-start').fill('18:00');
    await page.locator('#hours-end').fill('09:00');
    await page.getByRole('button', { name: 'Salvar horários' }).click();
    await expect(page.getByRole('alert')).toHaveText('O horário de fim precisa ser depois do início.');
    await expectHealthy(page, errors);
  });

  test('novo procedimento exige nome e salva', async ({ page }) => {
    const errors = await setup(page);
    await page.goto(`/dono/clinicas/${ORG_B}/procedimentos`);
    await page.getByRole('button', { name: 'Novo procedimento' }).click();
    await page.getByRole('button', { name: 'Salvar procedimento' }).click();
    await expect(page.getByRole('alert')).toHaveText('Informe o nome do procedimento.');
    await page.locator('#proc-name').fill('Limpeza de pele');
    await page.getByRole('button', { name: 'Salvar procedimento' }).click();
    await expect(page.getByText('Procedimento cadastrado')).toBeVisible();
    await expectHealthy(page, errors);
  });
});

test.describe('Primeiro acesso da dona', () => {
  test('link vencido mostra o aviso', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/primeiro-acesso#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await expect(page.getByText('Este link expirou ou já foi usado')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('com sessão do link, pede a senha e valida', async ({ page }) => {
    const errors = await setup(page, { owner: false });
    await page.route(/\/auth\/v1\/user/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', email: 'qa@nina-beleza.test', aud: 'authenticated', role: 'authenticated' }) })
    );
    await page.goto('/primeiro-acesso');
    await page.locator('#new-password').fill('1234');
    await page.getByRole('button', { name: 'Salvar senha e entrar' }).click();
    await expect(page.getByRole('alert')).toHaveText('A senha precisa ter pelo menos 8 caracteres.');
    await page.locator('#new-password').fill('senha-forte-123');
    await page.locator('#confirm-password').fill('senha-forte-123');
    await page.getByRole('button', { name: 'Salvar senha e entrar' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectHealthy(page, errors);
  });
});

test.describe('Painel da clínica continua igual', () => {
  const clinicPages = [
    { path: '/dashboard', testid: 'dashboard-title' },
    { path: '/settings', text: 'Configurações' },
    { path: '/pipeline' },
    { path: '/chat' },
    { path: '/contacts' },
    { path: '/scheduling' },
    { path: '/team' },
  ];

  for (const p of clinicPages) {
    test(`abre ${p.path} sem erro`, async ({ page }) => {
      const errors = await setup(page);
      await page.goto(p.path);
      await expect(page.getByTestId('sidebar-nav').first()).toBeVisible();
      if (p.testid) await expect(page.getByTestId(p.testid)).toBeVisible();
      await page.waitForTimeout(500);
      if (p.path === '/dashboard') await page.screenshot({ path: 'test-results/screens/clinica-painel.png' });
      await expectHealthy(page, errors);
    });
  }

  test('dono vê o atalho Painel do Dono no menu da clínica', async ({ page }) => {
    const errors = await setup(page);
    await page.goto('/dashboard');
    await expect(page.getByTestId('owner-nav').first()).toBeVisible();
    await expectHealthy(page, errors);
  });

  test('clínica comum não vê o atalho e não entra no /dono', async ({ page }) => {
    const errors = await setup(page, { owner: false });
    await page.goto('/dashboard');
    await expect(page.getByTestId('sidebar-nav').first()).toBeVisible();
    await expect(page.getByTestId('owner-nav')).toHaveCount(0);
    await page.goto('/dono/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectHealthy(page, errors);
  });

  test('clínica suspensa vê o aviso', async ({ page }) => {
    const errors = await setup(page, { owner: false, orgStatus: 'suspended' });
    await page.goto('/dashboard');
    await expect(page.getByText('Acesso suspenso')).toBeVisible();
    await expectHealthy(page, errors);
  });
});
