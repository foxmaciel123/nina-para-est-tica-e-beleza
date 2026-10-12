import React, { useEffect, useState } from 'react';
import { CheckCircle2, CirclePause, CirclePlay, KeyRound, Loader2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AccessLinkBox } from './NewClinicDialog';
import { ownerAction, rpcErrorMessage } from './ownerApi';
import { Chip, ErrorNote, PageHeader, PageLoader, Stat, formatBRL, formatDate, formatNumber } from './ownerUi';

export interface AgencyRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
  admin_email: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  fee_per_clinic: number | null;
  clinics_active: number;
  clinics_total: number;
  monthly_total: number | null;
  notes?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "99,90" → 99.9; vazio → null (valor ainda não combinado)
const parseFee = (raw: string): number | null | 'invalid' => {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
};

const NewAgencyDialog: React.FC<{ open: boolean; onClose: () => void; onCreated: () => void }> = ({ open, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [fee, setFee] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ access_link: string; email: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(''); setOwnerName(''); setEmail(''); setPhone(''); setFee('');
    setError(null); setCreated(null);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const feeValue = parseFee(fee);
    if (!name.trim()) return setError('Informe o nome da agência.');
    if (!ownerName.trim()) return setError('Informe o nome do responsável.');
    if (!EMAIL_RE.test(email.trim())) return setError('Informe um e-mail válido.');
    if (feeValue === 'invalid') return setError('Informe um valor por clínica válido, ou deixe em branco.');
    setError(null);
    setSaving(true);
    try {
      const result = await ownerAction<{ access_link: string; email: string }>('create_agency', {
        agency_name: name.trim(),
        owner_name: ownerName.trim(),
        email: email.trim(),
        contact_phone: phone.trim(),
        fee_per_clinic: feeValue,
      });
      setCreated(result);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-lg [&>*]:min-w-0">
        {created ? (
          <div className="flex min-w-0 flex-col gap-4" data-testid="agency-created">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" /> Agência criada
              </DialogTitle>
              <DialogDescription>{name} já pode entrar no painel da agência e cadastrar as clínicas dela.</DialogDescription>
            </DialogHeader>
            <AccessLinkBox link={created.access_link} email={created.email} who="o responsável pela agência" resendHint="na lista de agências" />
            <DialogFooter>
              <Button onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Nova agência</DialogTitle>
              <DialogDescription>Crie a agência e a conta do responsável. Você recebe um link de acesso para mandar para ele.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="new-agency-name">Nome da agência</Label>
                <Input id="new-agency-name" placeholder="Bella Marketing" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-agency-owner">Responsável</Label>
                <Input id="new-agency-owner" placeholder="Carlos Lima" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-agency-phone">WhatsApp</Label>
                <Input id="new-agency-phone" inputMode="tel" placeholder="11 98888-0000" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="new-agency-email">E-mail de acesso</Label>
                <Input id="new-agency-email" type="email" placeholder="contato@bellamarketing.com.br" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="new-agency-fee">Valor por clínica ativa (R$)</Label>
                <Input id="new-agency-fee" inputMode="decimal" placeholder="Deixe em branco se ainda não combinou" value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Voltar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar agência
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

const EditAgencyDialog: React.FC<{ agency: AgencyRow | null; onClose: () => void; onSaved: () => void }> = ({ agency, onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState<{ access_link: string; email: string } | null>(null);
  const [sendingLink, setSendingLink] = useState(false);

  useEffect(() => {
    if (!agency) return;
    setName(agency.name);
    setFee(agency.fee_per_clinic == null ? '' : String(agency.fee_per_clinic).replace('.', ','));
    setContactName(agency.contact_name ?? '');
    setContactPhone(agency.contact_phone ?? '');
    setNotes(agency.notes ?? '');
    setError(null);
    setLink(null);
  }, [agency]);

  if (!agency) return null;
  const suspended = agency.status === 'suspended';

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const feeValue = parseFee(fee);
    if (!name.trim()) return setError('Informe o nome da agência.');
    if (feeValue === 'invalid') return setError('Informe um valor por clínica válido, ou deixe em branco.');
    setSaving(true);
    const { error: rpcError } = await supabase.rpc('owner_update_agency' as any, {
      p_agency: agency.id, p_name: name, p_fee_per_clinic: feeValue,
      p_contact_name: contactName, p_contact_phone: contactPhone, p_notes: notes,
    });
    setSaving(false);
    if (rpcError) return setError(rpcErrorMessage(rpcError, 'Não foi possível salvar. Tente de novo.'));
    toast.success('Agência salva');
    onClose();
    onSaved();
  };

  const toggleStatus = async () => {
    setSaving(true);
    const { error: rpcError } = await supabase.rpc('owner_set_agency_status' as any, {
      p_agency: agency.id, p_status: suspended ? 'active' : 'suspended',
    });
    setSaving(false);
    if (rpcError) return setError('Não foi possível alterar o acesso. Tente de novo.');
    toast.success(suspended ? 'Agência reativada' : 'Agência suspensa');
    onClose();
    onSaved();
  };

  const resend = async () => {
    setSendingLink(true);
    try {
      setLink(await ownerAction<{ access_link: string; email: string }>('resend_agency_access', { agency_id: agency.id }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSendingLink(false);
    }
  };

  return (
    <Dialog open={!!agency} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-lg [&>*]:min-w-0">
        <form onSubmit={save} className="flex min-w-0 flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{agency.name}</DialogTitle>
            <DialogDescription>
              {formatNumber(agency.clinics_active)} clínica(s) ativa(s) · {agency.admin_email ?? 'sem conta de acesso'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="edit-agency-name">Nome da agência</Label>
              <Input id="edit-agency-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="edit-agency-fee">Valor por clínica ativa (R$)</Label>
              <Input id="edit-agency-fee" inputMode="decimal" placeholder="Em branco = ainda não combinado" value={fee} onChange={(e) => setFee(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-agency-contact">Responsável</Label>
              <Input id="edit-agency-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-agency-phone">WhatsApp</Label>
              <Input id="edit-agency-phone" inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="edit-agency-notes">Anotações</Label>
              <Textarea id="edit-agency-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          {link && <AccessLinkBox link={link.access_link} email={link.email} who="o responsável pela agência" resendHint="de novo" />}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="gap-2" onClick={resend} disabled={sendingLink || saving}>
                {sendingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Reenviar acesso
              </Button>
              <Button type="button" variant={suspended ? 'outline' : 'destructive'} className="gap-2" onClick={toggleStatus} disabled={saving}>
                {suspended ? <CirclePlay className="h-4 w-4" /> : <CirclePause className="h-4 w-4" />}
                {suspended ? 'Reativar' : 'Suspender'}
              </Button>
            </div>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const OwnerAgencies: React.FC = () => {
  const [agencies, setAgencies] = useState<AgencyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AgencyRow | null>(null);

  // Recarregar não troca a tela pelo "carregando" (a janela com o link continua aberta)
  const load = async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('owner_agencies_overview' as any);
    if (rpcError) {
      console.error('[OwnerAgencies]', rpcError);
      setError('Não foi possível carregar as agências.');
    } else {
      setAgencies((data as unknown as AgencyRow[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <PageLoader />;

  const active = agencies.filter((a) => a.status === 'active');
  const clinics = active.reduce((s, a) => s + Number(a.clinics_active), 0);
  const toReceive = active.reduce((s, a) => s + Number(a.monthly_total ?? 0), 0);
  const noFee = active.filter((a) => a.fee_per_clinic == null).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6" data-testid="owner-agencies">
      <PageHeader
        eyebrow="Painel do Dono · Visão"
        title="Agências"
        description="Agências que revendem o sistema com a marca delas. Cada uma paga por clínica ativa."
        actions={
          <Button onClick={() => setCreating(true)} className="gap-2" data-testid="new-agency-button">
            <Plus className="h-4 w-4" /> Nova agência
          </Button>
        }
      />

      {error && <ErrorNote message={error} onRetry={load} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Agências ativas" value={formatNumber(active.length)} />
        <Stat label="Clínicas ativas pelas agências" value={formatNumber(clinics)} />
        <Stat
          label="A receber das agências no mês"
          value={formatBRL(toReceive)}
          hint={noFee > 0 ? `${formatNumber(noFee)} agência(s) sem valor combinado` : 'Clínicas ativas × valor de cada agência'}
          tone={noFee > 0 ? 'warn' : 'default'}
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Agência</th>
              <th className="px-4 py-3 font-semibold">Acesso</th>
              <th className="px-4 py-3 text-right font-semibold">Clínicas ativas</th>
              <th className="px-4 py-3 text-right font-semibold">Valor por clínica</th>
              <th className="px-4 py-3 text-right font-semibold">Total do mês</th>
              <th className="px-4 py-3 font-semibold">Desde</th>
              <th className="px-4 py-3"><span className="sr-only">Editar</span></th>
            </tr>
          </thead>
          <tbody>
            {agencies.map((a) => (
              <tr key={a.id} onClick={() => setEditing(a)} className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3">
                  <div className="font-semibold">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.admin_email ?? 'sem conta de acesso'}</div>
                </td>
                <td className="px-4 py-3">{a.status === 'active' ? <Chip tone="ok">Ativa</Chip> : <Chip tone="bad">Suspensa</Chip>}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatNumber(a.clinics_active)}
                  {Number(a.clinics_total) > Number(a.clinics_active) && (
                    <span className="text-xs text-muted-foreground"> de {formatNumber(a.clinics_total)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{a.fee_per_clinic == null ? <Chip tone="warn">A combinar</Chip> : formatBRL(a.fee_per_clinic)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{a.monthly_total == null ? '—' : formatBRL(a.monthly_total)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(a.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setEditing(a); }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/10"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </button>
                </td>
              </tr>
            ))}
            {agencies.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhuma agência ainda. Cadastre a primeira em “Nova agência”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-muted-foreground">
        As clínicas de cada agência aparecem em “Clínicas”, com o nome da agência. Para passar uma clínica sua para uma agência, abra a clínica e troque em “Agência”.
      </p>

      <NewAgencyDialog open={creating} onClose={() => setCreating(false)} onCreated={load} />
      <EditAgencyDialog agency={editing} onClose={() => setEditing(null)} onSaved={load} />
    </div>
  );
};

export default OwnerAgencies;
