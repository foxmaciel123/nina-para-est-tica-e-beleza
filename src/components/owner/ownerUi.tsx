import React from 'react';

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

const toneClasses: Record<Tone, string> = {
  ok: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  warn: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  bad: 'bg-red-500/10 text-red-500 border-red-500/20',
  neutral: 'bg-muted text-muted-foreground border-border',
};

export const Chip: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${toneClasses[tone]}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
    {children}
  </span>
);

export const StatusChip: React.FC<{ status: string }> = ({ status }) =>
  status === 'active' ? <Chip tone="ok">Ativa</Chip> : <Chip tone="bad">Suspensa</Chip>;

export const WhatsAppChip: React.FC<{ connected: boolean }> = ({ connected }) =>
  connected ? <Chip tone="ok">Conectado</Chip> : <Chip tone="warn">Pendente</Chip>;

const numberFormatter = new Intl.NumberFormat('pt-BR');
export const formatNumber = (n: number | null | undefined) => numberFormatter.format(Number(n ?? 0));

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export const formatRelative = (iso: string | null | undefined) => {
  if (!iso) return 'sem atividade';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `há ${diffD} ${diffD === 1 ? 'dia' : 'dias'}`;
  return formatDate(iso);
};

export const OwnerEyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[11px] uppercase tracking-[0.35em] text-accent font-semibold">{children}</p>
);
