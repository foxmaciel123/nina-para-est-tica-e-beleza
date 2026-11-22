import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Chip, ErrorNote, PageHeader, PageLoader, Panel } from './ownerUi';
import { rpcErrorMessage } from './ownerApi';

// App da Meta da plataforma, usado pelo botão "Conectar WhatsApp" de todas as clínicas
const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

interface MetaApp { app_id: string | null; config_id: string | null; has_app_secret: boolean; verify_token: string | null }

const CopyRow: React.FC<{ label: string; value: string | null }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5 text-sm last:border-0">
    <span className="flex-shrink-0 text-muted-foreground">{label}</span>
    {value ? (
      <span className="flex min-w-0 items-center gap-2">
        <code className="select-all truncate rounded bg-muted px-2 py-0.5 text-xs">{value}</code>
        <button
          type="button"
          aria-label={`Copiar ${label}`}
          className="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              toast.success(`${label} copiado`);
            } catch {
              toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
            }
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </span>
    ) : (
      <span className="text-muted-foreground">Aparece depois de salvar</span>
    )}
  </div>
);

const OwnerWhatsappApp: React.FC = () => {
  const [app, setApp] = useState<MetaApp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appId, setAppId] = useState('');
  const [configId, setConfigId] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('owner_get_meta_app');
    setLoading(false);
    if (rpcError) return setError('Não foi possível carregar o app da Meta.');
    const row = (Array.isArray(data) ? data[0] : null) as MetaApp | null;
    setError(null);
    setApp(row);
    setAppId(row?.app_id ?? '');
    setConfigId(row?.config_id ?? '');
    setSecret('');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{5,25}$/.test(appId.trim())) return setFormError('Informe o App ID (só números).');
    if (!/^\d{5,25}$/.test(configId.trim())) return setFormError('Informe o Configuration ID (só números).');
    if (!app?.has_app_secret && !secret.trim()) return setFormError('Informe o App Secret.');
    setFormError(null);
    setSaving(true);
    const { error: rpcError } = await supabase.rpc('owner_set_meta_app', {
      p_app_id: appId.trim(), p_config_id: configId.trim(), p_app_secret: secret.trim() || null,
    });
    setSaving(false);
    if (rpcError) return setFormError(rpcErrorMessage(rpcError, 'Não foi possível salvar. Tente de novo.'));
    toast.success('App da Meta salvo');
    load();
  };

  if (loading) return <PageLoader />;
  const ready = !!(app?.app_id && app?.config_id && app?.has_app_secret);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6" data-testid="owner-whatsapp-app">
      <PageHeader
        eyebrow="Sistema · WhatsApp"
        title="App da Meta (Conectar WhatsApp)"
        description="Um app só da plataforma para todas as clínicas. Com ele salvo, aparece o botão Conectar WhatsApp nas clínicas."
      />
      {error && <ErrorNote message={error} onRetry={load} />}

      <Panel title="Dados do app" actions={<Chip tone={ready ? 'ok' : 'warn'}>{ready ? 'Botão liberado' : 'Pendente'}</Chip>}>
        <form onSubmit={save} className="flex flex-col gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="meta-app-id">App ID</Label>
              <Input id="meta-app-id" inputMode="numeric" placeholder="1234567890123456" value={appId} onChange={(e) => setAppId(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="meta-config-id">Configuration ID</Label>
              <Input id="meta-config-id" inputMode="numeric" placeholder="987654321098765" value={configId} onChange={(e) => setConfigId(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="meta-app-secret">App Secret</Label>
            <Input
              id="meta-app-secret"
              type="password"
              autoComplete="off"
              placeholder={app?.has_app_secret ? 'App Secret salvo. Deixe em branco para manter.' : 'Chave secreta do app'}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              App ID e App Secret: Meta for Developers → app → Configurações → Básico. Configuration ID: Login do Facebook para Empresas → Configurações → a configuração do WhatsApp.
            </p>
          </div>
          {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar app da Meta
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Webhook do app">
        <CopyRow label="URL de retorno" value={WEBHOOK_URL} />
        <CopyRow label="Token de verificação" value={app?.verify_token ?? null} />
        <p className="pt-2 text-xs text-muted-foreground">
          Cole os dois em Meta for Developers → app → WhatsApp → Configuração → Webhook e assine o campo “messages”. É feito uma vez só e vale para todas as clínicas.
        </p>
      </Panel>
    </div>
  );
};

export default OwnerWhatsappApp;
