import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { ownerAction } from './ownerApi';
import { usePanel } from './panelScope';

// Link de primeiro acesso para o dono copiar e mandar no WhatsApp da dona
export const AccessLinkBox: React.FC<{ link: string; email: string; who?: string; resendHint?: string }> = ({
  link, email, who = 'a dona', resendHint = 'no resumo da clínica',
}) => {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/50 p-2">
        <code className="min-w-0 flex-1 select-all truncate text-xs" data-testid="access-link">{link}</code>
        <Button type="button" size="sm" variant="outline" onClick={copy} className="flex-shrink-0 gap-1.5">
          <Copy className="h-3.5 w-3.5" /> Copiar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Mande para {who} no WhatsApp. O link abre a tela de criar senha; depois é só entrar com o e-mail <strong className="text-foreground">{email}</strong>.
        O link vale por 24 horas e só pode ser usado uma vez. Se expirar, use “Reenviar acesso” {resendHint}.
      </p>
    </div>
  );
};

interface Created {
  organization_id: string;
  access_link: string;
  email: string;
}

const NewClinicDialog: React.FC<{ open: boolean; onClose: () => void; onCreated: () => void }> = ({ open, onClose, onCreated }) => {
  const navigate = useNavigate();
  const panel = usePanel();
  const [agencies, setAgencies] = useState<{ id: string; name: string }[]>([]);
  const [agencyId, setAgencyId] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [fee, setFee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  useEffect(() => {
    if (!open) return;
    setClinicName(''); setOwnerName(''); setEmail(''); setPhone(''); setFee(''); setDueDate('');
    setError(null); setCreated(null); setAgencyId('');
    // O dono pode criar a clínica já dentro de uma agência
    if (panel.kind === 'owner') {
      supabase.rpc('owner_agencies_overview' as any).then(({ data }) =>
        setAgencies(((data as any[]) ?? []).filter((a) => a.status === 'active')));
    }
  }, [open, panel.kind]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const feeValue = Number(fee.replace(',', '.') || '0');
    if (!clinicName.trim()) return setError('Informe o nome da clínica.');
    if (!ownerName.trim()) return setError('Informe o nome da dona da clínica.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Informe um e-mail válido.');
    if (!Number.isFinite(feeValue) || feeValue < 0) return setError('Informe uma mensalidade válida (use 0 se ainda não definiu).');
    if (dueDate && feeValue <= 0) return setError('Para lançar o primeiro vencimento, informe a mensalidade.');
    setError(null);
    setSaving(true);
    try {
      const result = await ownerAction<Created>('create_clinic', {
        clinic_name: clinicName.trim(),
        owner_name: ownerName.trim(),
        email: email.trim(),
        contact_phone: phone.trim(),
        monthly_fee: feeValue,
        first_due_date: dueDate || null,
        agency_id: agencyId || null,
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
          <div className="flex min-w-0 flex-col gap-4" data-testid="clinic-created">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" /> Clínica criada
              </DialogTitle>
              <DialogDescription>
                {clinicName} já tem funil, etiquetas e a assistente de estética prontos. Falta só a dona criar a senha.
              </DialogDescription>
            </DialogHeader>
            <AccessLinkBox link={created.access_link} email={created.email} />
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Fechar</Button>
              <Button onClick={() => navigate(`${panel.base}/clinicas/${created.organization_id}`)}>Abrir clínica</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Nova clínica</DialogTitle>
              <DialogDescription>Crie a clínica e a conta da dona. Você recebe um link de acesso para mandar para ela.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="new-clinic-name">Nome da clínica</Label>
                <Input id="new-clinic-name" placeholder="Studio Bella Pele" value={clinicName} onChange={(e) => setClinicName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-clinic-owner">Nome da dona</Label>
                <Input id="new-clinic-owner" placeholder="Ana Souza" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-clinic-phone">WhatsApp da dona</Label>
                <Input id="new-clinic-phone" inputMode="tel" placeholder="11 98888-0000" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="new-clinic-email">E-mail de acesso da dona</Label>
                <Input id="new-clinic-email" type="email" placeholder="ana@bellapele.com.br" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {panel.kind === 'owner' && agencies.length > 0 && (
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <Label htmlFor="new-clinic-agency">Agência</Label>
                  <select
                    id="new-clinic-agency"
                    value={agencyId}
                    onChange={(e) => setAgencyId(e.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Nenhuma (cliente direto seu)</option>
                    {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-clinic-fee">Mensalidade (R$)</Label>
                <Input id="new-clinic-fee" inputMode="decimal" placeholder="397,00" value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-clinic-due">Primeiro vencimento</Label>
                <Input id="new-clinic-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Voltar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar clínica
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default NewClinicDialog;
