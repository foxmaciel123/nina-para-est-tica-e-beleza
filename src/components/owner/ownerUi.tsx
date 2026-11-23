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

// Situação da mensalidade da empresa (owner_organizations_overview.billing_state)
export const BillingChip: React.FC<{ state: string | null | undefined }> = ({ state }) => {
  switch (state) {
    case 'overdue': return <Chip tone="bad">Atrasada</Chip>;
    case 'due_soon': return <Chip tone="warn">Vence em breve</Chip>;
    case 'ok': return <Chip tone="ok">Em dia</Chip>;
    default: return <Chip tone="neutral">Sem cobrança</Chip>;
  }
};

// Situação de uma cobrança (owner_list_charges.display_status)
export const ChargeChip: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'paid': return <Chip tone="ok">Paga</Chip>;
    case 'overdue': return <Chip tone="bad">Atrasada</Chip>;
    case 'due_soon': return <Chip tone="warn">Vence em breve</Chip>;
    case 'canceled': return <Chip tone="neutral">Cancelada</Chip>;
    default: return <Chip tone="neutral">A vencer</Chip>;
  }
};

const numberFormatter = new Intl.NumberFormat('pt-BR');
export const formatNumber = (n: number | null | undefined) => numberFormatter.format(Number(n ?? 0));

const brlFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatBRL = (n: number | string | null | undefined) => brlFormatter.format(Number(n ?? 0));

const usdFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
export const formatUSD = (n: number | string | null | undefined) => usdFormatter.format(Number(n ?? 0));

// Datas vindas como 'YYYY-MM-DD' (date do Postgres) — sem converter fuso
export const formatDay = (day: string | null | undefined) => {
  if (!day) return '—';
  const [y, m, d] = day.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const todayISO = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export const PageHeader: React.FC<{ eyebrow: string; title: string; description?: string; actions?: React.ReactNode }> = ({ eyebrow, title, description, actions }) => (
  <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="flex flex-col gap-1">
      <OwnerEyebrow>{eyebrow}</OwnerEyebrow>
      <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
      {description && <p className="text-muted-foreground">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </header>
);

export const Panel: React.FC<{ title?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode }> = ({ title, children, className = '', actions }) => (
  <section className={`flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm ${className}`}>
    {(title || actions) && (
      <div className="flex items-center justify-between gap-3">
        {title && <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>}
        {actions}
      </div>
    )}
    {children}
  </section>
);

export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; icon?: React.ElementType; tone?: 'default' | 'bad' | 'warn' }> = ({ label, value, hint, icon: Icon, tone = 'default' }) => (
  <div className={`rounded-2xl border bg-card/60 p-5 backdrop-blur-sm ${tone === 'bad' ? 'border-red-500/30' : tone === 'warn' ? 'border-amber-500/30' : 'border-border'}`}>
    <div className="flex items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
      <span>{label}</span>
      {Icon && <Icon className="h-4 w-4 text-accent" />}
    </div>
    <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</div>
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>
);

export const PageLoader: React.FC = () => (
  <div className="flex h-full min-h-[240px] items-center justify-center">
    <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="Carregando" />
  </div>
);

export const ErrorNote: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
    <span className="flex-1">{message}</span>
    {onRetry && (
      <button type="button" onClick={onRetry} className="rounded-md border border-destructive/40 px-3 py-1 text-xs font-semibold hover:bg-destructive/10">
        Tentar de novo
      </button>
    )}
  </div>
);

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
