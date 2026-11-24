import type { Niche } from '@/niches/registry';

export type OrderStatus = 'novo' | 'confirmado' | 'preparando' | 'enviado' | 'entregue' | 'cancelado';

export interface OrderItem {
  procedure_id?: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  notes?: string | null;
  price_to_confirm?: boolean;
}

export interface Order {
  id: string;
  number: number;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  delivery_fee: number;
  discount: number;
  total: number;
  delivery_method: 'entrega' | 'retirada' | 'envio';
  delivery_address: string | null;
  payment_method: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  source: 'manual' | 'ia';
  contact_id: string | null;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
  contact?: { name: string | null; call_name: string | null; phone_number: string } | null;
}

export const OPEN_STATUSES: OrderStatus[] = ['novo', 'confirmado', 'preparando', 'enviado'];
export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  novo: 'confirmado',
  confirmado: 'preparando',
  preparando: 'enviado',
  enviado: 'entregue',
};

/** Nome das etapas do pedido: comida "prepara e sai para entrega"; loja "separa e envia". */
export function statusLabels(niche: Niche): Record<OrderStatus, string> {
  const food = niche.group === 'Comida';
  return {
    novo: 'Novo',
    confirmado: 'Confirmado',
    preparando: food ? 'Preparando' : 'Separando',
    enviado: food ? 'Saiu para entrega' : 'Enviado',
    entregue: 'Entregue',
    cancelado: 'Cancelado',
  };
}

export const STATUS_COLORS: Record<OrderStatus, string> = {
  novo: 'border-sky-500/40 bg-sky-500/10 text-sky-500',
  confirmado: 'border-violet-500/40 bg-violet-500/10 text-violet-500',
  preparando: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  enviado: 'border-orange-500/40 bg-orange-500/10 text-orange-500',
  entregue: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
  cancelado: 'border-red-500/40 bg-red-500/10 text-red-500',
};

export const DELIVERY_LABELS: Record<Order['delivery_method'], string> = {
  entrega: 'Entrega',
  retirada: 'Retirada no local',
  envio: 'Envio (correios/transportadora)',
};

export const brl = (v: number | null | undefined) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const itemsSubtotal = (items: OrderItem[]) =>
  items.reduce((sum, i) => sum + Math.max(Number(i.quantity) || 0, 0) * Math.max(Number(i.unit_price) || 0, 0), 0);

export const customerOf = (o: Order) =>
  o.customer_name || o.contact?.name || o.contact?.call_name || o.customer_phone || o.contact?.phone_number || 'Cliente';
