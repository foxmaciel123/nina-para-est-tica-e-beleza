import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Panel, formatBRL, formatDay, formatRelative } from '../ownerUi';
import { AccessLinkBox } from '../NewClinicDialog';
import { ownerAction } from '../ownerApi';

const ACTION_LABEL: Record<string, string> = {
  clinic_created: 'Clínica criada',
  clinic_suspended: 'Clínica suspensa',
  clinic_reactivated: 'Clínica reativada',
  clinic_data_updated: 'Dados da clínica alterados',
  access_link_sent: 'Link de acesso gerado',
  whatsapp_updated: 'WhatsApp alterado',
  agent_updated: 'Agente IA alterado',
  hours_updated: 'Horário de atendimento alterado',
  procedure_created: 'Procedimento cadastrado',
  procedure_updated: 'Procedimento alterado',
  procedure_deleted: 'Procedimento removido',
  charge_created: 'Cobrança criada',
  charge_paid: 'Pagamento registrado',
  charge_canceled: 'Cobrança cancelada',
};

const describe = (action: string, d: Record<string, any>) => {
  switch (action) {
    case 'procedure_created':
    case 'procedure_updated':
    case 'procedure_deleted':
      return d.name;
    case 'charge_created':
    case 'charge_paid':
    case 'charge_canceled':
      return `${formatBRL(d.amount)} · vencimento ${formatDay(d.due_date)}${d.method ? ` · ${d.method}` : ''}`;
    case 'access_link_sent':
    case 'clinic_created':
      return d.email;
    case 'whatsapp_updated':
      return d.token_changed ? 'token trocado' : undefined;
    default:
      return undefined;
  }
};

interface AuditRow { action: string; details: any; actor_email: string | null; created_at: string }

export const ClinicHistory: React.FC<{ orgId: string; refreshKey: unknown }> = ({ orgId, refreshKey }) => {
  const [rows, setRows] = useState<AuditRow[] | null>(null);

  useEffect(() => {
    supabase.rpc('owner_list_audit', { p_org: orgId, p_limit: 15 }).then(({ data, error }) => {
      if (error) console.error('[ClinicHistory]', error);
      setRows((data as AuditRow[]) ?? []);
    });
  }, [orgId, refreshKey]);

  return (
    <Panel title="Histórico de alterações pelo dono">
      {rows === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma alteração registrada ainda.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r, i) => {
            const extra = describe(r.action, r.details ?? {});
            return (
              <li key={i} className="flex items-start justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
                <div className="min-w-0">
                  <div className="font-medium">{ACTION_LABEL[r.action] ?? r.action}</div>
                  {extra && <div className="truncate text-xs text-muted-foreground">{extra}</div>}
                </div>
                <span className="flex-shrink-0 text-xs text-muted-foreground">{formatRelative(r.created_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
};

export const ResendAccessButton: React.FC<{ orgId: string; onDone: () => void }> = ({ orgId, onDone }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ access_link: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setOpen(true);
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      setResult(await ownerAction('resend_access', { organization_id: orgId }));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={generate} className="gap-2" data-testid="resend-access">
        <KeyRound className="h-4 w-4" /> Reenviar acesso
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Novo link de acesso</DialogTitle>
            <DialogDescription>Serve para o primeiro acesso ou para a dona trocar a senha esquecida.</DialogDescription>
          </DialogHeader>
          {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {result && <AccessLinkBox link={result.access_link} email={result.email} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
