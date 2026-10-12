import React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBrand } from '@/hooks/useBrand';

// Ícone da marca: imagem enviada pelo dono ou, sem imagem, uma estrela neutra.
export const BrandIcon: React.FC<{ className?: string; iconClassName?: string }> = ({ className, iconClassName }) => {
  const { brand } = useBrand();
  return (
    <div
      className={cn(
        'flex items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-primary/20',
        className,
      )}
      data-testid="brand-icon"
    >
      {brand.icon_url ? (
        <img src={brand.icon_url} alt={brand.name} className="h-full w-full object-cover" />
      ) : (
        <Sparkles className={cn('h-1/2 w-1/2', iconClassName)} aria-label={brand.name} />
      )}
    </div>
  );
};

// Linha pequena com o nome da marca (ex.: "Sua Marca · Estética com IA").
export const BrandEyebrow: React.FC<{ className?: string; suffix?: string }> = ({ className, suffix }) => {
  const { brand } = useBrand();
  const text = suffix ? `${brand.name} · ${suffix}` : brand.tagline ? `${brand.name} · ${brand.tagline}` : brand.name;
  return (
    <p className={className} data-testid="brand-name">
      {text}
    </p>
  );
};
