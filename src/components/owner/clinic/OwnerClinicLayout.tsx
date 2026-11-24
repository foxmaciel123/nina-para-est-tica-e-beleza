import React, { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard, MessageCircle, Bot, Wallet, AlertTriangle, Clock, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { OwnerFrame, OwnerNavGroup } from '../OwnerLayout';
import { PageLoader, StatusChip } from '../ownerUi';
import { usePanel } from '../panelScope';

export interface ClinicDetail {
  organization: {
    id: string; name: string; status: string; created_at: string;
    monthly_fee: number; contact_name: string | null; contact_phone: string | null; notes: string | null;
    agency_id?: string | null; agency_name?: string | null;
  };
  billing: { state: string; next_due_date: string | null; overdue_amount: number };
  members: { email: string; role: string; full_name: string | null; joined_at: string; last_sign_in_at: string | null }[];
  settings: {
    company_name: string | null; assistant_name: string | null; is_active: boolean; auto_response_enabled: boolean;
    whatsapp_connected: boolean; custom_prompt: boolean; prompt_preview: string | null; ai_model_mode: string | null;
    business_hours: string | null; business_days: number[] | null; audio_response_enabled: boolean; ai_scheduling_enabled: boolean;
  } | null;
  whatsapp: {
    connected: boolean; provider?: string; evolution_status?: string | null; evolution_phone?: string | null;
    phone_number_id: string | null; business_account_id: string | null; has_token: boolean;
    verify_token: string | null; last_received_at: string | null; last_sent_at: string | null; failed_sends_7d: number;
  } | null;
  usage_30d: {
    contacts_total: number; new_contacts: number; conversations: number; messages_received: number;
    ai_messages: number; appointments: number; ai_tokens?: number; ai_cost_usd?: number; // custo: só o dono recebe
  };
  daily_ai_messages: { day: string; count: number }[];
}

export interface ClinicContext {
  detail: ClinicDetail;
  reload: () => Promise<void>;
}

export const useClinic = () => useOutletContext<ClinicContext>();

const OwnerClinicLayout: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const panel = usePanel();
  const [detail, setDetail] = useState<ClinicDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    const { data, error: rpcError } = await supabase.rpc('owner_organization_detail', { p_org: id });
    if (rpcError) {
      console.error('[OwnerClinicLayout]', rpcError);
      setError(rpcError.code === 'P0002' ? 'Empresa não encontrada.' : 'Não foi possível carregar esta empresa.');
      return;
    }
    setError(null);
    setDetail(data as unknown as ClinicDetail);
  }, [id]);

  useEffect(() => {
    setDetail(null);
    reload();
  }, [reload]);

  const base = `${panel.base}/clinicas/${id}`;
  const groups: OwnerNavGroup[] = [
    {
      label: 'Empresa',
      items: [
        { label: 'Resumo', to: base, icon: LayoutDashboard, end: true },
        { label: 'WhatsApp', to: `${base}/whatsapp`, icon: MessageCircle },
        { label: 'Agente IA', to: `${base}/agente-ia`, icon: Bot },
        { label: 'Horários', to: `${base}/horarios`, icon: Clock },
        { label: 'Procedimentos', to: `${base}/procedimentos`, icon: Sparkles },
        { label: 'Cobrança', to: `${base}/cobranca`, icon: Wallet },
      ],
    },
  ];

  const header = (
    <div className="flex flex-col gap-2 px-1">
      <Link to={`${panel.base}/clinicas`} className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Empresas
      </Link>
      {detail && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold leading-tight" data-testid="clinic-name">{detail.organization.name}</span>
          <StatusChip status={detail.organization.status} />
        </div>
      )}
    </div>
  );

  return (
    <OwnerFrame groups={groups} header={header}>
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">{error}</p>
          <Link to={`${panel.base}/clinicas`} className="text-sm font-semibold text-accent hover:underline">Voltar para as empresas</Link>
        </div>
      ) : !detail ? (
        <PageLoader />
      ) : (
        <Outlet context={{ detail, reload } satisfies ClinicContext} />
      )}
    </OwnerFrame>
  );
};

export default OwnerClinicLayout;
