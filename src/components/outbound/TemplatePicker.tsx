import React from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { CATEGORY_LABEL, previewBody, QUALITY_LABEL, TIER_LABEL, type OutboundInfo, type TemplateParam, type WaTemplate } from './useOutbound';

export const inputCls =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

// Barra com o estado do WhatsApp (API oficial, qualidade e limite do número)
export const WhatsAppStatus: React.FC<{ info: OutboundInfo | null; loading: boolean; error: string | null }> = ({ info, loading, error }) => {
  if (loading) return <div className="rounded-2xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">Conferindo o WhatsApp da empresa...</div>;
  if (error) return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>Não consegui conferir o WhatsApp agora: {error}</span>
    </div>
  );
  if (!info || info.provider !== 'meta') return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>
        {info?.provider === 'evolution'
          ? 'Esta empresa está no WhatsApp por QR code. Disparo em massa só é feito pela API oficial da Meta, para não bloquear o número. O follow-up com texto livre funciona normalmente.'
          : 'O WhatsApp da empresa ainda não está conectado pela API oficial. Conecte em Configurações para usar o Disparo.'}
      </span>
    </div>
  );
  const q = info.quality?.quality ? QUALITY_LABEL[info.quality.quality] : null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/60 p-4 text-sm">
      <ShieldCheck className="h-5 w-5 text-emerald-400" />
      <span className="font-medium text-foreground">API oficial conectada</span>
      {info.quality?.phone && <span className="text-muted-foreground">{info.quality.phone}{info.quality.name ? ` · ${info.quality.name}` : ''}</span>}
      {q && <span className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${q.cls}`}>{q.label}</span>}
      {info.quality?.tier && <span className="rounded-full border border-border px-3 py-0.5 text-xs text-muted-foreground">Limite: {TIER_LABEL[info.quality.tier] ?? info.quality.tier}</span>}
      <span className="text-muted-foreground">{info.templates.length} modelo(s) aprovado(s)</span>
    </div>
  );
};

type Props = {
  templates: WaTemplate[];
  templatesError?: string | null;
  value: { name: string; language: string } | null;
  params: TemplateParam[];
  onChange: (t: WaTemplate | null, params: TemplateParam[]) => void;
  onParamsChange: (params: TemplateParam[]) => void;
};

// Escolher um modelo aprovado e dizer o que vai em cada {{1}}, {{2}}...
export const TemplatePicker: React.FC<Props> = ({ templates, templatesError, value, params, onChange, onParamsChange }) => {
  const selected = value ? templates.find(t => t.name === value.name && t.language === value.language) ?? null : null;

  const pick = (key: string) => {
    const t = templates.find(x => `${x.name}|${x.language}` === key) ?? null;
    const p: TemplateParam[] = t
      ? Array.from({ length: t.variables }, (_, i) => (i === 0 ? { source: 'first_name' } : { source: 'fixed', value: '' }))
      : [];
    onChange(t, p);
  };

  const setParam = (i: number, patch: Partial<TemplateParam>) => {
    const next = params.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    onParamsChange(next);
  };

  return (
    <div className="space-y-3">
      {templatesError && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">{templatesError}</p>
      )}
      <select
        className={inputCls}
        value={selected ? `${selected.name}|${selected.language}` : ''}
        onChange={e => pick(e.target.value)}
        data-testid="template-select"
      >
        <option value="">{templates.length ? 'Escolha um modelo aprovado...' : 'Nenhum modelo aprovado na Meta ainda'}</option>
        {templates.map(t => (
          <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
            {t.name} ({t.language}) · {CATEGORY_LABEL[t.category] ?? t.category}
          </option>
        ))}
      </select>

      {selected && (
        <>
          {selected.category === 'MARKETING' && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Modelo de Marketing: a Meta cobra por conversa e limita quantas mensagens de marketing cada pessoa recebe. Mande só para quem conhece a empresa.
            </p>
          )}
          {selected.header_format && selected.header_format !== 'TEXT' && (
            <p className="rounded-xl border border-border bg-background/50 p-3 text-xs text-muted-foreground">
              Este modelo tem {selected.header_format === 'IMAGE' ? 'imagem' : selected.header_format === 'VIDEO' ? 'vídeo' : 'documento'} no topo: informe o link do arquivo logo abaixo.
            </p>
          )}

          {params.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">O que entra em cada espaço</p>
              {params.map((p, i) => (
                <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <span className="w-12 font-mono text-sm text-primary">{`{{${i + 1}}}`}</span>
                  <select className={`${inputCls} sm:w-48`} value={p.source} onChange={e => setParam(i, { source: e.target.value as TemplateParam['source'] })}>
                    <option value="first_name">Primeiro nome</option>
                    <option value="name">Nome completo</option>
                    <option value="fixed">Texto fixo</option>
                  </select>
                  {p.source === 'fixed' && (
                    <input className={inputCls} placeholder="Ex.: 20% de desconto" value={p.value ?? ''} onChange={e => setParam(i, { value: e.target.value })} />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/30 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Prévia no WhatsApp
            </p>
            <div className="max-w-sm rounded-xl rounded-tl-none bg-[#005c4b] px-3 py-2 text-sm text-foreground shadow">
              {selected.header_text && <p className="mb-1 font-semibold">{selected.header_text}</p>}
              <p className="whitespace-pre-wrap">{previewBody(selected.body, params)}</p>
              {selected.footer && <p className="mt-1 text-xs text-white/60">{selected.footer}</p>}
            </div>
            {selected.buttons.length > 0 && (
              <div className="mt-1 flex max-w-sm flex-col gap-1">
                {selected.buttons.map(b => (
                  <span key={b} className="rounded-lg bg-[#005c4b]/70 py-1.5 text-center text-xs text-sky-200">{b}</span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
