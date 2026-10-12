import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, QrCode, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// Conexão do WhatsApp por QR code (Evolution API da Nina).
// Sem organizationId: a admin da clínica conecta o próprio número.
// Com organizationId: o dono da plataforma conecta pela clínica.

interface QrState {
  provider: string;
  status: string; // none | connecting | open | close
  phone: string | null;
  qr?: string | null;
}

const POLL_MS = 3000;
const POLL_LIMIT = 60; // ~3 minutos esperando a leitura

async function call(action: string, organizationId?: string): Promise<QrState> {
  const { data, error } = await supabase.functions.invoke('whatsapp-qr', {
    body: { action, ...(organizationId ? { organization_id: organizationId } : {}) },
  });
  if (error) {
    let message = 'Não foi possível falar com o serviço de WhatsApp. Tente de novo.';
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // sem corpo JSON
    }
    throw new Error(message);
  }
  return data as QrState;
}

const formatPhone = (digits: string | null) => {
  if (!digits) return '';
  const m = digits.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${digits}`;
};

const WhatsAppQrPanel: React.FC<{ organizationId?: string; onChange?: () => void }> = ({ organizationId, onChange }) => {
  const [state, setState] = useState<QrState | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'load' | 'connect' | 'disconnect' | null>('load');
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const polls = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const next = await call('status', organizationId);
      setState(next);
      setError(null);
      return next;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy((b) => (b === 'load' ? null : b));
    }
  }, [organizationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Enquanto o QR está na tela, consulta até o celular conectar
  useEffect(() => {
    if (!qr) return;
    polls.current = 0;
    const timer = setInterval(async () => {
      polls.current += 1;
      const next = await refresh();
      if (next?.status === 'open') {
        setQr(null);
        toast.success('WhatsApp conectado');
        onChange?.();
      } else if (polls.current >= POLL_LIMIT) {
        setQr(null);
        setError('O QR code expirou. Gere um novo para tentar de novo.');
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [qr, refresh, onChange]);

  const connect = async () => {
    setBusy('connect');
    setError(null);
    try {
      const next = await call('connect', organizationId);
      setState(next);
      if (next.status === 'open') {
        toast.success('WhatsApp já está conectado');
      } else {
        setQr(next.qr ?? null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    setError(null);
    try {
      setState(await call('disconnect', organizationId));
      setQr(null);
      setConfirmDisconnect(false);
      toast.success('WhatsApp desconectado');
      onChange?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const connected = state?.status === 'open';

  return (
    <div className="flex flex-col gap-4" data-testid="whatsapp-qr-panel">
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
        <p>
          A conexão por QR code usa o WhatsApp do celular, como o WhatsApp Web. É mais simples de conectar, mas o
          WhatsApp pode bloquear o número se perceber volume alto de mensagens automáticas. Para mais segurança, prefira a API oficial.
        </p>
      </div>

      {busy === 'load' ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3" data-testid="qr-connected">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>
              Conectado{state?.phone ? <> ao número <strong>{formatPhone(state.phone)}</strong></> : ''}. A Nina responde por este WhatsApp.
            </span>
          </div>
          {confirmDisconnect ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Desconectar mesmo?</span>
              <button type="button" onClick={() => setConfirmDisconnect(false)} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted/60">Voltar</button>
              <button type="button" onClick={disconnect} disabled={busy === 'disconnect'} className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90">
                {busy === 'disconnect' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Desconectar
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDisconnect(true)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted/60">
              <Unplug className="h-3.5 w-3.5" /> Desconectar
            </button>
          )}
        </div>
      ) : qr ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-4 text-center" data-testid="qr-code">
          <img src={qr} alt="QR code para conectar o WhatsApp" className="h-60 w-60 rounded-md bg-white p-2" />
          <p className="max-w-sm text-sm text-muted-foreground">
            No celular da clínica, abra o WhatsApp → <strong>Aparelhos conectados</strong> → <strong>Conectar um aparelho</strong> e aponte para o QR code.
          </p>
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando a leitura…
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={connect}
          disabled={busy === 'connect'}
          className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          data-testid="qr-connect"
        >
          {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
          Gerar QR code
        </button>
      )}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
};

export default WhatsAppQrPanel;
