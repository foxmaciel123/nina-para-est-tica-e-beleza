import React from 'react';
import { Check } from 'lucide-react';
import { NICHES, NICHE_GROUPS, type NicheId } from '@/niches/registry';

interface NichePickerProps {
  value: string;
  onChange: (id: NicheId) => void;
  disabled?: boolean;
}

/** Grade com os 21 tipos de negócio, separados por grupo. */
export const NichePicker: React.FC<NichePickerProps> = ({ value, onChange, disabled }) => (
  <div className="space-y-4" data-testid="niche-picker">
    {NICHE_GROUPS.map((group) => (
      <div key={group}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {NICHES.filter((n) => n.group === group).map((n) => {
            const selected = n.id === value;
            return (
              <button
                key={n.id}
                type="button"
                disabled={disabled}
                onClick={() => onChange(n.id)}
                data-testid={`niche-option-${n.id}`}
                aria-pressed={selected}
                className={`relative flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
                  selected
                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                    : 'border-border bg-card/60 hover:border-primary/50 hover:bg-card'
                }`}
              >
                <span className="text-2xl leading-none" aria-hidden>{n.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">{n.label}</span>
                  <span className="block text-xs text-muted-foreground">{n.description}</span>
                </span>
                {selected && (
                  <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    ))}
  </div>
);

export default NichePicker;
