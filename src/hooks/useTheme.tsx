import React, { createContext, useContext, useEffect, useState } from 'react';

/**
 * Temas do painel.
 *  - marinho: escuro azul-marinho (padrão)
 *  - grafite: escuro neutro com verde Pixel Pro
 *  - claro:   claro azul (menu lateral escuro, letras escuras)
 *
 * `theme` continua sendo 'light' | 'dark' (o modo), para quem só precisa
 * saber se a tela está clara ou escura (ex.: Toaster). A paleta escolhida
 * fica em `palette`.
 */
export type Palette = 'marinho' | 'grafite' | 'claro';
type Theme = 'light' | 'dark';

export const PALETTES: { id: Palette; label: string; mode: Theme; swatch: [string, string] }[] = [
  { id: 'marinho', label: 'Azul-marinho', mode: 'dark', swatch: ['#071628', '#2f7de1'] },
  { id: 'grafite', label: 'Grafite + Verde', mode: 'dark', swatch: ['#111315', '#22c58b'] },
  { id: 'claro', label: 'Claro Azul', mode: 'light', swatch: ['#eef2f7', '#0a4f95'] },
];

interface ThemeContextValue {
  theme: Theme;
  palette: Palette;
  setPalette: (p: Palette) => void;
  /** Compatibilidade: 'dark' → Azul-marinho, 'light' → Claro Azul. */
  setTheme: (t: Theme) => void;
  /** Passa para o próximo tema da lista. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'nina-beleza-theme';
const DEFAULT_PALETTE: Palette = 'marinho';

const modeOf = (p: Palette): Theme => PALETTES.find(x => x.id === p)?.mode ?? 'dark';

function getInitialPalette(): Palette {
  if (typeof window === 'undefined') return DEFAULT_PALETTE;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'marinho' || saved === 'grafite' || saved === 'claro') return saved;
    // valores antigos (antes dos 3 temas)
    if (saved === 'dark') return 'marinho';
    if (saved === 'light') return 'claro';
  } catch {
    /* sem storage: usa o padrão */
  }
  return DEFAULT_PALETTE;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [palette, setPaletteState] = useState<Palette>(getInitialPalette);
  const theme = modeOf(palette);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark', ...PALETTES.map(p => `theme-${p.id}`));
    root.classList.add(theme, `theme-${palette}`);
    root.style.colorScheme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, palette);
    } catch {
      /* ignora */
    }
  }, [palette, theme]);

  const setPalette = (p: Palette) => setPaletteState(p);
  const setTheme = (t: Theme) => setPaletteState(t === 'light' ? 'claro' : 'marinho');
  const toggle = () =>
    setPaletteState(prev => {
      const i = PALETTES.findIndex(p => p.id === prev);
      return PALETTES[(i + 1) % PALETTES.length].id;
    });

  return (
    <ThemeContext.Provider value={{ theme, palette, setPalette, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback seguro (ex.: durante HMR ou se consumido fora do Provider)
    return {
      theme: 'dark' as Theme,
      palette: DEFAULT_PALETTE,
      setPalette: () => {},
      setTheme: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}
