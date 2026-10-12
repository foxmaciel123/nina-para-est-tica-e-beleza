// Configuração padrão de uma clínica nova (usada pelo initialize-system e pelo
// cadastro de clínica no Painel do Dono).

// Generate a unique verify token
export function generateVerifyToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'nina-beleza-';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Default pipeline stages
export const DEFAULT_PIPELINE_STAGES = [
  { position: 0, title: 'Novas Interessadas', color: 'border-pink-500', is_system: false, is_ai_managed: false },
  { position: 1, title: 'Avaliação Agendada', color: 'border-rose-500', is_system: false, is_ai_managed: true },
  { position: 2, title: 'Pós-avaliação', color: 'border-fuchsia-500', is_system: false, is_ai_managed: true },
  { position: 3, title: 'Negociando Pacote', color: 'border-amber-500', is_system: false, is_ai_managed: false },
  { position: 100, title: 'Ganho', color: 'border-green-500', is_system: true, is_ai_managed: false },
  { position: 101, title: 'Perdido', color: 'border-red-500', is_system: true, is_ai_managed: false },
];

// Default tag definitions
export const DEFAULT_TAG_DEFINITIONS = [
  { key: 'hot_lead', label: 'Pronta pra agendar', color: '#ef4444', category: 'status' },
  { key: 'warm_lead', label: 'Interessada', color: '#f97316', category: 'status' },
  { key: 'cold_lead', label: 'Só pesquisando', color: '#3b82f6', category: 'status' },
  { key: 'qualified', label: 'Perfil ideal', color: '#22c55e', category: 'qualification' },
  { key: 'unqualified', label: 'Fora do perfil', color: '#6b7280', category: 'qualification' },
  { key: 'interested', label: 'Quer saber valores', color: '#8b5cf6', category: 'interest' },
  { key: 'follow_up', label: 'Retomar contato', color: '#eab308', category: 'action' },
  { key: 'demo_requested', label: 'Avaliação solicitada', color: '#06b6d4', category: 'action' },
];

// Default teams
export const DEFAULT_TEAMS = [
  { name: 'Recepção', description: 'Atendimento e agendamento', color: '#ec4899', is_active: true },
  { name: 'Procedimentos', description: 'Profissionais que realizam os atendimentos', color: '#22c55e', is_active: true },
];

// Default team functions
export const DEFAULT_TEAM_FUNCTIONS = [
  { name: 'Recepcionista', description: 'Atende, agenda e confirma horários', is_active: true },
  { name: 'Esteticista', description: 'Realiza avaliações e procedimentos', is_active: true },
  { name: 'Gestora', description: 'Acompanha pacotes, financeiro e pós-atendimento', is_active: true },
];

// Default nina_settings values for a fresh system
export const DEFAULT_NINA_SETTINGS = {
  is_active: true,
  auto_response_enabled: true,
  ai_model_mode: 'flash',
  timezone: 'America/Sao_Paulo',
  business_hours_start: '09:00:00',
  business_hours_end: '18:00:00',
  business_days: [1, 2, 3, 4, 5],
  audio_response_enabled: false,
  response_delay_min: 1000,
  response_delay_max: 3000,
  message_breaking_enabled: true,
  adaptive_response_enabled: true,
  ai_scheduling_enabled: true,
  route_all_to_receiver_enabled: false,
  company_name: 'Minha Clínica',
  sdr_name: 'Assistente',
  // null = usa o prompt padrão de beleza/estética (DEFAULT_NINA_PROMPT)
  system_prompt_override: null,
};

// Cria a configuração padrão de uma clínica (assistente, funil, etiquetas, equipes).
// Idempotente: só cria o que a clínica ainda não tem. Devolve o verify token.
export async function seedClinicDefaults(supabase: any, orgId: string, companyName?: string): Promise<string> {
  const { data: existing } = await supabase
    .from('nina_settings')
    .select('whatsapp_verify_token')
    .eq('organization_id', orgId)
    .maybeSingle();

  let verifyToken = existing?.whatsapp_verify_token ?? '';
  if (!existing) {
    verifyToken = generateVerifyToken();
    const { error } = await supabase.from('nina_settings').insert({
      ...DEFAULT_NINA_SETTINGS,
      company_name: companyName || DEFAULT_NINA_SETTINGS.company_name,
      whatsapp_verify_token: verifyToken,
      organization_id: orgId,
      user_id: null,
    });
    if (error && error.code !== '23505') throw error;
  }

  const seeds: Array<[string, Record<string, unknown>[]]> = [
    ['pipeline_stages', DEFAULT_PIPELINE_STAGES],
    ['tag_definitions', DEFAULT_TAG_DEFINITIONS],
    ['teams', DEFAULT_TEAMS],
    ['team_functions', DEFAULT_TEAM_FUNCTIONS],
  ];
  for (const [table, rows] of seeds) {
    const { count } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId);
    if (count && count > 0) continue;
    const { error } = await supabase
      .from(table)
      .insert(rows.map((row) => ({ ...row, organization_id: orgId, user_id: null })));
    if (error) throw error;
  }

  return verifyToken;
}