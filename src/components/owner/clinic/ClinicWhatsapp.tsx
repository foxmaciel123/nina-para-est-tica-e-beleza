import React from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Chip, PageHeader, Panel, WhatsAppChip, formatNumber, formatRelative } from '../ownerUi';
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
      <code className="truncate rounded bg-muted px-2 py-0.5 text-xs">{value}</code>
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

const ClinicWhatsapp: React.FC = () => {
  const { detail } = useClinic();
  const wa = detail.whatsapp;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6" data-testid="clinic-whatsapp">
      <PageHeader eyebrow="Clínica · WhatsApp" title="WhatsApp" description="Situação da conexão da clínica com a API oficial da Meta." />

      {!wa ? (
        <Panel>
          <p className="text-sm text-muted-foreground">A clínica ainda não fez o primeiro acesso, então o WhatsApp não foi configurado.</p>
        </Panel>
      ) : (
        <>
          <Panel title="Conexão">
            <Row label="Situação"><WhatsAppChip connected={wa.connected} /></Row>
            <Row label="Phone Number ID"><CopyValue value={wa.phone_number_id} label="Phone Number ID" /></Row>
            <Row label="Conta Business (WABA)"><CopyValue value={wa.business_account_id} label="ID da conta" /></Row>
            <Row label="Token de acesso">{wa.has_token ? <Chip tone="ok">Cadastrado</Chip> : <Chip tone="warn">Falta cadastrar</Chip>}</Row>
          </Panel>

          <Panel title="Webhook na Meta">
            <Row label="URL de retorno"><CopyValue value={WEBHOOK_URL} label="URL do webhook" /></Row>
            <Row label="Token de verificação"><CopyValue value={wa.verify_token} label="Token de verificação" /></Row>
            <p className="text-xs text-muted-foreground">
              Use esses dois valores em Meta for Developers → WhatsApp → Configuração → Webhook, marcando o campo “messages”.
            </p>
          </Panel>

          <Panel title="Atividade">
            <Row label="Última mensagem recebida">{formatRelative(wa.last_received_at)}</Row>
            <Row label="Última mensagem enviada">{formatRelative(wa.last_sent_at)}</Row>
            <Row label="Falhas de envio · 7 dias">
              {wa.failed_sends_7d > 0 ? <Chip tone="bad">{formatNumber(wa.failed_sends_7d)}</Chip> : <Chip tone="ok">Nenhuma</Chip>}
            </Row>
          </Panel>

          <p className="text-xs text-muted-foreground">
            A clínica preenche as credenciais no painel dela, em Configurações → API. A conexão por QR code entra numa próxima etapa.
          </p>
        </>
      )}
    </div>
  );
};

export default ClinicWhatsapp;
