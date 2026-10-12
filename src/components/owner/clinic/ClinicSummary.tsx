import React, { useEffect, useState } from 'react';
import { CirclePause, CirclePlay, Loader2, Pencil } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BillingChip, Chip, PageHeader, Panel, formatBRL, formatDate, formatNumber, formatRelative, formatUSD } from '../ownerUi';
import { ClinicDetail, useClinic } from './OwnerClinicLayout';
import { ClinicHistory, ResendAccessButton } from './ClinicHistory';

const EditClinicDialog: React.FC<{ open: boolean; onClose: () => void; detail: ClinicDetail; onSaved: () => void }> = ({ open, onClose, detail, onSaved }) => {
  const org = detail.organization;
  const [name, setName] = useState(org.name);
  const [fee, setFee] = useState(String(org.monthly_fee ?? ''));
  const [contactName, setContactName] = useState(org.contact_name ?? '');
  const [contactPhone, setContactPhone] = useState(org.contact_phone ?? '');
  const [notes, setNotes] = useState(org.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(org.name);
    setFee(String(org.monthly_fee ?? ''));
    setContactName(org.contact_name ?? '');
    setContactPhone(org.contact_phone ?? '');
    setNotes(org.notes ?? '');
    setError(null);
  }, [open, org]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(fee.replace(',', '.') || '0');
    if (!name.trim()) return setError('Informe o nome da clínica.');
    if (!Number.isFinite(value) || value < 0) return setError('Informe uma mensalidade válida (use 0 se não cobrar).');
    setSaving(true);
    const { error: rpcError } = await supabase.rpc('owner_update_organization', {
      p_org: org.id, p_name: name, p_monthly_fee: value,
      p_contact_name: contactName, p_contact_phone: contactPhone, p_notes: notes,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.code === '22023' ? rpcError.message : 'Não foi possível salvar. Tente de novo.');
      return;
    }
    toast.success('Dados da clínica salvos');
    onClose();
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Editar dados da clínica</DialogTitle>
            <DialogDescription>Esses dados aparecem só para você no Painel do Dono.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="clinic-name">Nome da clínica</Label>
            <Input id="clinic-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="clinic-fee">Mensalidade (R$)</Label>
              <Input id="clinic-fee" inputMode="decimal" placeholder="397,00" value={fee} onChange={(e) => setFee(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="clinic-contact-phone">WhatsApp da dona</Label>
              <Input id="clinic-contact-phone" inputMode="tel" placeholder="11 99999-0000" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="clinic-contact-name">Nome da responsável</Label>
            <Input id="clinic-contact-name" placeholder="Ana Souza" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="clinic-notes">Anotações</Label>
            <Textarea id="clinic-notes" rows={3} placeholder="Fechou plano anual, cobrar todo dia 10" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Voltar</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar dados
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const ClinicSummary: React.FC = () => {
  const { detail, reload } = useClinic();
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const { organization: org, billing, members, usage_30d: usage, daily_ai_messages: daily } = detail;
  const isSuspended = org.status === 'suspended';

  const toggleStatus = async () => {
    setSaving(true);
    const nextStatus = isSuspended ? 'active' : 'suspended';
    const { error } = await supabase.rpc('owner_set_organization_status', { p_org: org.id, p_status: nextStatus });
    setSaving(false);
    setConfirmOpen(false);
    if (error) {
      console.error('[ClinicSummary] status', error);
      toast.error('Não foi possível alterar o acesso da clínica. Tente de novo.');
      return;
    }
    toast.success(nextStatus === 'suspended' ? 'Clínica suspensa' : 'Clínica reativada');
    reload();
  };

  const chartData = daily.map((d) => ({
    label: new Date(`${d.day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    count: d.count,
  }));

  const usageItems = [
    { label: 'Clientes no total', value: formatNumber(usage.contacts_total) },
    { label: 'Novas clientes', value: formatNumber(usage.new_contacts) },
    { label: 'Conversas', value: formatNumber(usage.conversations) },
    { label: 'Respostas da IA', value: formatNumber(usage.ai_messages) },
    { label: 'Agendamentos', value: formatNumber(usage.appointments) },
    { label: 'Custo da IA', value: formatUSD(usage.ai_cost_usd) },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6" data-testid="clinic-summary">
      <PageHeader
        eyebrow="Clínica · Resumo"
        title={org.name}
        description={`Cliente desde ${formatDate(org.created_at)}`}
        actions={
          <>
            <ResendAccessButton orgId={org.id} onDone={() => setHistoryKey((k) => k + 1)} />
            <Button variant="outline" onClick={() => setEditing(true)} className="gap-2">
              <Pencil className="h-4 w-4" /> Editar dados
            </Button>
            <Button variant={isSuspended ? 'default' : 'destructive'} onClick={() => setConfirmOpen(true)} className="gap-2">
              {isSuspended ? <CirclePlay className="h-4 w-4" /> : <CirclePause className="h-4 w-4" />}
              {isSuspended ? 'Reativar clínica' : 'Suspender clínica'}
            </Button>
          </>
        }
      />

      {isSuspended && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
          <CirclePause className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <p>A equipe desta clínica está sem acesso ao painel e a assistente não responde nem envia mensagens. As mensagens que chegam continuam guardadas.</p>
        </div>
      )}

      <Panel title="Uso nos últimos 30 dias">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {usageItems.map((item) => (
            <div key={item.label} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{item.label}</span>
              <span className="text-2xl font-bold tabular-nums">{item.value}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Respostas da IA por dia">
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval={4} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
                formatter={(value: number) => [formatNumber(value), 'Respostas']}
              />
              <Bar dataKey="count" fill="hsl(var(--accent))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Contato e mensalidade">
          <dl className="flex flex-col text-sm">
            {[
              ['Responsável', org.contact_name ?? '—'],
              ['WhatsApp da dona', org.contact_phone ?? '—'],
              ['Mensalidade', Number(org.monthly_fee) > 0 ? formatBRL(org.monthly_fee) : 'Não definida'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 border-b border-border/60 py-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 py-2">
              <dt className="text-muted-foreground">Pagamento</dt>
              <dd><BillingChip state={billing.state} /></dd>
            </div>
          </dl>
          {org.notes && <p className="whitespace-pre-line rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{org.notes}</p>}
        </Panel>

        <Panel title={`Equipe · ${members.length}`}>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum usuário vinculado a esta clínica.</p>
          ) : (
            <ul className="flex flex-col">
              {members.map((m) => (
                <li key={m.email} className="flex items-center justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{m.full_name || m.email}</div>
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <Chip tone={m.role === 'admin' ? 'ok' : 'neutral'}>{m.role === 'admin' ? 'Admin' : 'Equipe'}</Chip>
                    <span className="text-xs text-muted-foreground">
                      {m.last_sign_in_at ? `último acesso ${formatRelative(m.last_sign_in_at)}` : 'nunca acessou'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <ClinicHistory orgId={org.id} refreshKey={`${historyKey}-${org.status}-${org.name}-${org.monthly_fee}`} />

      <EditClinicDialog open={editing} onClose={() => setEditing(false)} detail={detail} onSaved={reload} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isSuspended ? `Reativar ${org.name}?` : `Suspender ${org.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {isSuspended
                ? 'A equipe volta a acessar o painel e a assistente volta a responder no WhatsApp da clínica.'
                : 'A equipe perde o acesso ao painel e a assistente para de responder e de enviar lembretes. As mensagens que chegarem continuam guardadas e aparecem quando você reativar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); toggleStatus(); }}
              disabled={saving}
              className={isSuspended ? '' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSuspended ? 'Reativar' : 'Suspender'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ClinicSummary;
