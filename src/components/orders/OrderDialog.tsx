import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '../Button';
import type { Niche } from '@/niches/registry';
import { brl, itemsSubtotal, type Order, type OrderItem } from './orderTypes';

interface CatalogItem { id: string; name: string; price_min: number | null; price_max: number | null }

interface OrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  niche: Niche;
  order: Order | null;
  onSaved: () => void;
}

const input =
  'flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50';

/** Criar ou editar um pedido à mão (a IA cria sozinha pelo WhatsApp). */
const OrderDialog: React.FC<OrderDialogProps> = ({ open, onOpenChange, niche, order, onSaved }) => {
  const t = niche.terms;
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<Order['delivery_method']>('entrega');
  const [address, setAddress] = useState('');
  const [payment, setPayment] = useState('');
  const [fee, setFee] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [pick, setPick] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await (supabase as any)
        .from('procedures')
        .select('id, name, price_min, price_max')
        .eq('is_active', true)
        .order('name')
        .limit(500);
      setCatalog((data as CatalogItem[]) ?? []);
    })();
    setItems(order?.items?.map((i) => ({ ...i })) ?? []);
    setCustomerName(order?.customer_name ?? '');
    setCustomerPhone(order?.customer_phone ?? '');
    setDeliveryMethod(order?.delivery_method ?? 'entrega');
    setAddress(order?.delivery_address ?? '');
    setPayment(order?.payment_method ?? '');
    setFee(Number(order?.delivery_fee ?? 0));
    setDiscount(Number(order?.discount ?? 0));
    setNotes(order?.notes ?? '');
    setPick('');
  }, [open, order]);

  const subtotal = useMemo(() => itemsSubtotal(items), [items]);
  const total = Math.max(subtotal + (Number(fee) || 0) - (Number(discount) || 0), 0);

  const addFromCatalog = (id: string) => {
    const c = catalog.find((x) => x.id === id);
    if (!c) return;
    setItems((prev) => {
      const existing = prev.findIndex((i) => i.procedure_id === c.id);
      if (existing >= 0) {
        return prev.map((i, idx) => (idx === existing ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { procedure_id: c.id, name: c.name, quantity: 1, unit_price: Number(c.price_min ?? c.price_max ?? 0) }];
    });
    setPick('');
  };

  const update = (idx: number, patch: Partial<OrderItem>) =>
    setItems((prev) => prev.map((i, n) => (n === idx ? { ...i, ...patch } : i)));

  const save = async () => {
    const clean = items
      .filter((i) => i.name.trim())
      .map((i) => ({
        procedure_id: i.procedure_id ?? null,
        name: i.name.trim(),
        quantity: Math.max(1, Number(i.quantity) || 1),
        unit_price: Math.max(0, Number(i.unit_price) || 0),
        notes: i.notes?.trim() || null,
      }));
    if (clean.length === 0) {
      toast.error(`Adicione pelo menos um ${t.item}`);
      return;
    }
    setSaving(true);
    const payload = {
      items: clean,
      customer_name: customerName.trim() || null,
      customer_phone: customerPhone.trim() || null,
      delivery_method: deliveryMethod,
      delivery_address: address.trim() || null,
      payment_method: payment.trim() || null,
      delivery_fee: Math.max(0, Number(fee) || 0),
      discount: Math.max(0, Number(discount) || 0),
      notes: notes.trim() || null,
    };
    const { error } = order
      ? await (supabase as any).from('orders').update(payload).eq('id', order.id)
      : await (supabase as any).from('orders').insert({ ...payload, source: 'manual' });
    setSaving(false);
    if (error) {
      toast.error('Não foi possível salvar o pedido: ' + error.message);
      return;
    }
    toast.success(order ? `Pedido #${order.number} atualizado` : 'Pedido criado');
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{order ? `Editar pedido #${order.number}` : 'Novo pedido'}</DialogTitle>
          <DialogDescription>
            O total é calculado sozinho pelos preços de {t.catalogo.toLowerCase()}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Nome do {t.cliente}</label>
              <input className={input} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Ex: Maria" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">WhatsApp</label>
              <input className={input} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="(11) 99999-9999" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t.itens.charAt(0).toUpperCase() + t.itens.slice(1)}</label>
            <select
              className={input}
              value={pick}
              onChange={(e) => addFromCatalog(e.target.value)}
              data-testid="order-add-item"
            >
              <option value="">+ Adicionar de {t.catalogo.toLowerCase()}…</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.price_min != null ? ` · ${brl(c.price_min)}` : ''}
                </option>
              ))}
            </select>
            {items.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nada no pedido ainda. {catalog.length === 0 && `Cadastre ${t.itens} em Configurações › ${t.catalogo} ou adicione à mão.`}
              </p>
            )}
            <div className="space-y-2">
              {items.map((i, idx) => (
                <div key={idx} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-border bg-card/60 p-2">
                  <input
                    className={`${input} col-span-12 sm:col-span-5`}
                    value={i.name}
                    onChange={(e) => update(idx, { name: e.target.value, procedure_id: null })}
                    placeholder="Item"
                  />
                  <input
                    className={`${input} col-span-3 sm:col-span-2`}
                    type="number"
                    min={1}
                    value={i.quantity}
                    onChange={(e) => update(idx, { quantity: parseInt(e.target.value) || 1 })}
                    aria-label="Quantidade"
                  />
                  <input
                    className={`${input} col-span-5 sm:col-span-2`}
                    type="number"
                    step="0.01"
                    min={0}
                    value={i.unit_price}
                    onChange={(e) => update(idx, { unit_price: parseFloat(e.target.value) || 0 })}
                    aria-label="Preço unitário"
                  />
                  <span className="col-span-3 text-right text-sm font-medium sm:col-span-2">{brl(i.quantity * i.unit_price)}</span>
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, n) => n !== idx))}
                    className="col-span-1 flex justify-center text-muted-foreground hover:text-destructive"
                    aria-label="Remover item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <input
                    className={`${input} col-span-12 h-8 text-xs`}
                    value={i.notes ?? ''}
                    onChange={(e) => update(idx, { notes: e.target.value })}
                    placeholder="Observação (tamanho, cor, sabor, sem cebola...)"
                  />
                </div>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setItems((prev) => [...prev, { name: '', quantity: 1, unit_price: 0 }])}
            >
              <Plus className="mr-1 h-4 w-4" /> Item fora do catálogo
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Entrega</label>
              <select className={input} value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value as Order['delivery_method'])}>
                <option value="entrega">Entrega</option>
                <option value="retirada">Retirada no local</option>
                <option value="envio">Envio (correios/transportadora)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Pagamento</label>
              <input className={input} value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="Pix, cartão, dinheiro..." />
            </div>
          </div>
          {deliveryMethod !== 'retirada' && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Endereço</label>
              <input className={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, bairro, cidade" />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Taxa de entrega (R$)</label>
              <input className={input} type="number" step="0.01" min={0} value={fee} onChange={(e) => setFee(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Desconto (R$)</label>
              <input className={input} type="number" step="0.01" min={0} value={discount} onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Observação</label>
            <textarea
              className={`${input} h-auto resize-none`}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-secondary/50 p-3">
            <span className="text-sm text-muted-foreground">Subtotal {brl(subtotal)} + entrega {brl(fee)} − desconto {brl(discount)}</span>
            <span className="text-lg font-bold" data-testid="order-total">{brl(total)}</span>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : order ? 'Salvar' : 'Criar pedido'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OrderDialog;
