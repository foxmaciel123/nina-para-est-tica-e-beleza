import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, Info, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { ErrorNote, PageHeader, PageLoader, Panel } from './ownerUi';
import { clinicPathForAlert, usePanel } from './panelScope';

type AlertItem = Database['public']['Functions']['owner_alerts']['Returns'][number];

const SEVERITY = {
  critical: { icon: AlertOctagon, className: 'text-red-500', label: 'Crítico' },
  warning: { icon: AlertTriangle, className: 'text-amber-500', label: 'Atenção' },
  info: { icon: Info, className: 'text-muted-foreground', label: 'Informativo' },
} as const;

const severityOf = (s: string) => SEVERITY[(s as keyof typeof SEVERITY)] ?? SEVERITY.info;

export const AlertRow: React.FC<{ alert: AlertItem }> = ({ alert }) => {
  const sev = severityOf(alert.severity);
  const panel = usePanel();
  const content = (
    <>
      <sev.icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${sev.className}`} aria-label={sev.label} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          {alert.title}
          {alert.organization_name && <span className="font-normal text-muted-foreground"> · {alert.organization_name}</span>}
        </div>
        <div className="text-xs text-muted-foreground">{alert.detail}</div>
      </div>
      {alert.organization_id && <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />}
    </>
  );

  return (
    <li className="border-b border-border/60 last:border-0">
      {alert.organization_id ? (
        <Link
          to={clinicPathForAlert(panel.base, alert.organization_id, alert.kind)}
          className="flex items-start gap-3 rounded-md px-1 py-3 hover:bg-muted/40"
        >
          {content}
        </Link>
      ) : (
        <div className="flex items-start gap-3 px-1 py-3">{content}</div>
      )}
    </li>
  );
};

const OwnerAlerts: React.FC = () => {
  const panel = usePanel();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('owner_alerts');
    if (rpcError) {
      console.error('[OwnerAlerts]', rpcError);
      setError('Não foi possível carregar os alertas.');
    } else {
      setAlerts(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <PageLoader />;

  const groups = (['critical', 'warning', 'info'] as const).map((sev) => ({
    sev,
    items: alerts.filter((a) => a.severity === sev),
  }));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6" data-testid="owner-alerts">
      <PageHeader
        eyebrow={`${panel.title} · ${panel.kind === 'agency' ? 'Visão' : 'Sistema'}`}
        title="Alertas"
        description="Calculados na hora. Quando a causa é resolvida, o alerta some sozinho."
      />
      {error && <ErrorNote message={error} onRetry={load} />}

      {alerts.length === 0 && !error ? (
        <Panel>
          <p className="text-sm text-muted-foreground">Nenhum alerta agora. Mensalidades em dia, WhatsApp conectado e a assistente respondendo.</p>
        </Panel>
      ) : (
        groups.filter((g) => g.items.length > 0).map((g) => (
          <Panel key={g.sev} title={`${severityOf(g.sev).label} · ${g.items.length}`}>
            <ul className="flex flex-col">
              {g.items.map((alert, i) => (
                <AlertRow key={`${alert.kind}-${alert.organization_id}-${i}`} alert={alert} />
              ))}
            </ul>
          </Panel>
        ))
      )}
      <button
        type="button"
        onClick={load}
        className="w-fit rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      >
        Atualizar alertas
      </button>
    </div>
  );
};

export default OwnerAlerts;
