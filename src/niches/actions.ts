// Ações do nicho e da marca da empresa (chamadas pela Configuração Inicial e
// pelas Configurações). Se o servidor ainda não tiver as funções novas, devolve
// missingBackend para a tela avisar sem quebrar o resto.
import { supabase } from '@/integrations/supabase/client';
import { getNiche, nicheApplyPayload } from './registry';

export interface NicheActionResult {
  ok: boolean;
  missingBackend?: boolean;
  error?: string;
}

function toResult(error: any, fn: string): NicheActionResult {
  if (!error) return { ok: true };
  const msg = String(error.message || error);
  const missing = error.code === 'PGRST202' || error.code === '42883' || error.code === 'PGRST204'
    || msg.includes(fn) || msg.includes('schema cache');
  return { ok: false, missingBackend: missing, error: msg };
}

/** Troca o nicho: funil, etiquetas, equipe e (se mandar) o prompt da IA. */
export async function applyBusinessNiche(nicheId: string, prompt: string | null): Promise<NicheActionResult> {
  const niche = getNiche(nicheId);
  const { error } = await (supabase as any).rpc('apply_business_niche', {
    p_niche: niche.id,
    p_config: nicheApplyPayload(niche),
    p_prompt: prompt,
  });
  return toResult(error, 'apply_business_niche');
}

/** Volta o nicho, o funil, as etiquetas, a equipe e o prompt de antes da última troca. */
export async function undoBusinessNiche(): Promise<NicheActionResult> {
  const { error } = await (supabase as any).rpc('undo_business_niche');
  return toResult(error, 'undo_business_niche');
}

/** Grava (ou tira) o logo da empresa. */
export async function saveCompanyLogo(url: string | null): Promise<NicheActionResult> {
  const { data: row, error: readError } = await supabase
    .from('nina_settings')
    .select('id')
    .limit(1)
    .maybeSingle();
  if (readError || !row) return { ok: false, error: readError?.message || 'Configuração não encontrada' };
  const { error } = await (supabase as any)
    .from('nina_settings')
    .update({ company_logo_url: url })
    .eq('id', (row as any).id);
  return toResult(error, 'company_logo_url');
}
