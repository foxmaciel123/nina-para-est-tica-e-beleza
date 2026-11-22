import React, { useEffect, useState } from 'react';
import { Loader2, Megaphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '../Button';
import { db } from '../outbound/useOutbound';
import { brl } from './adsMath';

type Sale = { id: string; value: number; description: string | null; sold_at: string; source: string };
type Origin = { ad_source_id: string | null; ad_headline: string | null; ad_first_touch_at: string | null };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  contactName?: string;
}

// "1.234,56" / "1234.56" / "R$ 300" -> número
export function parseMoney(raw: string): number | null {
  const s = raw.replace(/[^\d,.-]/g, '');
  if (!s) return null;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const RegisterSaleDialog: React.FC<Props> = ({ open, onOpenChange, contactId, contactName }) => {
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [sales, setSales] = useState<Sale[]>([]);
  const [origin, setOrigin] = useState<Origin | null>(null);

  const load = async () => {
    if (!contactId) return;
    const [{ data: s }, { data: c }] = await Promise.all([
      db.from('sales').select('id, value, description, sold_at, source').eq('contact_id', contactId).order('sold_at', { ascending: false }).limit(20),
      db.from('contacts').select('ad_source_id, ad_headline, ad_first_touch_at').eq('id', contactId).maybeSingle(),
    ]);
    setSales((s ?? []) as Sale[]);
    setOrigin((c ?? null) as Origin | null);
  };

  useEffect(() => {
    if (!open) return;
    setValue('');
    setDescription('');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contactId]);

  const save = async () => {
    const amount = parseMoney(value);
    if (!contactId || amount === null) return toast.error('Digite o valor da venda (ex.: 350,00)');
    setSaving(true);
    const { error } = await db.from('sales').insert({ contact_id: contactId, value: amount, description: description.trim() || null });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Venda de ${brl(amount)} registrada`);
    setValue('');
    setDescription('');
    load();
  };

  const remove = async (s: Sale) => {
    if (s.source === 'funil') return toast.info('Esta venda vem do Funil (card em Ganho). Altere por lá.');
    const { error } = await db.from('sales').delete().eq('id', s.id);
    if (error) return toast.error(error.message);
    load();
  };

  const total = sales.reduce((t, s) => t + Number(s.value), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar venda{contactName ? `: ${contactName}` : ''}</DialogTitle>
          <DialogDescription>A venda entra no relatório de Anúncios, no anúncio que trouxe esta cliente.</DialogDescription>
        </DialogHeader>

        <div className={`mb-2 flex items-start gap-2 rounded-xl border p-3 text-xs ${origin?.ad_source_id ? 'border-primary/30 bg-primary/5' : 'border-border text-muted-foreground'}`}>
          <Megaphone className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
          {origin?.ad_source_id ? (
            <span>Veio do anúncio <b>{origin.ad_headline || origin.ad_source_id}</b>
              {origin.ad_first_touch_at && <> em {new Date(origin.ad_first_touch_at).toLocaleDateString('pt-BR')}</>}.</span>
          ) : (
            <span>Sem anúncio identificado (orgânico, indicação ou chegou antes do rastreamento).</span>
          )}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1 space-y-1">
              <Label htmlFor="sale-value">Valor (R$)</Label>
              <Input id="sale-value" inputMode="decimal" placeholder="350,00" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="sale-desc">O que vendeu</Label>
              <Input id="sale-desc" placeholder="Ex.: Limpeza de pele" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving || !value.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registrar venda
            </Button>
          </div>
        </div>

        {sales.length > 0 && (
          <div className="mt-2 border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Vendas desta cliente: {brl(total)}</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {sales.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-card/60 px-3 py-1.5">
                  <span className="truncate">
                    {new Date(s.sold_at).toLocaleDateString('pt-BR')} · {s.description || (s.source === 'funil' ? 'Funil (Ganho)' : 'Venda')}
                  </span>
                  <span className="flex items-center gap-2">
                    <b className="tabular-nums">{brl(Number(s.value))}</b>
                    {s.source !== 'funil' && (
                      <button type="button" onClick={() => remove(s)} className="text-muted-foreground hover:text-red-400" aria-label="Apagar venda">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RegisterSaleDialog;
