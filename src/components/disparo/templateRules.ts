// Regras e modelos prontos para criar modelos (templates) do WhatsApp.
// As mesmas regras são conferidas de novo no servidor (whatsapp-templates).

export type TemplateDraft = {
  name: string;
  category: 'UTILITY' | 'MARKETING';
  language: 'pt_BR' | 'en_US' | 'es';
  header: string;
  body: string;
  footer: string;
  buttons: string[];
  examples: string[];
};

export const EMPTY_DRAFT: TemplateDraft = {
  name: '',
  category: 'UTILITY',
  language: 'pt_BR',
  header: '',
  body: '',
  footer: '',
  buttons: [],
  examples: [],
};

// "Lembrete de Consulta!" -> "lembrete_de_consulta"
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export function countVars(body: string): number {
  const found = [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => Number(m[1]));
  return found.length ? Math.max(...found) : 0;
}

// Devolve o problema do texto (em português) ou null se estiver ok
export function bodyProblem(body: string): string | null {
  const text = body.trim();
  if (!text) return 'Escreva o texto da mensagem.';
  if (text.length > 1024) return 'O texto pode ter no máximo 1.024 caracteres.';
  if (/\{\{(?!\s*\d+\s*\}\})/.test(text)) return 'Use as variáveis só no formato {{1}}, {{2}}...';
  const unique = [...new Set([...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
  for (let i = 0; i < unique.length; i++) {
    if (unique[i] !== i + 1) return 'As variáveis precisam ser em sequência: {{1}}, {{2}}, {{3}}...';
  }
  if (/^\{\{\s*\d+\s*\}\}/.test(text) || /\{\{\s*\d+\s*\}\}[\s.!?]*$/.test(text)) {
    return 'A Meta não aceita variável no começo nem no fim do texto. Coloque alguma palavra antes e depois.';
  }
  if (/\}\}\s*\{\{/.test(text)) return 'Coloque alguma palavra entre duas variáveis seguidas.';
  const words = (text.replace(/\{\{\s*\d+\s*\}\}/g, ' ').match(/\p{L}+/gu) ?? []).length;
  if (unique.length > 0 && words < unique.length * 2) {
    return 'Texto curto demais para tantas variáveis. Escreva mais palavras fixas na mensagem.';
  }
  return null;
}

export function draftProblem(d: TemplateDraft): string | null {
  if (!/^[a-z0-9_]{1,512}$/.test(d.name)) return 'Dê um nome ao modelo (só letras minúsculas, números e _).';
  const b = bodyProblem(d.body);
  if (b) return b;
  const vars = countVars(d.body);
  if (d.examples.slice(0, vars).filter(x => x.trim()).length < vars) return 'Preencha um exemplo para cada variável.';
  if (d.header.length > 60) return 'O título pode ter no máximo 60 caracteres.';
  if (d.footer.length > 60) return 'O rodapé pode ter no máximo 60 caracteres.';
  if (/\{\{/.test(d.header) || /\{\{/.test(d.footer)) return 'Variáveis só no texto da mensagem, não no título nem no rodapé.';
  if (d.buttons.some(b => b.trim().length > 25)) return 'Cada botão pode ter no máximo 25 caracteres.';
  return null;
}

export function fillExamples(body: string, examples: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, i) => examples[Number(i) - 1]?.trim() || `{{${i}}}`);
}

export const TEMPLATE_STATUS: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: 'Aprovado', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  PENDING: { label: 'Em análise', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  REJECTED: { label: 'Rejeitado', cls: 'border-red-500/30 bg-red-500/10 text-red-300' },
  PAUSED: { label: 'Pausado', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  DISABLED: { label: 'Desativado', cls: 'border-border text-muted-foreground' },
  IN_APPEAL: { label: 'Em recurso', cls: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
};

export const REJECTED_REASON: Record<string, string> = {
  INVALID_FORMAT: 'formato inválido (confira variáveis e exemplos)',
  PROMOTIONAL: 'tem conteúdo de promoção: crie de novo na categoria Marketing',
  INCORRECT_CATEGORY: 'categoria errada: crie de novo na outra categoria',
  TAG_CONTENT_MISMATCH: 'o texto não combina com a categoria escolhida',
  ABUSIVE_CONTENT: 'conteúdo não permitido pela Meta',
  SCAM: 'parece golpe para a Meta',
};

export const LANGUAGE_LABEL: Record<string, string> = { pt_BR: 'Português (Brasil)', en_US: 'Inglês (EUA)', es: 'Espanhol' };

// Modelos prontos para clínicas de estética
export const PRESETS: { label: string; draft: TemplateDraft }[] = [
  {
    label: 'Lembrete de horário',
    draft: {
      ...EMPTY_DRAFT,
      name: 'lembrete_horario',
      category: 'UTILITY',
      body: 'Olá {{1}}, passando para lembrar do seu horário de {{2}} amanhã às {{3}} aqui na clínica. Podemos confirmar sua presença?',
      buttons: ['Confirmo', 'Preciso remarcar'],
      examples: ['Maria', 'limpeza de pele', '14h'],
    },
  },
  {
    label: 'Confirmação de agendamento',
    draft: {
      ...EMPTY_DRAFT,
      name: 'confirmacao_agendamento',
      category: 'UTILITY',
      body: 'Olá {{1}}, seu agendamento de {{2}} está confirmado para {{3}}. Qualquer dúvida, é só responder esta mensagem.',
      examples: ['Maria', 'drenagem linfática', '25/11 às 10h'],
    },
  },
  {
    label: 'Cuidados pós-procedimento',
    draft: {
      ...EMPTY_DRAFT,
      name: 'pos_procedimento',
      category: 'UTILITY',
      body: 'Olá {{1}}, tudo bem? Queremos saber como você está depois do seu procedimento de {{2}}. Se tiver qualquer dúvida sobre os cuidados, é só responder aqui.',
      examples: ['Maria', 'peeling'],
    },
  },
  {
    label: 'Volta de cliente (promoção)',
    draft: {
      ...EMPTY_DRAFT,
      name: 'volta_cliente',
      category: 'MARKETING',
      body: 'Olá {{1}}, sentimos sua falta! Este mês temos condições especiais em {{2}} para clientes da casa. Quer que eu veja um horário para você?',
      footer: 'Responda SAIR para não receber mais',
      buttons: ['Quero ver horários', 'Agora não'],
      examples: ['Maria', 'limpeza de pele'],
    },
  },
];
