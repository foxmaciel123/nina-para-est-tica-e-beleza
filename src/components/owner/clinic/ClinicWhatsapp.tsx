import React, { useEffect, useState } from 'react';
import { Copy, Loader2, PlugZap, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Chip, ErrorNote, PageHeader, PageLoader, Panel, WhatsAppChip, formatNumber, formatRelative } from '../ownerUi';
import { ownerAction, rpcErrorMessage, useClinicConfig } from '../ownerApi';
import { useClinic } from './OwnerClinicLayout';

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

const CopyValue: React.FC<{ value: string | null; label: string }> = ({ value, label }) => {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado`);
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  };
  return (
    <span className="flex min-w-0 items-center justify-end gap-2">
      <code className="select-all truncate rounded bg-muted px-2 py-0.5 text-xs">{value}</code>
      <button type="button" onClick={copy} className="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Copiar ${label}`}>
        <Copy className="h-3.5 w-3.5" />
      </button>
    </span>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5 text-sm last:border-0">
    <span className="flex-shrink-0 text-muted-foreground">{label}</span>
    <span className="min-w-0 text-right font-medium">{children}</span>
  </div>
);

interface TestResult { ok: boolean; message: string; display_phone_number?: string | null; verified_name?: string | null }

const ClinicWhatsapp: React.FC = () => {
  const { detail, reload: reloadDetail } = useClinic();
  const orgId = detail.organization.id;
  const { config, loading, error, reload } = useClinicConfig(orgId);
  const wa = detail.whatsapp;

  const [phoneId, setPhoneId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [token, setToken] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!config) return;
    setPhoneId(config.whatsapp_phone_number_id ?? '');
    setWabaId(config.whatsapp_business_account_id ?? '');
    setToken('');
  }, [config]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneId.trim()) return setFormError('Informe o Phone Number ID.');
    if (!config?.has_whatsapp_token && !token.trim()) return setFormError('Informe o token de acesso.');
    setFormError(null);
    setSaving(true);
    const { error: rpcError } = await supabase.rpc('owner_update_clinic_whatsapp', {
      p_org: orgId, p_phone_number_id: phoneId, p_business_account_id: wabaId, p_access_token: token || null,
    });
    setSaving(false);
    if (rpcError) {
      setFormError(rpcErrorMessage(rpcError, 'Não foi possível salvar. Tente de novo.'));
      return;
    }
    toast.success('WhatsApp da clínica salvo');
    setTest(null);
    reload();
    reloadDetail();
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await ownerAction<TestResult>('test_whatsapp', { organization_id: orgId }));
    } catch (err) {
      setTest({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6" data-testid="clinic-whatsapp">
      <PageHeader eyebrow="Clínica · WhatsApp" title="WhatsApp" description="Conexão da clínica com a API oficial da Meta. Você pode configurar por ela." />
      {error && <ErrorNote message={error} onRetry={reload} />}

      {!config ? (
        <Panel>
          <p className="text-sm text-muted-foreground">Esta clínica ainda não tem a configuração da Nina. Ela é criada no cadastro da clínica ou no primeiro acesso da dona.</p>
        </Panel>
      ) : (
        <>
          <Panel title="Credenciais" actions={<WhatsAppChip connected={!!wa?.connected} />}>
            <form onSubmit={save} className="flex flex-col gap-4" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wa-phone-id">Phone Number ID</Label>
                  <Input id="wa-phone-id" placeholder="104857362910" value={phoneId} onChange={(e) => setPhoneId(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wa-waba-id">ID da conta Business (WABA)</Label>
                  <Input id="wa-waba-id" placeholder="998877665544" value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="wa-token">Token de acesso</Label>
                <Input
                  id="wa-token"
                  type="password"
                  autoComplete="off"
                  placeholder={config.has_whatsapp_token ? 'Token salvo. Deixe em branco para manter.' : 'Cole o token permanente da Meta'}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
              {test && (
                <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${test.ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`} role="status">
                  {test.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 text-red-500" />}
                  <span>
                    {test.message}
                    {test.ok && test.display_phone_number && ` Número ${test.display_phone_number}${test.verified_name ? ` (${test.verified_name})` : ''}.`}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={runTest} disabled={testing || !config.has_whatsapp_token} className="gap-2">
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  Testar conexão
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar WhatsApp
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">O teste usa o que está salvo. Salve antes de testar.</p>
            </form>
          </Panel>

          <Panel title="Webhook na Meta">
            <Row label="URL de retorno"><CopyValue value={WEBHOOK_URL} label="URL do webhook" /></Row>
            <Row label="Token de verificação"><CopyValue value={config.whatsapp_verify_token} label="Token de verificação" /></Row>
            <p className="text-xs text-muted-foreground">
              Use esses dois valores em Meta for Developers → WhatsApp → Configuração → Webhook, marcando o campo “messages”.
            </p>
          </Panel>

          {wa && (
            <Panel title="Atividade">
              <Row label="Última mensagem recebida">{formatRelative(wa.last_received_at)}</Row>
              <Row label="Última mensagem enviada">{formatRelative(wa.last_sent_at)}</Row>
              <Row label="Falhas de envio · 7 dias">
                {wa.failed_sends_7d > 0 ? <Chip tone="bad">{formatNumber(wa.failed_sends_7d)}</Chip> : <Chip tone="ok">Nenhuma</Chip>}
              </Row>
            </Panel>
          )}
        </>
      )}
    </div>
  );
};

export default ClinicWhatsapp;
