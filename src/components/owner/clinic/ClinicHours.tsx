import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorNote, PageHeader, PageLoader, Panel } from '../ownerUi';
import { rpcErrorMessage, useClinicConfig } from '../ownerApi';
import { useClinic } from './OwnerClinicLayout';

const DAYS = [
  { id: 1, label: 'Segunda' }, { id: 2, label: 'Terça' }, { id: 3, label: 'Quarta' },
  { id: 4, label: 'Quinta' }, { id: 5, label: 'Sexta' }, { id: 6, label: 'Sábado' }, { id: 0, label: 'Domingo' },
];

const ClinicHours: React.FC = () => {
  const { detail, reload: reloadDetail } = useClinic();
  const orgId = detail.organization.id;
  const { config, loading, error, reload } = useClinicConfig(orgId);

  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!config) return;
    setStart((config.business_hours_start ?? '09:00').slice(0, 5));
    setEnd((config.business_hours_end ?? '18:00').slice(0, 5));
    setDays(config.business_days ?? [1, 2, 3, 4, 5]);
  }, [config]);

  const toggleDay = (id: number) =>
    setDays((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!start || !end || end <= start) return setFormError('O horário de fim precisa ser depois do início.');
    if (days.length === 0) return setFormError('Escolha pelo menos um dia de atendimento.');
    setFormError(null);
    setSaving(true);
    const { error: rpcError } = await supabase.rpc('owner_update_clinic_hours', { p_org: orgId, p_start: start, p_end: end, p_days: days });
    setSaving(false);
    if (rpcError) {
      setFormError(rpcErrorMessage(rpcError, 'Não foi possível salvar. Tente de novo.'));
      return;
    }
    toast.success('Horário de atendimento salvo');
    reload();
    reloadDetail();
  };

  if (loading) return <PageLoader />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6" data-testid="clinic-hours">
      <PageHeader eyebrow="Clínica · Horários" title="Horários" description="Quando a clínica atende. A Nina usa isso para oferecer horários de avaliação." />
      {error && <ErrorNote message={error} onRetry={reload} />}

      {!config ? (
        <Panel>
          <p className="text-sm text-muted-foreground">Esta clínica ainda não tem a configuração da Nina.</p>
        </Panel>
      ) : (
        <form onSubmit={save} noValidate>
          <Panel title="Atendimento">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="hours-start">Abre às</Label>
                <Input id="hours-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="hours-end">Fecha às</Label>
                <Input id="hours-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Dias de atendimento</legend>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={days.includes(d.id)}
                    onClick={() => toggleDay(d.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${days.includes(d.id) ? 'border-accent bg-accent/15 font-semibold' : 'border-border text-muted-foreground hover:bg-muted/50'}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </fieldset>
            {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar horários
              </Button>
            </div>
          </Panel>
        </form>
      )}
    </div>
  );
};

export default ClinicHours;
