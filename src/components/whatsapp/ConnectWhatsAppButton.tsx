import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, MessageCircle, Smartphone, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

// Botão "Conectar WhatsApp" (Cadastro Incorporado da Meta / Embedded Signup).
// Abre a janela do Facebook com o app da plataforma. A clínica entra com o
// Facebook dela, escolhe a empresa e o número; a Meta devolve um código que
// a função whatsapp-connect troca pelo token (o token nunca passa pela tela).
// Sem organizationId: a admin da clínica conecta o próprio número.
// Com organizationId: o dono ou a agência conecta pela clínica.

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = 'https://connect.facebook.net/pt_BR/sdk.js';
const GRAPH_VERSION = 'v23.0';

type Mode = 'cloud' | 'coexistence';
interface Result { ok: boolean; message: string; display_phone_number?: string | null; verified_name?: string | null }

let sdkPromise: Promise<any> | null = null;
function loadFacebookSdk(appId: string): Promise<any> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const init = () => {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      resolve(window.FB);
    };
    if (window.FB) return init();
    window.fbAsyncInit = init;
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Não foi possível abrir o Facebook. Confira se algum bloqueador de anúncios está ativo.'));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

async function finish(payload: Record<string, unknown>): Promise<Result> {
  const { data, error } = await supabase.functions.invoke('whatsapp-connect', { body: payload });
  if (error) {
    let message = 'Não foi possível conectar o WhatsApp agora. Tente de novo.';
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // sem corpo JSON
    }
    return { ok: false, message };
  }
  return data as Result;
}

const ConnectWhatsAppButton: React.FC<{ organizationId?: string; onConnected?: () => void }> = ({ organizationId, onConnected }) => {
  const [config, setConfig] = useState<{ appId: string; configId: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const session = useRef<{ waba_id?: string; phone_number_id?: string; event?: string }>({});

  useEffect(() => {
    supabase.rpc('meta_signup_config').then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : null;
      setConfig(row?.app_id && row?.config_id ? { appId: row.app_id, configId: row.config_id } : null);
    });
  }, []);

  // A janela do Facebook avisa o número e a conta escolhidos por postMessage
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      let host = '';
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (!/(^|\.)facebook\.com$/.test(host)) return;
      let data: any;
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      session.current.event = data.event;
      if (data.data?.waba_id) session.current.waba_id = String(data.data.waba_id);
      if (data.data?.phone_number_id) session.current.phone_number_id = String(data.data.phone_number_id);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const start = async (mode: Mode) => {
    if (!config) return;
    setResult(null);
    setBusy(mode);
    session.current = {};
    let FB: any;
    try {
      FB = await loadFacebookSdk(config.appId);
    } catch (err) {
      setBusy(null);
      setResult({ ok: false, message: (err as Error).message });
      return;
    }

    // O SDK do Facebook não aceita callback async
    FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setBusy(null);
          setResult({ ok: false, message: 'A conexão foi cancelada antes de terminar.' });
          return;
        }
        // O aviso com os IDs pode chegar um pouco depois da resposta do login
        setTimeout(async () => {
          const r = await finish({
            code,
            mode,
            waba_id: session.current.waba_id,
            phone_number_id: session.current.phone_number_id,
            ...(organizationId ? { organization_id: organizationId } : {}),
          });
          setBusy(null);
          setResult(r);
          if (r.ok) onConnected?.();
        }, 800);
      },
      {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: '3',
          ...(mode === 'coexistence' ? { featureType: 'whatsapp_business_app_onboarding' } : {}),
        },
      },
    );
  };

  if (config === undefined) return null;

  if (config === null) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="wa-connect-unavailable">
        O botão Conectar WhatsApp ainda não está disponível: falta configurar o app da Meta da plataforma.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="wa-connect">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => start('cloud')} disabled={!!busy} className="gap-2 bg-[#25D366] text-foreground hover:bg-[#1ebe5b]">
          {busy === 'cloud' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
          Conectar WhatsApp
        </Button>
        <Button type="button" variant="outline" onClick={() => start('coexistence')} disabled={!!busy} className="gap-2">
          {busy === 'coexistence' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
          Já uso o WhatsApp Business no celular
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Abre uma janela do Facebook: entre com o Facebook da clínica, escolha a empresa e o número e confirme o código. Nenhum token para copiar.
        Use o segundo botão para continuar usando o mesmo número no app do celular.
      </p>
      {result && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${result.ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}
          role="status"
        >
          {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 text-red-500" />}
          <span>
            {result.message}
            {result.ok && result.display_phone_number && ` Número ${result.display_phone_number}${result.verified_name ? ` (${result.verified_name})` : ''}.`}
          </span>
        </div>
      )}
    </div>
  );
};

export default ConnectWhatsAppButton;
