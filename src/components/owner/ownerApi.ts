import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Chama a edge function owner-actions e devolve a mensagem de erro em português
export async function ownerAction<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('owner-actions', { body: { action, ...payload } });
  if (error) {
    let message = 'Não foi possível concluir. Tente de novo.';
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // resposta sem corpo JSON
    }
    throw new Error(message);
  }
  return data as T;
}

// Mensagem dos RAISE do banco (22023 validação, P0002 não encontrado) já vem em português
export const rpcErrorMessage = (error: { message?: string; code?: string } | null, fallback: string) =>
  error && (error.code === '22023' || error.code === 'P0002') && error.message ? error.message : fallback;

export interface ClinicConfig {
  company_name: string | null;
  sdr_name: string | null;
  is_active: boolean;
  auto_response_enabled: boolean;
  ai_model_mode: string | null;
  system_prompt_override: string | null;
  audio_response_enabled: boolean;
  ai_scheduling_enabled: boolean;
  message_breaking_enabled: boolean;
  business_hours_start: string | null;
  business_hours_end: string | null;
  business_days: number[] | null;
  timezone: string | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
  has_whatsapp_token: boolean;
  whatsapp_verify_token: string | null;
}

// Configuração completa da clínica (formulários do dono). null = clínica sem configuração da Nina.
export function useClinicConfig(orgId: string) {
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('owner_get_clinic_config', { p_org: orgId });
    if (rpcError) {
      console.error('[useClinicConfig]', rpcError);
      setError('Não foi possível carregar a configuração desta clínica.');
    } else {
      setError(null);
      setConfig((data as unknown as ClinicConfig) ?? null);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  return { config, loading, error, reload };
}
