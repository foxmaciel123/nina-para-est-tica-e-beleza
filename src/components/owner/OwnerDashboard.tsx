import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Wallet, CircleDollarSign, AlertTriangle, Cpu, Bot, ChevronRight, Briefcase } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { ErrorNote, PageHeader, PageLoader, Panel, Stat, formatBRL, formatNumber, formatUSD } from './ownerUi';
import { AlertRow } from './OwnerAlerts';

type AlertItem = Database['public']['Functions']['owner_alerts']['Returns'][number];

interface Summary {
  clinics_active: number;
  clinics_suspended: number;
  mrr: number;
  received_month: number;
  overdue_count: number;
  overdue_amount: number;
  due_soon_count: number;
  ai_responses_30d: number;
  ai_cost_month_usd: number;
  agencies_active?: number;
  clinics_via_agencies?: number;
  agency_fees_month?: number;
}

const OwnerDashboard: React.FC = () => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [s, a] = await Promise.all([supabase.rpc('owner_dashboard_summary'), supabase.rpc('owner_alerts')]);
    if (s.error || a.error) {
      console.error('[OwnerDashboard]', s.error ?? a.error);
      setError('Não foi possível carregar o dashboard.');
    } else {
      setSummary(s.data as unknown as Summary);
      setAlerts(a.data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <PageLoader />;

  const attention = alerts.filter((a) => a.severity !== 'info').slice(0, 6);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6" data-testid="owner-dashboard">
      <PageHeader eyebrow="Painel do Dono" title="Dashboard" description="Como estão as empresas, as mensalidades e o consumo da IA." />

      {error && <ErrorNote message={error} onRetry={load} />}

      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Receita prevista no mês" value={formatBRL(summary.mrr)} hint="Mensalidades das suas empresas diretas ativas" icon={Wallet} />
          <Stat label="Recebido no mês" value={formatBRL(summary.received_month)} icon={CircleDollarSign} />
          <Stat
            label="Em atraso"
            value={formatBRL(summary.overdue_amount)}
            hint={`${formatNumber(summary.overdue_count)} empresa(s) · ${formatNumber(summary.due_soon_count)} vencendo em até 5 dias`}
            icon={AlertTriangle}
            tone={summary.overdue_count > 0 ? 'bad' : 'default'}
          />
          <Stat
            label="Empresas ativas"
            value={formatNumber(summary.clinics_active)}
            hint={summary.clinics_suspended > 0 ? `${formatNumber(summary.clinics_suspended)} suspensa(s)` : 'Nenhuma suspensa'}
            icon={Building2}
          />
          <Stat label="Respostas da IA · 30 dias" value={formatNumber(summary.ai_responses_30d)} icon={Bot} />
          <Stat label="Custo da IA no mês" value={formatUSD(summary.ai_cost_month_usd)} hint="Estimado pelos tokens usados" icon={Cpu} />
          <Stat
            label="Agências ativas"
            value={formatNumber(summary.agencies_active ?? 0)}
            hint={`${formatNumber(summary.clinics_via_agencies ?? 0)} empresa(s) ativa(s) por agências`}
            icon={Briefcase}
          />
          <Stat label="A receber das agências no mês" value={formatBRL(summary.agency_fees_month ?? 0)} hint="Empresas ativas × valor combinado de cada agência" icon={Wallet} />
        </div>
      )}

      <Panel
        title="Precisa de atenção"
        actions={
          <Link to="/dono/alertas" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            Ver todos os alertas <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        {attention.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada pendente. Mensalidades em dia e a assistente respondendo em todas as empresas.</p>
        ) : (
          <ul className="flex flex-col">
            {attention.map((alert, i) => (
              <AlertRow key={`${alert.kind}-${alert.organization_id}-${i}`} alert={alert} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
};

export default OwnerDashboard;
