import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { ErrorNote, PageHeader, PageLoader, Panel, Stat, StatusChip, formatNumber, formatUSD } from './ownerUi';

interface UsageData {
  days: number;
  totals: { events: number; prompt_tokens: number; completion_tokens: number; cost_usd: number };
  responses: number;
  by_organization: { id: string; name: string; status: string; responses: number; tokens: number; cost_usd: number }[];
  by_kind: { kind: string; events: number; cost_usd: number }[];
  daily: { day: string; cost_usd: number; tokens: number }[];
  prices: { model: string; input_per_million: number; output_per_million: number }[];
}

const KIND_LABEL: Record<string, string> = {
  chat: 'Respostas da IA',
  analysis: 'Análise de conversas',
  transcription: 'Transcrição de áudios',
  prompt: 'Gerador de prompt',
};

const PERIODS = [7, 30, 90];

const OwnerAiUsage: React.FC = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (d: number) => {
    setLoading(true);
    setError(null);
    const { data: res, error: rpcError } = await supabase.rpc('owner_ai_usage', { p_days: d });
    if (rpcError) {
      console.error('[OwnerAiUsage]', rpcError);
      setError('Não foi possível carregar o consumo de IA.');
    } else {
      setData(res as unknown as UsageData);
    }
    setLoading(false);
  };

  useEffect(() => {
    load(days);
  }, [days]);

  const chartData = (data?.daily ?? []).map((d) => ({
    label: new Date(`${d.day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    cost: Number(d.cost_usd),
  }));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6" data-testid="owner-ai-usage">
      <PageHeader
        eyebrow="Painel do Dono · IA"
        title="Consumo de IA"
        description="Quanto cada clínica usa da IA. O custo é estimado pelos tokens e pelos preços abaixo."
        actions={
          <div className="flex gap-1 rounded-lg border border-border bg-card p-1" role="tablist" aria-label="Período">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={days === p}
                onClick={() => setDays(p)}
                className={`rounded-md px-3 py-1 text-xs font-medium ${days === p ? 'bg-accent/15 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {p} dias
              </button>
            ))}
          </div>
        }
      />

      {error && <ErrorNote message={error} onRetry={() => load(days)} />}

      {loading || !data ? (
        <PageLoader />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Custo estimado" value={formatUSD(data.totals.cost_usd)} hint={`Últimos ${data.days} dias`} />
            <Stat label="Respostas da IA" value={formatNumber(data.responses)} />
            <Stat label="Tokens de entrada" value={formatNumber(data.totals.prompt_tokens)} />
            <Stat label="Tokens de saída" value={formatNumber(data.totals.completion_tokens)} />
          </div>

          <Panel title="Custo por dia (US$)">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" minTickGap={24} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                    formatter={(value: number) => [formatUSD(value), 'Custo']}
                  />
                  <Bar dataKey="cost" fill="hsl(var(--accent))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Por clínica">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Clínica</th>
                    <th className="px-3 py-2 text-right font-semibold">Respostas</th>
                    <th className="px-3 py-2 text-right font-semibold">Tokens</th>
                    <th className="px-3 py-2 text-right font-semibold">Custo</th>
                    <th className="px-3 py-2 text-right font-semibold">Por resposta</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_organization.map((o) => (
                    <tr key={o.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2.5">
                        <Link to={`/dono/clinicas/${o.id}`} className="font-medium hover:underline">{o.name}</Link>
                        {o.status !== 'active' && <span className="ml-2"><StatusChip status={o.status} /></span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(o.responses)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(o.tokens)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatUSD(o.cost_usd)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {o.responses > 0 ? formatUSD(Number(o.cost_usd) / o.responses) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Por tipo de uso">
              {data.by_kind.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ainda não houve uso de IA no período. O consumo passa a ser registrado assim que a assistente responder.</p>
              ) : (
                <ul className="flex flex-col">
                  {data.by_kind.map((k) => (
                    <li key={k.kind} className="flex items-center justify-between border-b border-border/60 py-2 text-sm last:border-0">
                      <span>{KIND_LABEL[k.kind] ?? k.kind}</span>
                      <span className="tabular-nums text-muted-foreground">{formatNumber(k.events)} chamadas · {formatUSD(k.cost_usd)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Preços usados no cálculo">
              <ul className="flex flex-col">
                {data.prices.map((p) => (
                  <li key={p.model} className="flex items-center justify-between border-b border-border/60 py-2 text-sm last:border-0">
                    <span className="font-mono text-xs">{p.model}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatUSD(p.input_per_million)} entrada · {formatUSD(p.output_per_million)} saída / milhão
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Se o Google mudar os preços, a tabela precisa ser atualizada para o custo continuar certo.</p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
};

export default OwnerAiUsage;
