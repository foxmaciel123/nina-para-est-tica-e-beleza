import { useMemo } from 'react';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { getNiche, type Niche } from '@/niches/registry';

/** Nicho da empresa logada (padrão: estética). Palavras da tela vêm de niche.terms. */
export function useNiche(): Niche {
  const { businessNiche } = useCompanySettings();
  return useMemo(() => getNiche(businessNiche), [businessNiche]);
}

/** "clientes" → "Clientes" */
export function cap(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Concordância com o público do nicho: g(t, 'Novas', 'Novos') */
export function g(t: { clienteFeminino: boolean }, fem: string, masc: string): string {
  return t.clienteFeminino ? fem : masc;
}
