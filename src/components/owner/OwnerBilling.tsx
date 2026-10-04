import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ChargesTable, Charge, ClinicOption, NewChargeDialog } from './billing';
import { ErrorNote, PageHeader, PageLoader, Panel, Stat, formatBRL } from './ownerUi';

type Filter = 'open' | 'overdue' | 'paid' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Em aberto' },
  { id: 'overdue', label: 'Atrasadas' },
  { id: 'paid', label: 'Pagas' },
  { id: 'all', label: 'Todas' },
];

const OwnerBilling: React.FC = () => {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [clinics, setClinics] = useState<ClinicOption[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const [c, o] = await Promise.all([supabase.rpc('owner_list_charges', {}), supabase.rpc('owner_organizations_overview')]);
    if (c.error || o.error) {
      console.error('[OwnerBilling]', c.error ?? o.error);
      setError('Não foi possível carregar as cobranças.');
    } else {
      setCharges(c.data ?? []);
      setClinics((o.data ?? []).map((x) => ({ id: x.id, name: x.name, monthly_fee: Number(x.monthly_fee) })));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const sum = (list: Charge[]) => list.reduce((s, c) => s + Number(c.amount), 0);
    return {
      overdue: sum(charges.filter((c) => c.display_status === 'overdue')),
      open: sum(charges.filter((c) => c.status === 'pending')),
      dueSoon: charges.filter((c) => c.display_status === 'due_soon').length,
    };
  }, [charges]);

  const visible = useMemo(() => {
    switch (filter) {
      case 'open': return charges.filter((c) => c.status === 'pending');
      case 'overdue': return charges.filter((c) => c.display_status === 'overdue');
      case 'paid': return charges.filter((c) => c.status === 'paid');
      default: return charges;
    }
  }, [charges, filter]);

  if (loading) return <PageLoader />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6" data-testid="owner-billing">
      <PageHeader
        eyebrow="Painel do Dono · Financeiro"
        title="Vencimentos"
        description="Mensalidades cobradas por fora (Pix ou boleto). Registre aqui quando a clínica pagar."
        actions={
          <Button onClick={() => setCreating(true)} disabled={clinics.length === 0} className="gap-2">
            <Plus className="h-4 w-4" /> Nova cobrança
          </Button>
        }
      />

      {error && <ErrorNote message={error} onRetry={load} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Em atraso" value={formatBRL(totals.overdue)} tone={totals.overdue > 0 ? 'bad' : 'default'} />
        <Stat label="Total em aberto" value={formatBRL(totals.open)} />
        <Stat label="Vencendo em até 5 dias" value={String(totals.dueSoon)} tone={totals.dueSoon > 0 ? 'warn' : 'default'} />
      </div>

      <Panel
        actions={
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1" role="tablist" aria-label="Filtrar cobranças">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${filter === f.id ? 'bg-accent/15 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
        title="Cobranças"
      >
        <ChargesTable charges={visible} showClinic onChanged={load} />
      </Panel>

      <NewChargeDialog open={creating} onClose={() => setCreating(false)} onDone={load} clinics={clinics} />
    </div>
  );
};

export default OwnerBilling;
