import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Marca exibida no sistema (white label). Vem do banco: endereço próprio da
// agência/clínica ou, por padrão, a marca da plataforma configurada pelo dono.
export interface Brand {
  name: string;
  tagline: string | null;
  logo_url: string | null;
  icon_url: string | null;
  accent_color: string | null;
  support_email: string | null;
  support_whatsapp: string | null;
}

export const NEUTRAL_BRAND: Brand = {
  name: 'Atendimento IA',
  tagline: 'Atendimento com IA para clínicas',
  logo_url: null,
  icon_url: null,
  accent_color: null,
  support_email: null,
  support_whatsapp: null,
};

const CACHE_KEY = 'brand-cache';

interface BrandContextValue {
  brand: Brand;
  loading: boolean;
  refresh: () => Promise<void>;
}

const BrandContext = createContext<BrandContextValue | undefined>(undefined);

function readCache(): Brand | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...NEUTRAL_BRAND, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

function writeCache(brand: Brand) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(brand));
  } catch {
    // sem armazenamento local: só não guarda para a próxima visita
  }
}

// "#0A4F95" → "210 87% 31%" (formato das variáveis de cor do tema)
export function hexToHsl(hex: string): string | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

const ACCENT_VARS = ['--accent', '--ring', '--sidebar-primary'];

function applyBrand(brand: Brand) {
  document.title = brand.tagline ? `${brand.name} · ${brand.tagline}` : brand.name;

  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) {
    icon.href = brand.icon_url || '/favicon.svg';
    icon.type = brand.icon_url && !brand.icon_url.endsWith('.svg') ? 'image/png' : 'image/svg+xml';
  }

  const root = document.documentElement;
  const hsl = brand.accent_color ? hexToHsl(brand.accent_color) : null;
  for (const v of ACCENT_VARS) {
    if (hsl) root.style.setProperty(v, hsl);
    else root.style.removeProperty(v);
  }
}

export const BrandProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [brand, setBrand] = useState<Brand>(() => readCache() ?? NEUTRAL_BRAND);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('public_brand' as any, { p_host: window.location.hostname });
    if (!error && data && typeof data === 'object') {
      const next = { ...NEUTRAL_BRAND, ...(data as Partial<Brand>) };
      setBrand(next);
      writeCache(next);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    applyBrand(brand);
  }, [brand]);

  return <BrandContext.Provider value={{ brand, loading, refresh }}>{children}</BrandContext.Provider>;
};

export function useBrand(): BrandContextValue {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error('useBrand precisa estar dentro de BrandProvider');
  return ctx;
}
