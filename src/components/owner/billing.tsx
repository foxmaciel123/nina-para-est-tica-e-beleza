import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ChargeChip, formatBRL, formatDay, todayISO } from './ownerUi';

export type Charge = Database['public']['Functions']['owner_list_charges']['Returns'][number];

const PAYMENT_METHODS = ['Pix', 'Boleto', 'Transferência', 'Cartão', 'Dinheiro'];

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// Mensagem do banco (RAISE com ERRCODE 22023/P0002) já vem em português
const rpcMessage = (error: { message?: string; code?: string } | null, fallback: string) =>
  error && (error.code === '22023' || error.code === 'P0002') && error.message ? error.message : fallback;

// ---------------------------------------------------------------------------

export const ChargesTable: React.FC<{
  charges: Charge[];
  showClinic?: boolean;
  onChanged: () => void;
}> = ({ charges, showClinic = false, onChanged }) => {
  const [paying, setPaying] = useState<Charge | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const cancel = async (charge: Charge) => {
    setBusyId(charge.id);
    const { error } = await supabase.rpc('owner_cancel_charge', { p_charge: charge.id });
    setBusyId(null);
    if (error) {
      toast.error(rpcMessage(error, 'Não foi possível cancelar a cobrança.'));
      return;
    }
    toast.success('Cobrança cancelada');
    onChanged();
  };

  if (charges.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma cobrança registrada ainda.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              {showClinic && <th className="px-3 py-2 font-semibold">Clínica</th>}
              <th className="px-3 py-2 font-semibold">Vencimento</th>
              <th className="px-3 py-2 text-right font-semibold">Valor</th>
              <th className="px-3 py-2 font-semibold">Situação</th>
              <th className="px-3 py-2 font-semibold">Pagamento</th>
              <th className="px-3 py-2 font-semibold">Observação</th>
              <th className="px-3 py-2"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c) => (
              <tr key={c.id} className="border-b border-border/60 last:border-0">
                {showClinic && <td className="px-3 py-2.5 font-medium">{c.organization_name}</td>}
                <td className="px-3 py-2.5 tabular-nums">{formatDay(c.due_date)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatBRL(c.amount)}</td>
                <td className="px-3 py-2.5"><ChargeChip status={c.display_status} /></td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {c.status === 'paid' ? `${formatDay(c.paid_at)}${c.payment_method ? ` · ${c.payment_method}` : ''}` : '—'}
                </td>
                <td className="max-w-[200px] truncate px-3 py-2.5 text-muted-foreground" title={c.notes ?? ''}>{c.notes ?? '—'}</td>
                <td className="px-3 py-2.5">
                  {c.status === 'pending' && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setPaying(c)}>Marcar paga</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === c.id}
                        onClick={() => cancel(c)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        Cancelar
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MarkPaidDialog charge={paying} onClose={() => setPaying(null)} onDone={onChanged} />
    </>
  );
};

// ---------------------------------------------------------------------------

export const MarkPaidDialog: React.FC<{ charge: Charge | null; onClose: () => void; onDone: () => void }> = ({ charge, onClose, onDone }) => {
  const [paidAt, setPaidAt] = useState(todayISO());
  const [method, setMethod] = useState('Pix');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (charge) {
      setPaidAt(todayISO());
      setMethod('Pix');
    }
  }, [charge]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!charge) return;
    setSaving(true);
    const { error } = await supabase.rpc('owner_mark_charge_paid', { p_charge: charge.id, p_paid_at: paidAt, p_method: method });
    setSaving(false);
    if (error) {
      toast.error(rpcMessage(error, 'Não foi possível registrar o pagamento.'));
      return;
    }
    toast.success('Pagamento registrado');
    onClose();
    onDone();
  };

  return (
    <Dialog open={!!charge} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>
              {charge && `${charge.organization_name} · ${formatBRL(charge.amount)} com vencimento em ${formatDay(charge.due_date)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="paid-at">Data do pagamento</Label>
              <Input id="paid-at" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="paid-method">Forma</Label>
              <select id="paid-method" value={method} onChange={(e) => setMethod(e.target.value)} className={selectClass}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Voltar</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar pagamento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------

export interface ClinicOption {
  id: string;
  name: string;
  monthly_fee: number;
}

export const NewChargeDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  clinics: ClinicOption[];
  fixedClinicId?: string;
}> = ({ open, onClose, onDone, clinics, fixedClinicId }) => {
  const [clinicId, setClinicId] = useState('');
  const [dueDate, setDueDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial = fixedClinicId ?? clinics[0]?.id ?? '';
    setClinicId(initial);
    const fee = clinics.find((c) => c.id === initial)?.monthly_fee;
    setAmount(fee && Number(fee) > 0 ? String(fee) : '');
    setDueDate(todayISO());
    setNotes('');
    setError(null);
  }, [open, fixedClinicId, clinics]);

  const changeClinic = (id: string) => {
    setClinicId(id);
    const fee = clinics.find((c) => c.id === id)?.monthly_fee;
    if (fee && Number(fee) > 0) setAmount(String(fee));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount.replace(',', '.'));
    if (!clinicId) return setError('Escolha a clínica.');
    if (!dueDate) return setError('Informe o vencimento.');
    if (!Number.isFinite(value) || value <= 0) return setError('Informe um valor maior que zero.');
    setError(null);
    setSaving(true);
    const { error: rpcError } = await supabase.rpc('owner_create_charge', {
      p_org: clinicId, p_due_date: dueDate, p_amount: value, p_notes: notes || null,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcMessage(rpcError, 'Não foi possível criar a cobrança.'));
      return;
    }
    toast.success('Cobrança criada');
    onClose();
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Nova cobrança</DialogTitle>
            <DialogDescription>Registre a mensalidade que você vai cobrar por Pix ou boleto.</DialogDescription>
          </DialogHeader>
          {!fixedClinicId && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="charge-clinic">Clínica</Label>
              <select id="charge-clinic" value={clinicId} onChange={(e) => changeClinic(e.target.value)} className={selectClass}>
                {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="charge-due">Vencimento</Label>
              <Input id="charge-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="charge-amount">Valor (R$)</Label>
              <Input id="charge-amount" inputMode="decimal" placeholder="397,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="charge-notes">Observação</Label>
            <Textarea id="charge-notes" rows={2} placeholder="Mensalidade de novembro" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Voltar</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar cobrança
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
