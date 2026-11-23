import React, { useCallback, useEffect, useState } from 'react';
import { Edit2, Loader2, Plus, Repeat, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Button } from '../Button';
import { db, useOutboundInfo } from '../outbound/useOutbound';
import { WhatsAppStatus } from '../outbound/TemplatePicker';
import SequenceDialog, { type Sequence } from './SequenceDialog';

type Row = Sequence & { id: string; created_at: string };
type Counts = Record<string, { ativo: number; respondeu: number; concluido: number; outros: number }>;
type Enrollment = {
  id: string; status: string; current_step: number; next_run_at: string; enrolled_at: string; stop_reason: string | null;
  contact: { name: string | null; phone_number: string } | null;
};

const TRIGGER: Record<string, (s: Row) => string> = {
  sem_resposta: s => `Quando o cliente fica ${s.trigger_hours}h sem responder`,
  apos_agendamento: s => `${s.trigger_hours}h depois do agendamento`,
  etiqueta: s => `Quando o cliente recebe a etiqueta "${s.trigger_tag}"`,
};
const ESTATUS: Record<string, string> = { ativo: 'Na régua', respondeu: 'Respondeu', concluido: 'Concluiu', parado: 'Parado', erro: 'Erro' };
const fmt = (d: string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const FollowUp: React.FC = () => {
  const { info, loading: infoLoading, error: infoError } = useOutboundInfo();
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Sequence | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [people, setPeople] = useState<{ seq: Row; list: Enrollment[] } | null>(null);

  const load = useCallback(async () => {
    const [{ data: seqs }, { data: enr }] = await Promise.all([
      db.from('followup_sequences').select('*, steps:followup_steps(*)').order('created_at', { ascending: true }),
      db.from('followup_enrollments').select('sequence_id, status').limit(10000),
    ]);
    setRows(((seqs ?? []) as Row[]).map(s => ({
      ...s,
      steps: [...((s.steps ?? []) as (Sequence["steps"][number] & { position: number })[])].sort((a, b) => a.position - b.position),
    })));
    const c: Counts = {};
    (enr ?? []).forEach((e: { sequence_id: string; status: string }) => {
      c[e.sequence_id] ??= { ativo: 0, respondeu: 0, concluido: 0, outros: 0 };
      if (e.status === 'ativo' || e.status === 'respondeu' || e.status === 'concluido') c[e.sequence_id][e.status]++;
      else c[e.sequence_id].outros++;
    });
    setCounts(c);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const toggle = async (s: Row, active: boolean) => {
    const { error } = await db.from('followup_sequences').update({ active }).eq('id', s.id);
    if (error) return toast.error(error.message);
    toast.success(active ? 'Follow-up ligado' : 'Follow-up desligado');
    load();
  };

  const remove = async (s: Row) => {
    if (!window.confirm(`Apagar o follow-up "${s.name}"? Quem está na régua para de receber.`)) return;
    const { error } = await db.from('followup_sequences').delete().eq('id', s.id);
    if (error) return toast.error(error.message);
    toast.success('Follow-up apagado');
    load();
  };

  const openPeople = async (s: Row) => {
    const { data } = await db.from('followup_enrollments')
      .select('id, status, current_step, next_run_at, enrolled_at, stop_reason, contact:contacts(name, phone_number)')
      .eq('sequence_id', s.id).order('enrolled_at', { ascending: false }).limit(300);
    setPeople({ seq: s, list: (data ?? []) as unknown as Enrollment[] });
  };

  const stopOne = async (id: string) => {
    await db.from('followup_enrollments').update({ status: 'parado', stop_reason: 'Parado pelo painel' }).eq('id', id);
    if (people) openPeople(people.seq);
    load();
  };

  return (
    <div className="relative h-full overflow-y-auto bg-background p-4 text-foreground sm:p-8 custom-scrollbar">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight" data-testid="followup-title">Follow-up</h2>
          <p className="mt-1 text-sm text-muted-foreground">Mensagens automáticas de acompanhamento para não perder nenhum cliente.</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowDialog(true); }} disabled={!info || info.provider === 'none'}>
          <Plus className="mr-2 h-4 w-4" /> Novo follow-up
        </Button>
      </div>

      <div className="mb-6"><WhatsAppStatus info={info} loading={infoLoading} error={infoError} /></div>

      {loading ? (
        <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/40 p-10 text-center text-muted-foreground">
          <Repeat className="h-10 w-10 text-primary/70" />
          <p>Nenhum follow-up ainda. Comece por um modelo pronto: cliente que parou de responder, pós-atendimento ou lead novo.</p>
          {info && info.provider !== 'none' && <Button onClick={() => { setEditing(null); setShowDialog(true); }}><Plus className="mr-2 h-4 w-4" /> Criar follow-up</Button>}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map(s => {
            const c = counts[s.id] ?? { ativo: 0, respondeu: 0, concluido: 0, outros: 0 };
            return (
              <div key={s.id} className="space-y-4 rounded-2xl border border-border bg-card/60 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{s.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{TRIGGER[s.trigger_type]?.(s)}</p>
                  </div>
                  <Switch checked={s.active} onCheckedChange={v => toggle(s, v)} />
                </div>
                <ol className="space-y-1 text-xs text-muted-foreground">
                  {s.steps.map((st, i) => (
                    <li key={i} className="truncate">
                      <span className="text-primary">{i + 1}.</span> {st.delay_hours ? `após ${st.delay_hours}h · ` : ''}
                      {st.kind === 'modelo' ? `modelo ${st.template_name ?? '?'}` : `"${st.message}"`}
                    </li>
                  ))}
                </ol>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-secondary/50 p-2"><p className="text-lg font-bold">{c.ativo}</p><p className="text-[11px] text-muted-foreground">na régua</p></div>
                  <div className="rounded-xl bg-secondary/50 p-2"><p className="text-lg font-bold text-yellow-300">{c.respondeu}</p><p className="text-[11px] text-muted-foreground">responderam</p></div>
                  <div className="rounded-xl bg-secondary/50 p-2"><p className="text-lg font-bold">{c.concluido}</p><p className="text-[11px] text-muted-foreground">concluíram</p></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(s); setShowDialog(true); }}><Edit2 className="mr-1 h-4 w-4" /> Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => openPeople(s)}><Users className="mr-1 h-4 w-4" /> Pessoas</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(s)}><Trash2 className="mr-1 h-4 w-4" /> Apagar</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SequenceDialog open={showDialog} initial={editing} info={info} onClose={() => setShowDialog(false)} onSaved={load} />

      <Dialog open={!!people} onOpenChange={o => !o && setPeople(null)}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{people?.seq.name}</DialogTitle>
            <DialogDescription>Quem entrou neste follow-up (últimos 300)</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border text-sm">
            {people?.list.map(e => (
              <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                <span>
                  {e.contact?.name || e.contact?.phone_number}
                  <span className="block text-xs text-muted-foreground">
                    entrou {fmt(e.enrolled_at)} · passo {Math.min(e.current_step + 1, people.seq.steps.length)}/{people.seq.steps.length}
                    {e.status === 'ativo' ? ` · próximo envio ${fmt(e.next_run_at)}` : ''}
                    {e.stop_reason ? ` · ${e.stop_reason}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap text-xs">
                  {ESTATUS[e.status] ?? e.status}
                  {e.status === 'ativo' && <button className="text-red-300 hover:underline" onClick={() => stopOne(e.id)}>parar</button>}
                </span>
              </li>
            ))}
            {people?.list.length === 0 && <li className="py-4 text-center text-muted-foreground">Ninguém entrou ainda.</li>}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FollowUp;
