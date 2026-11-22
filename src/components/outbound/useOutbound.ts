// Dados compartilhados entre DISPARO e FOLLOW-UP
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// As tabelas novas ainda não estão nos tipos gerados do Supabase
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as SupabaseClient<any>;

export type WaTemplate = {
  name: string;
  language: string;
  category: string;
  body: string;
  header_format: string | null;
  header_text: string | null;
  footer: string | null;
  buttons: string[];
  variables: number;
};

export type TemplateParam = { source: 'first_name' | 'name' | 'fixed'; value?: string };

export type OutboundInfo = {
  provider: 'meta' | 'evolution' | 'none';
  quality: { quality: string | null; tier: string | null; phone: string | null; name: string | null } | null;
  templates: WaTemplate[];
  templatesError: string | null;
};

export function useOutboundInfo() {
  const [info, setInfo] = useState<OutboundInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('disparo-info');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setInfo(data as OutboundInfo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível falar com o servidor');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { info, loading, error, reload: load };
}

export function useContactTags() {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await db.from('contacts').select('tags').limit(5000);
      const all = new Set<string>();
      (data ?? []).forEach((c: { tags: string[] | null }) => (c.tags ?? []).forEach(t => t && all.add(t)));
      setTags([...all].sort((a, b) => a.localeCompare(b)));
    })();
  }, []);
  return tags;
}

export const firstName = (n?: string | null) => {
  const f = (n ?? '').trim().split(/\s+/)[0] ?? '';
  return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : '';
};

export function previewBody(body: string, params: TemplateParam[], sampleName = 'Maria Souza') {
  return body.replace(/\{\{(\d+)\}\}/g, (_, i) => {
    const p = params[Number(i) - 1];
    if (!p) return `{{${i}}}`;
    if (p.source === 'first_name') return firstName(sampleName);
    if (p.source === 'name') return sampleName;
    return p.value || `{{${i}}}`;
  });
}

export const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidade',
  AUTHENTICATION: 'Autenticação',
};

export const QUALITY_LABEL: Record<string, { label: string; cls: string }> = {
  GREEN: { label: 'Qualidade alta', cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  YELLOW: { label: 'Qualidade média', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  RED: { label: 'Qualidade baixa', cls: 'text-red-400 border-red-500/30 bg-red-500/10' },
};

export const TIER_LABEL: Record<string, string> = {
  TIER_50: '50 conversas/dia',
  TIER_250: '250 conversas/dia',
  TIER_1K: '1.000 conversas/dia',
  TIER_10K: '10.000 conversas/dia',
  TIER_100K: '100.000 conversas/dia',
  TIER_UNLIMITED: 'sem limite',
};
