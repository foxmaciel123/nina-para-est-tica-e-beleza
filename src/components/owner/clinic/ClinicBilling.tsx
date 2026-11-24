import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ChargesTable, Charge, NewChargeDialog } from '../billing';
import { BillingChip, ErrorNote, PageHeader, Panel, PageLoader, Stat, formatBRL, formatDay } from '../ownerUi';
import { useClinic } from './OwnerClinicLayout';

const ClinicBilling: React.FC = () => {
  const { detail, reload } = useClinic();
  const org = detail.organization;
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('owner_list_charges', { p_org: org.id });
    if (rpcError) {
      console.error('[ClinicBilling]', rpcError);
      setError('Não foi possível carregar as cobranças desta empresa.');
    } else {
      setCharges(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [org.id]);

  const refresh = () => {
    load();
    reload();
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6" data-testid="clinic-billing">
      <PageHeader
        eyebrow="Empresa · Cobrança"
        title="Cobrança"
        description="Mensalidades desta empresa. A cobrança é feita por fora; registre aqui o pagamento."
        actions={
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Nova cobrança
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Mensalidade" value={Number(org.monthly_fee) > 0 ? formatBRL(org.monthly_fee) : 'Não definida'} hint="Altere em Resumo → Editar dados" />
        <Stat label="Próximo vencimento" value={formatDay(detail.billing.next_due_date)} />
        <Stat
          label="Em atraso"
          value={formatBRL(detail.billing.overdue_amount)}
          tone={Number(detail.billing.overdue_amount) > 0 ? 'bad' : 'default'}
        />
      </div>

      {error && <ErrorNote message={error} onRetry={load} />}

      <Panel title="Histórico" actions={<BillingChip state={detail.billing.state} />}>
        {loading ? <PageLoader /> : <ChargesTable charges={charges} onChanged={refresh} />}
      </Panel>

      <NewChargeDialog
        open={creating}
        onClose={() => setCreating(false)}
        onDone={refresh}
        clinics={[{ id: org.id, name: org.name, monthly_fee: Number(org.monthly_fee) }]}
        fixedClinicId={org.id}
      />
    </div>
  );
};

export default ClinicBilling;
