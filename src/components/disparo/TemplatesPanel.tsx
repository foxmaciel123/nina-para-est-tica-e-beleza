import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '../Button';
import { inputCls } from '../outbound/TemplatePicker';
import { CATEGORY_LABEL } from '../outbound/useOutbound';
import {
  countVars, draftProblem, EMPTY_DRAFT, fillExamples, LANGUAGE_LABEL, PRESETS, REJECTED_REASON, slugify,
  TEMPLATE_STATUS, type TemplateDraft,
} from './templateRules';

type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejected_reason: string | null;
  quality: string | null;
  header: string | null;
  body: string;
  footer: string | null;
  buttons: string[];
};

async function callTemplates(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('whatsapp-templates', { body: payload });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

// Balão parecido com o do WhatsApp, para ver como o cliente recebe
const Preview: React.FC<{ d: TemplateDraft }> = ({ d }) => (
  <div className="rounded-2xl bg-[#0b141a] p-4" data-testid="template-preview">
    <div className="max-w-[85%] rounded-xl rounded-tl-none bg-[#202c33] px-3 py-2 text-sm text-[#e9edef] shadow">
      {d.header.trim() && <p className="mb-1 font-semibold">{d.header.trim()}</p>}
      <p className="whitespace-pre-wrap break-words">{fillExamples(d.body, d.examples) || 'O texto da mensagem aparece aqui.'}</p>
      {d.footer.trim() && <p className="mt-1 text-xs text-[#8696a0]">{d.footer.trim()}</p>}
      <p className="mt-1 text-right text-[10px] text-[#8696a0]">10:30</p>
    </div>
    {d.buttons.filter(b => b.trim()).length > 0 && (
      <div className="mt-1 flex max-w-[85%] flex-col gap-1">
        {d.buttons.filter(b => b.trim()).map((b, i) => (
          <div key={i} className="rounded-xl bg-[#202c33] py-2 text-center text-sm font-medium text-[#53bdeb]">{b}</div>
        ))}
      </div>
    )}
  </div>
);

const NewTemplateDialog: React.FC<{ open: boolean; onClose: () => void; onCreated: () => void }> = ({ open, onClose, onCreated }) => {
  const [d, setD] = useState<TemplateDraft>(EMPTY_DRAFT);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setD(EMPTY_DRAFT); setTitle(''); }
  }, [open]);

  const vars = countVars(d.body);
  const problem = draftProblem(d);
  const set = (patch: Partial<TemplateDraft>) => setD(prev => ({ ...prev, ...patch }));

  const usePreset = (i: number) => {
    const p = PRESETS[i];
    setD({ ...p.draft, buttons: [...p.draft.buttons], examples: [...p.draft.examples] });
    setTitle(p.label);
  };

  const addVariable = () => {
    const n = vars + 1;
    set({ body: `${d.body}${d.body && !d.body.endsWith(' ') ? ' ' : ''}{{${n}}} ` });
  };

  const save = async () => {
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      await callTemplates({
        action: 'create',
        name: d.name,
        language: d.language,
        category: d.category,
        header: d.header.trim(),
        body: d.body.trim(),
        footer: d.footer.trim(),
        buttons: d.buttons.map(b => b.trim()).filter(Boolean),
        examples: d.examples.slice(0, vars).map(x => x.trim()),
      });
      toast.success('Modelo enviado para a Meta. A análise costuma levar de alguns minutos a 24 horas.');
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível criar o modelo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar modelo de mensagem</DialogTitle>
          <DialogDescription>O modelo vai para a análise da Meta. Depois de aprovado, você usa no Disparo, no Follow-up e nos lembretes.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Começar de um modelo pronto</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p, i) => (
              <button key={p.draft.name} type="button" onClick={() => usePreset(i)}
                className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:border-primary/50 hover:bg-primary/10">
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <label className="block text-xs text-muted-foreground">Nome do modelo
              <input className={inputCls} placeholder="Ex.: Lembrete de horário" value={title}
                onChange={e => { setTitle(e.target.value); set({ name: slugify(e.target.value) }); }} data-testid="template-name" />
              {d.name && <span className="mt-1 block font-mono text-[11px]">Nome na Meta: {d.name}</span>}
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-muted-foreground">Categoria
                <select className={inputCls} value={d.category} onChange={e => set({ category: e.target.value as TemplateDraft['category'] })}>
                  <option value="UTILITY">Utilidade (lembrete, confirmação, aviso)</option>
                  <option value="MARKETING">Marketing (promoção, novidade)</option>
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">Idioma
                <select className={inputCls} value={d.language} onChange={e => set({ language: e.target.value as TemplateDraft['language'] })}>
                  {Object.entries(LANGUAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>

            <label className="block text-xs text-muted-foreground">Título (opcional)
              <input className={inputCls} maxLength={60} placeholder="Ex.: Lembrete do seu horário" value={d.header} onChange={e => set({ header: e.target.value })} />
            </label>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Texto da mensagem</span>
                <button type="button" onClick={addVariable} className="text-xs font-medium text-primary hover:underline">+ Inserir variável {`{{${vars + 1}}}`}</button>
              </div>
              <textarea className={`${inputCls} h-32`} maxLength={1024} value={d.body} onChange={e => set({ body: e.target.value })}
                placeholder="Olá {{1}}, passando para lembrar do seu horário de {{2}}..." data-testid="template-body" />
              <p className="text-[11px] text-muted-foreground">As variáveis {'{{1}}'}, {'{{2}}'}... viram o nome do cliente, o procedimento, o horário. Não comece nem termine o texto com uma variável.</p>
            </div>

            {vars > 0 && (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-xs font-medium text-foreground">Exemplo de cada variável (a Meta usa para aprovar)</p>
                {Array.from({ length: vars }, (_, i) => (
                  <label key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-10 font-mono">{`{{${i + 1}}}`}</span>
                    <input className={inputCls} value={d.examples[i] ?? ''} placeholder={i === 0 ? 'Maria' : 'Ex.: limpeza de pele'}
                      onChange={e => { const ex = [...d.examples]; ex[i] = e.target.value; set({ examples: ex }); }} />
                  </label>
                ))}
              </div>
            )}

            <label className="block text-xs text-muted-foreground">Rodapé (opcional)
              <input className={inputCls} maxLength={60} placeholder="Ex.: Responda SAIR para não receber mais" value={d.footer} onChange={e => set({ footer: e.target.value })} />
            </label>

            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">Botões de resposta (até 3, opcional)</span>
              {d.buttons.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={inputCls} maxLength={25} value={b}
                    onChange={e => { const bt = [...d.buttons]; bt[i] = e.target.value; set({ buttons: bt }); }} />
                  <button type="button" aria-label="Remover botão" onClick={() => set({ buttons: d.buttons.filter((_, j) => j !== i) })}
                    className="rounded-full p-2 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
                </div>
              ))}
              {d.buttons.length < 3 && (
                <button type="button" onClick={() => set({ buttons: [...d.buttons, ''] })} className="text-xs font-medium text-primary hover:underline">+ Adicionar botão</button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Como o cliente vai ver</p>
            <Preview d={d} />
            {problem && (d.body || d.name) && <p className="text-xs text-amber-300">{problem}</p>}
            {d.category === 'UTILITY' && (
              <p className="text-[11px] text-muted-foreground">Utilidade é para avisos sobre o atendimento. Se tiver promoção ou desconto, a Meta muda para Marketing.</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={!!problem || saving} data-testid="create-template">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Enviar para aprovação
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Lista de modelos da clínica na Meta, com a situação de cada um
const TemplatesPanel: React.FC<{ enabled: boolean; onChanged?: () => void }> = ({ enabled, onChanged }) => {
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [deleting, setDeleting] = useState<MetaTemplate | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const data = await callTemplates({ action: 'list' });
      setTemplates((data?.templates ?? []) as MetaTemplate[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler os modelos');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  // Enquanto houver modelo em análise, confere de novo a cada 30 segundos
  const pending = useMemo(() => templates.some(t => t.status === 'PENDING'), [templates]);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [pending, load]);

  const remove = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      await callTemplates({ action: 'delete', name: deleting.name, id: deleting.id });
      toast.success('Modelo apagado');
      setDeleting(null);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível apagar');
    } finally {
      setBusyDelete(false);
    }
  };

  if (!enabled) return null;

  return (
    <div className="rounded-2xl border border-border bg-card/40" data-testid="templates-panel">
      <div className="flex flex-col justify-between gap-3 border-b border-border p-5 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-lg font-semibold">Modelos de mensagem</h3>
          <p className="text-xs text-muted-foreground">Mensagens que a Meta aprova antes de você enviar para quem não falou com a clínica nas últimas 24 horas.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" /> Atualizar</Button>
          <Button size="sm" onClick={() => setShowNew(true)} data-testid="new-template"><Plus className="mr-2 h-4 w-4" /> Criar modelo</Button>
        </div>
      </div>

      {loading && templates.length === 0 ? (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <p className="p-5 text-sm text-red-300">{error}</p>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
          <FileText className="h-8 w-8 text-yellow-400/70" />
          <p>Nenhum modelo ainda. Crie o primeiro, por exemplo um lembrete de horário.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {templates.map(t => {
            const st = TEMPLATE_STATUS[t.status] ?? { label: t.status, cls: 'border-border text-muted-foreground' };
            return (
              <li key={`${t.name}|${t.language}`} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{t.name}</span>
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                    <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[t.category] ?? t.category} · {LANGUAGE_LABEL[t.language] ?? t.language}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.body}</p>
                  {t.status === 'REJECTED' && (
                    <p className="mt-1 text-xs text-red-300">Motivo: {t.rejected_reason ? REJECTED_REASON[t.rejected_reason] ?? t.rejected_reason : 'a Meta não informou'}</p>
                  )}
                </div>
                <Button size="sm" variant="ghost" className="self-end sm:self-auto" onClick={() => setDeleting(t)} aria-label={`Apagar ${t.name}`}><Trash2 className="h-4 w-4" /></Button>
              </li>
            );
          })}
        </ul>
      )}

      <NewTemplateDialog open={showNew} onClose={() => setShowNew(false)} onCreated={() => { load(); onChanged?.(); }} />

      <Dialog open={!!deleting} onOpenChange={o => !o && !busyDelete && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Apagar o modelo {deleting?.name}?</DialogTitle>
            <DialogDescription>
              Ele sai da Meta e das campanhas que ainda não começaram. A Meta não deixa usar o mesmo nome de novo por cerca de 30 dias.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={busyDelete}>Cancelar</Button>
            <Button variant="danger" onClick={remove} disabled={busyDelete}>
              {busyDelete ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} Apagar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TemplatesPanel;
