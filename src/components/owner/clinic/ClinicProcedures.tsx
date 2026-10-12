import React, { useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Chip, ErrorNote, PageHeader, PageLoader, Panel, formatBRL } from '../ownerUi';
import { rpcErrorMessage } from '../ownerApi';
import { useClinic } from './OwnerClinicLayout';

type Procedure = Database['public']['Tables']['procedures']['Row'];

// Mesmas categorias do cadastro de procedimentos da clínica (ProceduresManager)
const CATEGORIES: Record<string, string> = {
  facial: 'Facial',
  corporal: 'Corporal',
  harmonizacao: 'Harmonização',
  capilar: 'Capilar',
  bem_estar: 'Bem-estar',
  pos_operatorio: 'Pós-operatório',
  outro: 'Outro',
};

interface FormState {
  id?: string;
  name: string; category: string; duration_minutes: string; price_min: string; price_max: string;
  price_visible: boolean; description: string; contraindications: string; pre_care: string; post_care: string; is_active: boolean;
}

const emptyForm = (): FormState => ({
  name: '', category: 'facial', duration_minutes: '60', price_min: '', price_max: '', price_visible: false,
  description: '', contraindications: '', pre_care: '', post_care: '', is_active: true,
});

const toForm = (p: Procedure): FormState => ({
  id: p.id, name: p.name, category: p.category, duration_minutes: String(p.duration_minutes ?? 60),
  price_min: p.price_min != null ? String(p.price_min) : '', price_max: p.price_max != null ? String(p.price_max) : '',
  price_visible: p.price_visible, description: p.description ?? '', contraindications: p.contraindications ?? '',
  pre_care: p.pre_care ?? '', post_care: p.post_care ?? '', is_active: p.is_active,
});

const priceText = (p: Procedure) => {
  if (p.price_min == null && p.price_max == null) return '—';
  if (p.price_min != null && p.price_max != null && p.price_min !== p.price_max) return `${formatBRL(p.price_min)} a ${formatBRL(p.price_max)}`;
  return formatBRL(p.price_min ?? p.price_max);
};

const selectClass = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const ClinicProcedures: React.FC = () => {
  const { detail } = useClinic();
  const orgId = detail.organization.id;
  const [items, setItems] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<Procedure | null>(null);

  const load = async () => {
    const { data, error: rpcError } = await supabase.rpc('owner_list_procedures', { p_org: orgId });
    if (rpcError) {
      console.error('[ClinicProcedures]', rpcError);
      setError('Não foi possível carregar os procedimentos.');
    } else {
      setError(null);
      setItems(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [orgId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const num = (v: string) => (v.trim() === '' ? '' : String(Number(v.replace(',', '.'))));
    if (!form.name.trim()) return setFormError('Informe o nome do procedimento.');
    for (const v of [form.price_min, form.price_max, form.duration_minutes]) {
      if (v.trim() !== '' && !Number.isFinite(Number(v.replace(',', '.')))) return setFormError('Use só números nos preços e na duração.');
    }
    setFormError(null);
    setSaving(true);
    const { error: rpcError } = await supabase.rpc('owner_save_procedure', {
      p_org: orgId,
      p_procedure: {
        ...form,
        id: form.id ?? '',
        duration_minutes: num(form.duration_minutes) || '60',
        price_min: num(form.price_min),
        price_max: num(form.price_max),
      },
    });
    setSaving(false);
    if (rpcError) {
      setFormError(rpcErrorMessage(rpcError, 'Não foi possível salvar. Tente de novo.'));
      return;
    }
    toast.success(form.id ? 'Procedimento salvo' : 'Procedimento cadastrado');
    setForm(null);
    load();
  };

  const remove = async () => {
    if (!removing) return;
    const { error: rpcError } = await supabase.rpc('owner_delete_procedure', { p_org: orgId, p_id: removing.id });
    setRemoving(null);
    if (rpcError) {
      toast.error(rpcErrorMessage(rpcError, 'Não foi possível remover.'));
      return;
    }
    toast.success('Procedimento removido');
    load();
  };

  if (loading) return <PageLoader />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6" data-testid="clinic-procedures">
      <PageHeader
        eyebrow="Clínica · Procedimentos"
        title="Procedimentos"
        description="O que a clínica oferece. A assistente usa essa lista para explicar procedimentos, preços e cuidados."
        actions={
          <Button onClick={() => { setForm(emptyForm()); setFormError(null); }} className="gap-2">
            <Plus className="h-4 w-4" /> Novo procedimento
          </Button>
        }
      />
      {error && <ErrorNote message={error} onRetry={load} />}

      <Panel>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum procedimento cadastrado. Cadastre os principais para a assistente responder com segurança sobre preços e cuidados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Procedimento</th>
                  <th className="px-3 py-2 font-semibold">Categoria</th>
                  <th className="px-3 py-2 text-right font-semibold">Duração</th>
                  <th className="px-3 py-2 font-semibold">Preço</th>
                  <th className="px-3 py-2 font-semibold">Situação</th>
                  <th className="px-3 py-2"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2.5 font-medium">{p.name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{CATEGORIES[p.category] ?? p.category}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{p.duration_minutes} min</td>
                    <td className="px-3 py-2.5">
                      <span className="tabular-nums">{priceText(p)}</span>
                      {!p.price_visible && p.price_min != null && <span className="ml-1 text-xs text-muted-foreground">(a assistente não informa)</span>}
                    </td>
                    <td className="px-3 py-2.5">{p.is_active ? <Chip tone="ok">Ativo</Chip> : <Chip tone="neutral">Inativo</Chip>}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => { setForm(toForm(p)); setFormError(null); }} aria-label={`Editar ${p.name}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(p)} aria-label={`Remover ${p.name}`} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Dialog open={!!form} onOpenChange={(o) => !o && !saving && setForm(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {form && (
            <form onSubmit={save} className="flex flex-col gap-4" noValidate>
              <DialogHeader>
                <DialogTitle>{form.id ? 'Editar procedimento' : 'Novo procedimento'}</DialogTitle>
                <DialogDescription>Essas informações são usadas pela assistente nas conversas desta clínica.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <Label htmlFor="proc-name">Nome</Label>
                  <Input id="proc-name" placeholder="Limpeza de pele profunda" value={form.name} onChange={(e) => set('name', e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="proc-category">Categoria</Label>
                  <select id="proc-category" className={selectClass} value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {Object.entries(CATEGORIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="proc-duration">Duração (minutos)</Label>
                  <Input id="proc-duration" inputMode="numeric" value={form.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="proc-price-min">Preço a partir de (R$)</Label>
                  <Input id="proc-price-min" inputMode="decimal" placeholder="250" value={form.price_min} onChange={(e) => set('price_min', e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="proc-price-max">Preço até (R$)</Label>
                  <Input id="proc-price-max" inputMode="decimal" placeholder="400" value={form.price_max} onChange={(e) => set('price_max', e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                <div>
                  <Label htmlFor="proc-price-visible" className="text-sm font-medium">A assistente pode informar o preço</Label>
                  <p className="text-xs text-muted-foreground">Desligado, a assistente convida para a avaliação em vez de passar valores.</p>
                </div>
                <Switch id="proc-price-visible" checked={form.price_visible} onCheckedChange={(v) => set('price_visible', v)} />
              </div>
              {([
                ['description', 'Descrição', 'Como é feito e para quem é indicado'],
                ['contraindications', 'Contraindicações', 'Gestantes, uso de isotretinoína…'],
                ['pre_care', 'Cuidados antes', 'Evitar sol por 7 dias…'],
                ['post_care', 'Cuidados depois', 'Usar protetor solar FPS 50…'],
              ] as const).map(([key, label, placeholder]) => (
                <div key={key} className="flex flex-col gap-2">
                  <Label htmlFor={`proc-${key}`}>{label}</Label>
                  <Textarea id={`proc-${key}`} rows={2} placeholder={placeholder} value={form[key]} onChange={(e) => set(key, e.target.value)} />
                </div>
              ))}
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="proc-active" className="text-sm font-medium">Procedimento ativo</Label>
                <Switch id="proc-active" checked={form.is_active} onCheckedChange={(v) => set('is_active', v)} />
              </div>
              {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)} disabled={saving}>Voltar</Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar procedimento
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>A assistente deixa de oferecer esse procedimento. Para só pausar, edite e desligue “Procedimento ativo”.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ClinicProcedures;
