import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDown, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Button } from '../Button';
import { db, useContactTags, type OutboundInfo, type TemplateParam } from '../outbound/useOutbound';
import { inputCls, TemplatePicker } from '../outbound/TemplatePicker';

export type Step = {
  id?: string;
  delay_hours: number;
  kind: 'texto' | 'modelo';
  message: string;
  template_name: string | null;
  template_language: string | null;
  template_body: string | null;
  template_params: TemplateParam[];
};

export type Sequence = {
  id?: string;
  name: string;
  active: boolean;
  trigger_type: 'sem_resposta' | 'apos_agendamento' | 'etiqueta';
  trigger_hours: number;
  trigger_tag: string | null;
  stop_on_reply: boolean;
  window_start: number;
  window_end: number;
  steps: Step[];
};

export const emptyStep = (kind: Step['kind'] = 'texto', delay = 0, message = ''): Step => ({
  delay_hours: delay, kind, message, template_name: null, template_language: 'pt_BR', template_body: null, template_params: [],
});

export const PRESETS: { label: string; hint: string; seq: Sequence }[] = [
  {
    label: 'Cliente parou de responder',
    hint: 'Retoma a conversa de quem sumiu no meio do atendimento',
    seq: {
      name: 'Cliente parou de responder', active: false, trigger_type: 'sem_resposta', trigger_hours: 3, trigger_tag: null,
      stop_on_reply: true, window_start: 8, window_end: 20,
      steps: [
        emptyStep('texto', 0, 'Oi {nome}! Conseguiu ver minha última mensagem? Se tiver alguma dúvida, é só me chamar 😊'),
        emptyStep('modelo', 24),
      ],
    },
  },
  {
    label: 'Depois do atendimento',
    hint: 'Pergunta como a cliente está e pede avaliação',
    seq: {
      name: 'Pós-atendimento', active: false, trigger_type: 'apos_agendamento', trigger_hours: 24, trigger_tag: null,
      stop_on_reply: true, window_start: 9, window_end: 19,
      steps: [emptyStep('modelo', 0), emptyStep('modelo', 24 * 30)],
    },
  },
  {
    label: 'Lead novo (por etiqueta)',
    hint: 'Sequência para quem recebeu uma etiqueta, ex.: "lead-anuncio"',
    seq: {
      name: 'Lead novo', active: false, trigger_type: 'etiqueta', trigger_hours: 0, trigger_tag: '',
      stop_on_reply: true, window_start: 8, window_end: 20,
      steps: [emptyStep('modelo', 0), emptyStep('modelo', 48)],
    },
  },
];

const delayLabel = (h: number) => (h === 0 ? 'na hora' : h % 24 === 0 ? `${h / 24} dia(s)` : `${h} hora(s)`);

type Props = { open: boolean; initial: Sequence | null; info: OutboundInfo | null; onClose: () => void; onSaved: () => void };

const SequenceDialog: React.FC<Props> = ({ open, initial, info, onClose, onSaved }) => {
  const tags = useContactTags();
  const [seq, setSeq] = useState<Sequence>(PRESETS[0].seq);
  const [saving, setSaving] = useState(false);
  const isMeta = info?.provider === 'meta';

  useEffect(() => {
    if (!open) return;
    const base: Sequence = JSON.parse(JSON.stringify(initial ?? PRESETS[0].seq));
    base.steps = (base.steps ?? []).map(st => ({ ...emptyStep(), ...st, message: st.message ?? '', template_params: st.template_params ?? [] }));
    setSeq(base);
  }, [open, initial]);

  const set = <K extends keyof Sequence>(k: K, v: Sequence[K]) => setSeq(s => ({ ...s, [k]: v }));
  const setStep = (i: number, patch: Partial<Step>) => setSeq(s => ({ ...s, steps: s.steps.map((st, idx) => (idx === i ? { ...st, ...patch } : st)) }));

  // Horas desde a última fala do cliente até cada passo (para avisar da janela de 24h)
  const hoursSinceClient = (i: number) => {
    const base = seq.trigger_type === 'sem_resposta' ? seq.trigger_hours : 999;
    return base + seq.steps.slice(0, i + 1).reduce((a, s) => a + s.delay_hours, 0);
  };

  const stepErrors = seq.steps.map(st =>
    st.kind === 'texto' ? (!st.message.trim() ? 'Escreva a mensagem' : null)
      : !st.template_name ? 'Escolha um modelo aprovado'
      : st.template_params.some(p => p.source === 'fixed' && !(p.value ?? '').trim()) ? 'Preencha os textos fixos do modelo' : null);

  const valid = seq.name.trim() && seq.steps.length > 0 && stepErrors.every(e => !e)
    && (seq.trigger_type !== 'etiqueta' || (seq.trigger_tag ?? '').trim()) && seq.window_end > seq.window_start;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const payload = {
        name: seq.name.trim(), active: seq.active, trigger_type: seq.trigger_type, trigger_hours: seq.trigger_hours,
        trigger_tag: seq.trigger_type === 'etiqueta' ? (seq.trigger_tag ?? '').trim() : null,
        stop_on_reply: seq.stop_on_reply, window_start: seq.window_start, window_end: seq.window_end,
      };
      let id = seq.id;
      if (id) {
        const { error } = await db.from('followup_sequences').update(payload).eq('id', id);
        if (error) throw error;
        const { error: delErr } = await db.from('followup_steps').delete().eq('sequence_id', id);
        if (delErr) throw delErr;
      } else {
        const { data, error } = await db.from('followup_sequences').insert(payload).select('id').single();
        if (error) throw error;
        id = data.id;
      }
      const { error: stErr } = await db.from('followup_steps').insert(seq.steps.map((st, i) => ({
        sequence_id: id, position: i, delay_hours: st.delay_hours, kind: st.kind,
        message: st.kind === 'texto' ? st.message : null,
        template_name: st.kind === 'modelo' ? st.template_name : null,
        template_language: st.kind === 'modelo' ? st.template_language : null,
        template_body: st.kind === 'modelo' ? st.template_body : null,
        template_params: st.kind === 'modelo' ? st.template_params : [],
      })));
      if (stErr) throw stErr;
      toast.success(seq.active ? 'Follow-up salvo e ligado' : 'Follow-up salvo (desligado)');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{seq.id ? 'Editar follow-up' : 'Novo follow-up'}</DialogTitle>
          <DialogDescription>Mensagens automáticas de acompanhamento. Param sozinhas quando o cliente responde.</DialogDescription>
        </DialogHeader>

        {!seq.id && (
          <div className="grid gap-2 sm:grid-cols-3">
            {PRESETS.map(p => (
              <button key={p.label} type="button" onClick={() => setSeq(JSON.parse(JSON.stringify(p.seq)))}
                className={`rounded-xl border p-3 text-left text-xs ${seq.name === p.seq.name ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary/50'}`}>
                <span className="block text-sm font-medium text-foreground">{p.label}</span>
                <span className="text-muted-foreground">{p.hint}</span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-4">
          <input className={inputCls} placeholder="Nome do follow-up" value={seq.name} onChange={e => set('name', e.target.value)} />

          <section className="space-y-3 rounded-2xl border border-border bg-card/40 p-4">
            <p className="text-sm font-semibold">Quando começa</p>
            <select className={inputCls} value={seq.trigger_type} onChange={e => set('trigger_type', e.target.value as Sequence['trigger_type'])}>
              <option value="sem_resposta">Cliente parou de responder</option>
              <option value="apos_agendamento">Depois do horário do agendamento</option>
              <option value="etiqueta">Cliente recebeu uma etiqueta</option>
            </select>
            {seq.trigger_type !== 'etiqueta' ? (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                {seq.trigger_type === 'sem_resposta' ? 'Sem responder há' : 'Começar'}
                <input type="number" min={0} className={`${inputCls} w-24`} value={seq.trigger_hours}
                  onChange={e => set('trigger_hours', Math.max(0, Number(e.target.value) || 0))} />
                {seq.trigger_type === 'sem_resposta' ? 'hora(s)' : 'hora(s) depois do agendamento'}
              </label>
            ) : (
              <div className="space-y-2">
                <input className={inputCls} list="followup-tags" placeholder="Nome da etiqueta" value={seq.trigger_tag ?? ''} onChange={e => set('trigger_tag', e.target.value)} />
                <datalist id="followup-tags">{tags.map(t => <option key={t} value={t} />)}</datalist>
                <p className="text-xs text-muted-foreground">Quem já tem essa etiqueta entra na régua assim que ela for ligada.</p>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <p className="text-sm font-semibold">Mensagens</p>
            {seq.steps.map((st, i) => {
              const closedWindow = isMeta && st.kind === 'texto' && hoursSinceClient(i) >= 24;
              return (
                <div key={i}>
                  {i > 0 && <div className="flex justify-center py-1"><ArrowDown className="h-4 w-4 text-muted-foreground" /></div>}
                  <div className="space-y-3 rounded-2xl border border-border bg-card/40 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-xs text-primary">{i + 1}</span>
                      <span className="text-muted-foreground">Esperar</span>
                      <input type="number" min={0} className={`${inputCls} w-20`} value={st.delay_hours}
                        onChange={e => setStep(i, { delay_hours: Math.max(0, Number(e.target.value) || 0) })} />
                      <span className="text-muted-foreground">hora(s) ({delayLabel(st.delay_hours)}) e enviar</span>
                      <select className={`${inputCls} w-auto`} value={st.kind} onChange={e => setStep(i, { kind: e.target.value as Step['kind'] })}>
                        <option value="texto">texto livre</option>
                        <option value="modelo" disabled={!isMeta}>modelo aprovado</option>
                      </select>
                      <button type="button" className="ml-auto text-muted-foreground hover:text-red-400" title="Remover"
                        onClick={() => setSeq(s => ({ ...s, steps: s.steps.filter((_, idx) => idx !== i) }))}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {st.kind === 'texto' ? (
                      <>
                        <textarea className={`${inputCls} h-24`} placeholder="Use {nome} para o primeiro nome do cliente" value={st.message}
                          onChange={e => setStep(i, { message: e.target.value })} />
                        {closedWindow && (
                          <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            Pela regra da Meta, texto livre só chega até 24h depois da última mensagem do cliente. Neste passo é provável que já tenha passado: use um modelo aprovado.
                          </p>
                        )}
                      </>
                    ) : (
                      <TemplatePicker
                        templates={info?.templates ?? []}
                        templatesError={info?.templatesError}
                        value={st.template_name ? { name: st.template_name, language: st.template_language ?? 'pt_BR' } : null}
                        params={st.template_params}
                        onChange={(t, p) => setStep(i, { template_name: t?.name ?? null, template_language: t?.language ?? 'pt_BR', template_body: t?.body ?? null, template_params: p })}
                        onParamsChange={p => setStep(i, { template_params: p })}
                      />
                    )}
                    {stepErrors[i] && <p className="text-xs text-red-300">{stepErrors[i]}</p>}
                  </div>
                </div>
              );
            })}
            <Button variant="outline" size="sm" onClick={() => setSeq(s => ({ ...s, steps: [...s.steps, emptyStep(isMeta ? 'modelo' : 'texto', 24)] }))}>
              <Plus className="mr-1 h-4 w-4" /> Adicionar mensagem
            </Button>
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-card/40 p-4 text-sm">
            <label className="flex items-center justify-between gap-3">
              <span>Parar quando o cliente responder</span>
              <Switch checked={seq.stop_on_reply} onCheckedChange={v => set('stop_on_reply', v)} />
            </label>
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
              Enviar só das
              <input type="number" min={0} max={23} className={`${inputCls} w-20`} value={seq.window_start} onChange={e => set('window_start', Math.min(23, Math.max(0, Number(e.target.value) || 0)))} />
              às
              <input type="number" min={1} max={24} className={`${inputCls} w-20`} value={seq.window_end} onChange={e => set('window_end', Math.min(24, Math.max(1, Number(e.target.value) || 1)))} />
              horas
            </div>
            <label className="flex items-center justify-between gap-3">
              <span className="font-medium">Ligado</span>
              <Switch checked={seq.active} onCheckedChange={v => set('active', v)} />
            </label>
          </section>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={!valid || saving} data-testid="save-followup">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SequenceDialog;
