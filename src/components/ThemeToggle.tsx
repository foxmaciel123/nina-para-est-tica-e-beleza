import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PALETTES, useTheme } from '@/hooks/useTheme';

/** Bolinha com as duas cores do tema (fundo + destaque). */
const Swatch: React.FC<{ colors: [string, string]; size?: number }> = ({ colors, size = 18 }) => (
  <span
    aria-hidden
    className="inline-block rounded-full border border-border flex-shrink-0"
    style={{
      width: size,
      height: size,
      background: `linear-gradient(135deg, ${colors[0]} 0 55%, ${colors[1]} 55% 100%)`,
    }}
  />
);

/** Seletor de tema: abre a lista com os 3 temas do painel. */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className }) => {
  const { palette, setPalette } = useTheme();
  const [open, setOpen] = useState(false);
  const current = PALETTES.find(p => p.id === palette) ?? PALETTES[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          className={`relative inline-flex items-center justify-center w-9 h-9 rounded-full border border-border bg-card/60 hover:bg-card transition-colors ${className || ''}`}
          title={`Tema: ${current.label}`}
          aria-label="Escolher tema"
          data-testid="theme-picker"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
        >
          <Swatch colors={current.swatch} />
        </motion.button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-56 p-1.5">
        <p className="px-2 pt-1 pb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Tema do painel</p>
        {PALETTES.map(p => {
          const active = p.id === palette;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPalette(p.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-3 rounded-md px-2 py-2 text-sm text-left transition-colors ${
                active ? 'bg-secondary font-semibold text-foreground' : 'text-foreground hover:bg-secondary/60'
              }`}
              data-testid={`theme-option-${p.id}`}
            >
              <Swatch colors={p.swatch} size={20} />
              <span className="flex-1">{p.label}</span>
              {active && <Check className="w-4 h-4 text-accent" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};

export default ThemeToggle;
