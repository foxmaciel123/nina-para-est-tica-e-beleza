import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Info, Link2, Loader2, Megaphone, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { Button } from '../Button';
import { db } from '../outbound/useOutbound';
import AdsConnectionDialog, { type AdsConnection } from './AdsConnectionDialog';
import {
  brl, costPerSale, cpl, groupRows, int, leadToSale, normalizeRow, pct, roas, roasLabel, totals, verdict,
  type AdsReportRow, type Level,
} from './adsMath';

type Period = '7d' | '30d' | 'month' | 'last_month';
const PERIODS: { id: Period; label: string }[] = [
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'month', label: 'Este mês' },
  { id: 'last_month', label: 'Mês passado' },
];

// Datas no fuso de São Paulo (o relatório também conta assim)
function spToday(): Date {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  return new Date(`${s}T12:00:00Z`);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
function range(p: Period): { from: string; to: string } {
  const t = spToday();
  const day = 86_400_000;
  if (p === '7d') return { from: iso(new Date(t.getTime() - 6 * day)), to: iso(t) };
  if (p === '30d') return { from: iso(new Date(t.getTime() - 29 * day)), to: iso(t) };
  const y = t.getUTCFullYear(), m = t.getUTCMonth();
  if (p === 'month') return { from: iso(new Date(Date.UTC(y, m, 1, 12))), to: iso(t) };
  return { from: iso(new Date(Date.UTC(y, m - 1, 1, 12))), to: iso(new Date(Date.UTC(y, m, 0, 12))) };
}

const TONE: Record<string, string> = {
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  neutral: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  bad: 'border-red-500/30 bg-red-500/10 text-red-300',
};

const Kpi: React.FC<{ label: string; value: string; hint?: string; strong?: boolean }> = ({ label, value, hint, strong }) => (
  <div className={`rounded-2xl border p-4 ${strong ? 'border-primary/40 bg-primary/10' : 'border-border bg-card/60'}`}>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
    {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
  </div>
);

const Anuncios: React.FC = () => {
  const { organization } = useOrganization();
  const isAdmin = organization?.role === 'admin';
  const [period, setPeriod] = useState<Period>('30d');
  const [level, setLevel] = useState<Level>('campaign');
  const [rows, setRows] = useState<AdsReportRow[]>([]);
  const [conn, setConn] = useState<AdsConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showConn, setShowConn] = useState(false);

  const load = useCallback(async () => {
    const { from, to } = range(period);
    const [rep, st] = await Promise.all([
      db.rpc('ads_report', { p_from: from, p_to: to }),
      db.rpc('ads_connection_status'),
    ]);
    if (rep.error) toast.error(rep.error.message);
    setRows((rep.data ?? []).map(normalizeRow));
    setConn((st.data as AdsConnection) ?? null);
    setLoading(false);
  }, [period]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    const { data, error } = await db.functions.invoke('meta-ads-sync', { body: { action: 'sync' } });
    setSyncing(false);
    if (error) return toast.error('Não foi possível falar com a Meta agora.');
    if (data?.error) toast.warning(data.error);
    else toast.success('Investimento atualizado');
    load();
  };

  const connected = !!(conn?.ad_account_id && conn?.has_token);
  const all = useMemo(() => totals(rows), [rows]);
  const ads = useMemo(() => totals(rows, true), [rows]);
  const groups = useMemo(() => groupRows(rows, level), [rows, level]);
  const avgCpl = cpl(ads);

  return (
    <div className="relative h-full overflow-y-auto bg-background p-4 text-foreground sm:p-8 custom-scrollbar" data-testid="ads-root">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight" data-testid="ads-title">
            <Megaphone className="h-7 w-7 text-primary" /> Anúncios
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Qual anúncio traz cliente, agendamento e venda. Para o gestor de tráfego saber onde colocar o dinheiro.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1" role="tablist" aria-label="Período">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={period === p.id}
                onClick={() => setPeriod(p.id)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  period === p.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {connected && (
            <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Atualizar da Meta
            </Button>
          )}
          <Button variant={connected ? 'ghost' : 'primary'} size="sm" onClick={() => setShowConn(true)}>
            <Link2 className="mr-2 h-4 w-4" /> {connected ? 'Conta de anúncios' : 'Conectar conta de anúncios'}
          </Button>
        </div>
      </div>

      {!loading && !connected && (
        <div className="mb-6 flex gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
          <div>
            <p className="font-medium">Leads e vendas por anúncio já estão sendo rastreados.</p>
            <p className="text-muted-foreground">
              Conecte a conta de anúncios para ver também o investimento, os nomes das campanhas, o custo por lead e o ROAS.
            </p>
          </div>
        </div>
      )}
      {conn?.last_sync_error && (
        <div className="mb-6 flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <p>{conn.last_sync_error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Investimento" value={brl(ads.spend)} hint={connected ? undefined : 'conecte a conta'} />
            <Kpi label="Leads de anúncio" value={int(ads.leads)} hint={`${int(all.leads)} no total`} />
            <Kpi label="Custo por lead (CPL)" value={brl(cpl(ads))} />
            <Kpi label="Agendamentos de anúncio" value={int(ads.appointments)} hint={`${int(all.appointments)} no total`} />
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Vendas de anúncio" value={int(ads.sales)} hint={`conversão ${pct(leadToSale(ads))}`} />
            <Kpi label="Faturamento de anúncio" value={brl(ads.revenue)} hint={`${brl(all.revenue)} no total`} strong />
            <Kpi label="Custo por venda" value={brl(costPerSale(ads))} />
            <Kpi label="ROAS" value={roasLabel(roas(ads))} hint="faturamento ÷ investimento" strong />
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-lg font-semibold"><BarChart3 className="h-5 w-5 text-primary" /> Resultado por</h3>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1" role="tablist" aria-label="Agrupar por">
              {([['campaign', 'Campanha'], ['adset', 'Conjunto'], ['ad', 'Anúncio']] as [Level, string][]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={level === id}
                  onClick={() => setLevel(id)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    level === id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Nenhum lead, venda ou investimento neste período ainda.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[920px] text-sm" data-testid="ads-table">
                <thead className="bg-card/80 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Nome</th>
                    <th className="px-3 py-3 text-right font-medium">Investimento</th>
                    <th className="px-3 py-3 text-right font-medium">Leads</th>
                    <th className="px-3 py-3 text-right font-medium">CPL</th>
                    <th className="px-3 py-3 text-right font-medium">Agend.</th>
                    <th className="px-3 py-3 text-right font-medium">Vendas</th>
                    <th className="px-3 py-3 text-right font-medium">Faturamento</th>
                    <th className="px-3 py-3 text-right font-medium">Custo/venda</th>
                    <th className="px-3 py-3 text-right font-medium">ROAS</th>
                    <th className="px-4 py-3 text-left font-medium">Leitura</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const v = verdict(g, avgCpl);
                    return (
                      <tr key={g.key} className={`border-t border-border ${g.organic ? 'bg-card/30 text-muted-foreground' : ''}`}>
                        <td className="max-w-[320px] px-4 py-3">
                          <p className="truncate font-medium text-foreground" title={g.name}>{g.name}</p>
                          {g.subtitle && <p className="truncate text-xs text-muted-foreground" title={g.subtitle}>{g.subtitle}</p>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{g.organic ? '–' : brl(g.spend)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{int(g.leads)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{g.organic ? '–' : brl(cpl(g))}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{int(g.appointments)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{int(g.sales)}</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums">{brl(g.revenue)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{g.organic ? '–' : brl(costPerSale(g))}</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums">{g.organic ? '–' : roasLabel(roas(g))}</td>
                        <td className="px-4 py-3">
                          {v && (
                            <span title={v.hint} className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[v.tone]}`}>
                              {v.label}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-border bg-card/40 p-4 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Como a Nina conta</p>
            Lead = cliente que chegou no período (pelo 1º anúncio que ela clicou). Agendamento e venda vão para o anúncio que trouxe a
            cliente, mesmo que aconteçam dias depois. Venda = card do Funil em "Ganho" com valor, ou "Registrar venda" no Atendimento.
            A origem vem da Meta na 1ª mensagem do anúncio de clique para o WhatsApp (API oficial; no WhatsApp por QR nem sempre vem).
            {conn?.last_sync_at && <> Investimento atualizado em {new Date(conn.last_sync_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.</>}
          </div>
        </>
      )}

      <AdsConnectionDialog open={showConn} onOpenChange={setShowConn} connection={conn} isAdmin={isAdmin} onSaved={load} />
    </div>
  );
};

export default Anuncios;
