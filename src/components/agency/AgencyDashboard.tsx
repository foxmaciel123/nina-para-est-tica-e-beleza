import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bot, Building2, ChevronRight, CircleDollarSign, MessageCircle, Receipt, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { AlertRow } from '@/components/owner/OwnerAlerts';
import { ErrorNote, PageHeader, PageLoader, Panel, Stat, formatBRL, formatNumber } from '@/components/owner/ownerUi';

type AlertItem = Database['public']['Functions']['owner_alerts']['Returns'][number];

interface Summary {
  agency_name: string;
  clinics_active: number;
  clinics_suspended: number;
  whatsapp_connected: number;
  ai_responses_30d: number;
  fee_per_clinic: number | null;
  mrr: number;
  received_month: number;
  overdue_count: number;
  overdue_amount: number;
}

const AgencyDashboard: React.FC = () => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [s, a] = await Promise.all([supabase.rpc('agency_dashboard_summary' as any), supabase.rpc('owner_alerts')]);
    if (s.error || a.error) {
      console.error('[AgencyDashboard]', s.error ?? a.error);
      setError('Não foi possível carregar a visão geral.');
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
  const invoice = summary?.fee_per_clinic == null ? null : Number(summary.fee_per_clinic) * Number(summary.clinics_active);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6" data-testid="agency-dashboard">
      <PageHeader
        eyebrow="Painel da Agência"
        title={summary?.agency_name ? `Visão geral · ${summary.agency_name}` : 'Visão geral'}
        description="Como estão as suas empresas, as mensalidades delas e o atendimento da IA."
      />

      {error && <ErrorNote message={error} onRetry={load} />}

      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label="Empresas ativas"
            value={formatNumber(summary.clinics_active)}
            hint={summary.clinics_suspended > 0 ? `${formatNumber(summary.clinics_suspended)} suspensa(s)` : 'Nenhuma suspensa'}
            icon={Building2}
          />
          <Stat
            label="WhatsApp conectado"
            value={`${formatNumber(summary.whatsapp_connected)} de ${formatNumber(summary.clinics_active)}`}
            icon={MessageCircle}
            tone={summary.whatsapp_connected < summary.clinics_active ? 'warn' : 'default'}
          />
          <Stat label="Respostas da IA · 30 dias" value={formatNumber(summary.ai_responses_30d)} icon={Bot} />
          <Stat
            label="Sua fatura do mês"
            value={invoice == null ? 'A combinar' : formatBRL(invoice)}
            hint={summary.fee_per_clinic == null ? 'Valor por empresa ainda não definido' : `${formatNumber(summary.clinics_active)} empresa(s) × ${formatBRL(summary.fee_per_clinic)}`}
            icon={Receipt}
          />
          <Stat label="Mensalidades das empresas" value={formatBRL(summary.mrr)} hint="Soma do que você cobra das empresas ativas" icon={Wallet} />
          <Stat label="Recebido no mês" value={formatBRL(summary.received_month)} icon={CircleDollarSign} />
          <Stat
            label="Em atraso"
            value={formatBRL(summary.overdue_amount)}
            hint={`${formatNumber(summary.overdue_count)} empresa(s)`}
            icon={AlertTriangle}
            tone={summary.overdue_count > 0 ? 'bad' : 'default'}
          />
        </div>
      )}

      <Panel
        title="Precisa de atenção"
        actions={
          <Link to="/agencia/alertas" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
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

export default AgencyDashboard;
