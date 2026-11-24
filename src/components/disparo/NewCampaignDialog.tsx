import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Rocket, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '../Button';
import { db, useContactTags, type OutboundInfo, type TemplateParam, type WaTemplate } from '../outbound/useOutbound';
import { inputCls, TemplatePicker } from '../outbound/TemplatePicker';

const SPEEDS = [
  { id: 'seguro', label: 'Seguro', hint: '1 mensagem a cada 8 a 15 segundos (recomendado)' },
  { id: 'normal', label: 'Normal', hint: '1 mensagem a cada 4 a 8 segundos' },
  { id: 'rapido', label: 'Rápido', hint: '1 mensagem a cada 1 a 3 segundos (só número com qualidade alta)' },
] as const;

const Section: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="space-y-3 rounded-2xl border border-border bg-card/40 p-4">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-xs text-primary">{n}</span>
      {title}
    </h3>
    {children}
  </section>
);

type Props = { open: boolean; onClose: () => void; info: OutboundInfo | null; onCreated: () => void };

const NewCampaignDialog: React.FC<Props> = ({ open, onClose, info, onCreated }) => {
  const tags = useContactTags();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<WaTemplate | null>(null);
  const [params, setParams] = useState<TemplateParam[]>([]);
  const [headerUrl, setHeaderUrl] = useState('');
  const [audienceType, setAudienceType] = useState<'all' | 'tags'>('tags');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [phonesText, setPhonesText] = useState('');
  const [speed, setSpeed] = useState<'seguro' | 'normal' | 'rapido'>('seguro');
  const [dailyLimit, setDailyLimit] = useState(250);
  const [windowStart, setWindowStart] = useState(8);
  const [windowEnd, setWindowEnd] = useState(20);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOptIn, setConfirmOptIn] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(''); setTemplate(null); setParams([]); setHeaderUrl(''); setAudienceType('tags'); setSelectedTags([]);
    setPhonesText(''); setSpeed('seguro'); setWhen('now'); setScheduledAt(''); setConfirmOptIn(false);
    const tier = info?.quality?.tier;
    setDailyLimit(tier === 'TIER_50' ? 40 : tier === 'TIER_250' ? 200 : 250);
  }, [open, info]);

  const phones = useMemo(
    () => phonesText.split(/[\n,;]+/).map(p => p.replace(/\D/g, '')).filter(p => p.length >= 10 && p.length <= 15),
    [phonesText],
  );

  // Estimativa de quantos clientes cadastrados entram na lista
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      if (audienceType === 'tags' && selectedTags.length === 0) { setEstimate(0); return; }
      let q = db.from('contacts').select('id', { count: 'exact', head: true }).eq('is_blocked', false).not('tags', 'cs', '{nao-perturbe}');
      if (audienceType === 'tags') q = q.overlaps('tags', selectedTags);
      const { count } = await q;
      if (!cancel) setEstimate(count ?? 0);
    })();
    return () => { cancel = true; };
  }, [open, audienceType, selectedTags]);

  const needsHeader = template?.header_format && template.header_format !== 'TEXT';
  const paramsOk = params.every(p => p.source !== 'fixed' || (p.value ?? '').trim());
  const total = (estimate ?? 0) + phones.length;
  const canSave = !!name.trim() && !!template && paramsOk && (!needsHeader || /^https?:\/\//.test(headerUrl))
    && total > 0 && confirmOptIn && (when === 'now' || !!scheduledAt) && windowEnd > windowStart;

  const toggleTag = (t: string) => setSelectedTags(s => (s.includes(t) ? s.filter(x => x !== t) : [...s, t]));

  const save = async () => {
    if (!template || !canSave) return;
    setSaving(true);
    try {
      const { data: c, error } = await db.from('disparo_campaigns').insert({
        name: name.trim(),
        template_name: template.name,
        template_language: template.language,
        template_category: template.category,
        template_body: template.body,
        template_params: params,
        header_media_url: needsHeader ? headerUrl.trim() : null,
        header_media_type: needsHeader ? template.header_format!.toLowerCase() : null,
        audience: { type: audienceType, tags: selectedTags, phones },
        speed,
        daily_limit: dailyLimit,
        window_start: windowStart,
        window_end: windowEnd,
      }).select('id').single();
      if (error) throw error;
      const startAt = when === 'later' && scheduledAt ? new Date(scheduledAt).toISOString() : null;
      const { data: count, error: prepErr } = await db.rpc('disparo_prepare_campaign', { p_campaign: c.id, p_start_at: startAt });
      if (prepErr) throw prepErr;
      toast.success(`Campanha criada com ${count} número(s). ${startAt ? 'Começa no horário agendado.' : 'O envio começa em até 1 minuto.'}`);
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar a campanha');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Rocket className="h-5 w-5 text-yellow-400" /> Nova campanha de disparo</DialogTitle>
          <DialogDescription>Envio pela API oficial, só com modelos aprovados pela Meta.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Section n={1} title="Nome da campanha">
            <input className={inputCls} placeholder="Ex.: Promoção de limpeza de pele - novembro" value={name} onChange={e => setName(e.target.value)} />
          </Section>

          <Section n={2} title="Mensagem (modelo aprovado)">
            <TemplatePicker
              templates={info?.templates ?? []}
              templatesError={info?.templatesError}
              value={template ? { name: template.name, language: template.language } : null}
              params={params}
              onChange={(t, p) => { setTemplate(t); setParams(p); }}
              onParamsChange={setParams}
            />
            {needsHeader && (
              <input className={inputCls} placeholder="Link público do arquivo (https://...)" value={headerUrl} onChange={e => setHeaderUrl(e.target.value)} />
            )}
          </Section>

          <Section n={3} title="Para quem">
            <div className="flex gap-2">
              {(['tags', 'all'] as const).map(t => (
                <button key={t} type="button" onClick={() => setAudienceType(t)}
                  className={`rounded-full border px-4 py-1.5 text-sm ${audienceType === t ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}>
                  {t === 'tags' ? 'Clientes com etiqueta' : 'Todos os clientes'}
                </button>
              ))}
            </div>
            {audienceType === 'tags' && (
              <div className="flex flex-wrap gap-2">
                {tags.filter(t => t !== 'nao-perturbe').map(t => (
                  <button key={t} type="button" onClick={() => toggleTag(t)}
                    className={`rounded-full border px-3 py-1 text-xs ${selectedTags.includes(t) ? 'border-yellow-400 bg-yellow-400/15 text-yellow-300' : 'border-border text-muted-foreground'}`}>
                    {t}
                  </button>
                ))}
                {tags.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma etiqueta nos clientes ainda.</p>}
              </div>
            )}
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Quer incluir números que ainda não são clientes? Cole aqui (um por linha, com DDD):</p>
              <textarea className={`${inputCls} h-20 font-mono`} placeholder={'11999998888\n21988887777'} value={phonesText} onChange={e => setPhonesText(e.target.value)} />
            </div>
            <p className="text-sm text-foreground">
              Vai para <strong className="text-yellow-300">{estimate === null ? '...' : total}</strong> número(s).
              <span className="text-muted-foreground"> Bloqueados e quem pediu para sair ficam de fora automaticamente.</span>
            </p>
          </Section>

          <Section n={4} title="Ritmo e horário (protege o número)">
            <div className="grid gap-2">
              {SPEEDS.map(s => (
                <label key={s.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${speed === s.id ? 'border-primary bg-primary/10' : 'border-border'}`}>
                  <input type="radio" className="mt-1" checked={speed === s.id} onChange={() => setSpeed(s.id)} />
                  <span><span className="block text-sm font-medium text-foreground">{s.label}</span><span className="text-xs text-muted-foreground">{s.hint}</span></span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-xs text-muted-foreground">Máximo por dia
                <input type="number" min={1} className={inputCls} value={dailyLimit} onChange={e => setDailyLimit(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="text-xs text-muted-foreground">Enviar das (hora)
                <input type="number" min={0} max={23} className={inputCls} value={windowStart} onChange={e => setWindowStart(Math.min(23, Math.max(0, Number(e.target.value) || 0)))} />
              </label>
              <label className="text-xs text-muted-foreground">até as (hora)
                <input type="number" min={1} max={24} className={inputCls} value={windowEnd} onChange={e => setWindowEnd(Math.min(24, Math.max(1, Number(e.target.value) || 1)))} />
              </label>
            </div>
            {info?.quality?.tier === 'TIER_50' || info?.quality?.tier === 'TIER_250' ? (
              <p className="text-xs text-amber-300">Seu número ainda está no limite de {info.quality.tier === 'TIER_50' ? '50' : '250'} conversas novas por dia na Meta. Deixe o máximo por dia abaixo disso.</p>
            ) : null}
          </Section>

          <Section n={5} title="Quando">
            <div className="flex flex-wrap items-center gap-2">
              {(['now', 'later'] as const).map(w => (
                <button key={w} type="button" onClick={() => setWhen(w)}
                  className={`rounded-full border px-4 py-1.5 text-sm ${when === w ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}>
                  {w === 'now' ? 'Começar agora' : 'Agendar'}
                </button>
              ))}
              {when === 'later' && (
                <input type="datetime-local" className={`${inputCls} sm:w-60`} value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
              )}
            </div>
          </Section>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            <input type="checkbox" className="mt-1" checked={confirmOptIn} onChange={e => setConfirmOptIn(e.target.checked)} />
            <span className="text-foreground">
              <ShieldCheck className="mr-1 inline h-4 w-4 text-emerald-400" />
              Confirmo que essas pessoas são clientes ou já falaram com a empresa e aceitam receber mensagens. Quem responder "SAIR" ou "PARAR" sai da lista sozinho.
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={!canSave || saving} data-testid="create-campaign">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
              {when === 'later' ? 'Agendar disparo' : 'Iniciar disparo'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NewCampaignDialog;
