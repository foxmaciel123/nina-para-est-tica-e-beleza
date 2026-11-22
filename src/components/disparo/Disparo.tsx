import React, { useCallback, useEffect, useState } from 'react';
import { Ban, Eye, Loader2, Pause, Play, Plus, RefreshCw, Rocket, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '../Button';
import { db, useOutboundInfo } from '../outbound/useOutbound';
import { WhatsAppStatus } from '../outbound/TemplatePicker';
import NewCampaignDialog from './NewCampaignDialog';

type Campaign = {
  id: string; name: string; status: string; template_name: string; template_category: string | null;
  total: number; sent: number; failed: number; skipped: number; speed: string; daily_limit: number;
  scheduled_at: string | null; started_at: string | null; finished_at: string | null; pause_reason: string | null; created_at: string;
};
type Stats = Record<string, { delivered: number; read: number; replied: number }>;

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Rascunho', cls: 'border-border text-muted-foreground' },
  scheduled: { label: 'Agendada', cls: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  running: { label: 'Enviando', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  paused: { label: 'Pausada', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  auto_paused: { label: 'Pausada automaticamente', cls: 'border-red-500/30 bg-red-500/10 text-red-300' },
  completed: { label: 'Concluída', cls: 'border-primary/30 bg-primary/10 text-primary' },
  cancelled: { label: 'Cancelada', cls: 'border-border text-muted-foreground' },
};

const RSTATUS: Record<string, string> = { pending: 'Na fila', sending: 'Enviando', sent: 'Enviado', failed: 'Falhou', skipped: 'Pulado' };

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-');

const Disparo: React.FC = () => {
  const { info, loading: infoLoading, error: infoError, reload } = useOutboundInfo();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [viewing, setViewing] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<{ phone: string; name: string | null; status: string; error: string | null; sent_at: string | null }[]>([]);

  const load = useCallback(async () => {
    const [{ data: c }, { data: s }] = await Promise.all([
      db.from('disparo_campaigns').select('*').order('created_at', { ascending: false }).limit(100),
      db.rpc('disparo_campaign_stats'),
    ]);
    setCampaigns((c ?? []) as Campaign[]);
    const map: Stats = {};
    (s ?? []).forEach((r: { campaign_id: string; delivered: number; read: number; replied: number }) => {
      map[r.campaign_id] = { delivered: Number(r.delivered), read: Number(r.read), replied: Number(r.replied) };
    });
    setStats(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = db.channel('disparo-campaigns')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disparo_campaigns' }, () => load())
      .subscribe();
    const t = setInterval(load, 20000);
    return () => { db.removeChannel(ch); clearInterval(t); };
  }, [load]);

  const setStatus = async (c: Campaign, status: string) => {
    const { error } = await db.from('disparo_campaigns').update({ status, ...(status === 'running' ? { pause_reason: null } : {}) }).eq('id', c.id);
    if (error) return toast.error(error.message);
    if (status === 'cancelled') await db.from('disparo_recipients').update({ status: 'skipped', error: 'Campanha cancelada' }).eq('campaign_id', c.id).eq('status', 'pending');
    toast.success(status === 'running' ? 'Disparo retomado' : status === 'paused' ? 'Disparo pausado' : 'Campanha cancelada');
    load();
  };

  const openRecipients = async (c: Campaign) => {
    setViewing(c);
    const { data } = await db.from('disparo_recipients').select('phone, name, status, error, sent_at').eq('campaign_id', c.id).order('created_at').limit(1000);
    setRecipients(data ?? []);
  };

  const totals = campaigns.reduce((a, c) => ({
    sent: a.sent + c.sent,
    delivered: a.delivered + (stats[c.id]?.delivered ?? 0),
    read: a.read + (stats[c.id]?.read ?? 0),
    replied: a.replied + (stats[c.id]?.replied ?? 0),
  }), { sent: 0, delivered: 0, read: 0, replied: 0 });

  const canDispatch = info?.provider === 'meta' && (info?.templates.length ?? 0) > 0;

  return (
    <div className="relative h-full overflow-y-auto bg-background p-4 text-foreground sm:p-8 custom-scrollbar">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-yellow-400" data-testid="disparo-title">DISPARO</h2>
          <p className="mt-1 text-sm text-muted-foreground">Campanhas em massa pelo WhatsApp oficial, com modelos aprovados e ritmo seguro.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { reload(); load(); }}><RefreshCw className="mr-2 h-4 w-4" /> Atualizar</Button>
          <Button onClick={() => setShowNew(true)} disabled={!canDispatch} title={canDispatch ? '' : 'Precisa da API oficial e de pelo menos um modelo aprovado'}>
            <Plus className="mr-2 h-4 w-4" /> Nova campanha
          </Button>
        </div>
      </div>

      <div className="mb-6"><WhatsAppStatus info={info} loading={infoLoading} error={infoError} /></div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Enviadas', value: totals.sent },
          { label: 'Entregues', value: totals.delivered },
          { label: 'Lidas', value: totals.read },
          { label: 'Responderam', value: totals.replied },
        ].map(k => (
          <div key={k.label} className="rounded-2xl border border-border bg-card/60 p-5">
            <p className="text-sm text-muted-foreground">{k.label}</p>
            <p className="mt-2 text-3xl font-bold">{k.value.toLocaleString('pt-BR')}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 rounded-2xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
        <p className="mb-1 flex items-center gap-2 font-medium text-foreground"><ShieldCheck className="h-4 w-4 text-emerald-400" /> Como o disparo protege seu número</p>
        Só usa modelos aprovados pela Meta · envia um por vez, no horário comercial · respeita o limite diário · pausa sozinho se a qualidade do número cair para vermelho ou se muitas mensagens falharem · quem responde SAIR ou PARAR nunca mais recebe.
      </div>

      <div className="rounded-2xl border border-border bg-card/40">
        <div className="border-b border-border p-5">
          <h3 className="text-lg font-semibold">Campanhas</h3>
        </div>
        {loading ? (
          <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
            <Rocket className="h-10 w-10 text-yellow-400/70" />
            <p>Nenhuma campanha ainda.</p>
            {canDispatch && <Button onClick={() => setShowNew(true)}><Plus className="mr-2 h-4 w-4" /> Criar a primeira</Button>}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {campaigns.map(c => {
              const st = STATUS[c.status] ?? STATUS.draft;
              const done = c.sent + c.failed + c.skipped;
              const pct = c.total ? Math.round((done / c.total) * 100) : 0;
              const s = stats[c.id];
              return (
                <li key={c.id} className="space-y-3 p-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{c.name}</span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Modelo {c.template_name} · ritmo {c.speed} · até {c.daily_limit}/dia · {c.status === 'scheduled' ? `começa ${fmt(c.scheduled_at)}` : `criada ${fmt(c.created_at)}`}
                      </p>
                      {c.pause_reason && <p className="mt-1 text-xs text-red-300">{c.pause_reason}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openRecipients(c)}><Eye className="mr-1 h-4 w-4" /> Números</Button>
                      {c.status === 'running' && <Button size="sm" variant="outline" onClick={() => setStatus(c, 'paused')}><Pause className="mr-1 h-4 w-4" /> Pausar</Button>}
                      {(c.status === 'paused' || c.status === 'auto_paused') && <Button size="sm" variant="outline" onClick={() => setStatus(c, 'running')}><Play className="mr-1 h-4 w-4" /> Continuar</Button>}
                      {['running', 'paused', 'auto_paused', 'scheduled'].includes(c.status) && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus(c, 'cancelled')}><Ban className="mr-1 h-4 w-4" /> Cancelar</Button>
                      )}
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-yellow-400 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <span>{done}/{c.total} processados ({pct}%)</span>
                    <span className="text-emerald-300">{c.sent} enviados</span>
                    <span>{s?.delivered ?? 0} entregues</span>
                    <span>{s?.read ?? 0} lidos</span>
                    <span className="text-yellow-300">{s?.replied ?? 0} responderam</span>
                    {c.failed > 0 && <span className="text-red-300">{c.failed} falharam</span>}
                    {c.skipped > 0 && <span>{c.skipped} pulados</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <NewCampaignDialog open={showNew} onClose={() => setShowNew(false)} info={info} onCreated={load} />

      <Dialog open={!!viewing} onOpenChange={o => !o && setViewing(null)}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
            <DialogDescription>Situação de cada número (até 1.000)</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border text-sm">
            {recipients.map(r => (
              <li key={r.phone} className="flex items-start justify-between gap-3 py-2">
                <span>
                  <span className="font-mono">{r.phone}</span>
                  {r.name && <span className="ml-2 text-muted-foreground">{r.name}</span>}
                  {r.error && <span className="block text-xs text-red-300">{r.error}</span>}
                </span>
                <span className="whitespace-nowrap text-xs text-muted-foreground">{RSTATUS[r.status] ?? r.status}{r.sent_at ? ` · ${fmt(r.sent_at)}` : ''}</span>
              </li>
            ))}
            {recipients.length === 0 && <li className="py-4 text-center text-muted-foreground">Nenhum número.</li>}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Disparo;
