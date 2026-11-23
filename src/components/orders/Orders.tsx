import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, ChevronRight, Edit2, Loader2, MapPin, Phone, Plus, Search, ShoppingBag, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '../Button';
import { useNiche } from '@/hooks/useNiche';
import OrderDialog from './OrderDialog';
import {
  DELIVERY_LABELS, NEXT_STATUS, OPEN_STATUSES, STATUS_COLORS, brl, customerOf, statusLabels,
  type Order, type OrderStatus,
} from './orderTypes';

type Filter = 'abertos' | 'entregue' | 'cancelado' | 'todos';

const timeAgo = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

/** Fase 2 do multi-nicho: pedidos (delivery, moda, atacado, cosméticos...). */
const Orders: React.FC = () => {
  const niche = useNiche();
  const labels = statusLabels(niche);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [filter, setFilter] = useState<Filter>('abertos');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Order | null>(null);
  const [editing, setEditing] = useState<Order | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from('orders')
      .select('*, contact:contacts(name, call_name, phone_number)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) {
      // Servidor ainda sem a tabela de pedidos (migração não publicada)
      if (error.code === '42P01' || error.code === 'PGRST205' || String(error.message).includes('orders')) setMissingTable(true);
      else toast.error('Erro ao carregar pedidos');
    } else {
      setMissingTable(false);
      setOrders(Array.isArray(data) ? (data as Order[]) : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('orders-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe();
    const timer = setInterval(load, 60000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [load]);

  // Mantém o detalhe aberto atualizado quando o pedido muda
  useEffect(() => {
    if (selected) setSelected(orders.find((o) => o.id === selected.id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter === 'abertos' && !OPEN_STATUSES.includes(o.status)) return false;
      if (filter === 'entregue' && o.status !== 'entregue') return false;
      if (filter === 'cancelado' && o.status !== 'cancelado') return false;
      if (!q) return true;
      return (
        String(o.number).includes(q) ||
        customerOf(o).toLowerCase().includes(q) ||
        (o.customer_phone ?? o.contact?.phone_number ?? '').includes(q) ||
        o.items.some((i) => i.name.toLowerCase().includes(q))
      );
    });
  }, [orders, filter, search]);

  const today = new Date().toDateString();
  const todays = orders.filter((o) => new Date(o.created_at).toDateString() === today && o.status !== 'cancelado');
  const kpis = [
    { label: 'Pedidos hoje', value: String(todays.length) },
    { label: 'Vendido hoje', value: brl(todays.reduce((s, o) => s + Number(o.total || 0), 0)) },
    { label: 'Em aberto', value: String(orders.filter((o) => OPEN_STATUSES.includes(o.status)).length) },
    { label: 'Feitos pela IA hoje', value: String(todays.filter((o) => o.source === 'ia').length) },
  ];

  const setStatus = async (o: Order, status: OrderStatus) => {
    const { error } = await (supabase as any).from('orders').update({ status }).eq('id', o.id);
    if (error) return toast.error('Não foi possível mudar o pedido: ' + error.message);
    toast.success(`Pedido #${o.number}: ${labels[status]}`);
    load();
  };

  const columns: OrderStatus[] = filter === 'abertos' ? OPEN_STATUSES : [];

  const card = (o: Order) => (
    <button
      key={o.id}
      type="button"
      onClick={() => setSelected(o)}
      className="w-full space-y-2 rounded-xl border border-border bg-card/70 p-3 text-left transition-colors hover:border-primary/50 hover:bg-card"
      data-testid="order-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">#{o.number} · {customerOf(o)}</span>
        {o.source === 'ia' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Bot className="h-3 w-3" /> IA
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">
        {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ') || 'Sem itens'}
      </p>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">{brl(o.total)}</span>
        <span className="text-muted-foreground">{timeAgo(o.created_at)}</span>
      </div>
      {filter !== 'abertos' && (
        <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[o.status]}`}>
          {labels[o.status]}
        </span>
      )}
    </button>
  );

  return (
    <div className="relative h-full overflow-y-auto bg-background p-4 text-foreground sm:p-8 custom-scrollbar">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight" data-testid="orders-title">Pedidos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A assistente anota os pedidos no WhatsApp e eles aparecem aqui na hora.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }} disabled={missingTable} data-testid="new-order">
          <Plus className="mr-2 h-4 w-4" /> Novo pedido
        </Button>
      </div>

      {missingTable ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-600">
          A tela de pedidos está pronta, mas o servidor ainda não foi atualizado. Assim que a agência publicar, os pedidos aparecem aqui.
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-2xl border border-border bg-card/60 p-4">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="mt-1 text-2xl font-bold">{k.value}</p>
              </div>
            ))}
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {([['abertos', 'Em andamento'], ['entregue', 'Entregues'], ['cancelado', 'Cancelados'], ['todos', 'Todos']] as [Filter, string][]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    filter === id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nº, nome, telefone ou item"
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/40 p-10 text-center text-muted-foreground">
              <ShoppingBag className="h-10 w-10 text-primary/70" />
              <p>Nenhum pedido ainda. Quando um {niche.terms.cliente} fechar pelo WhatsApp, a assistente anota aqui.</p>
              <p className="text-xs">Dica: cadastre {niche.terms.itens} com preço em Configurações › {niche.terms.catalogo}.</p>
            </div>
          ) : columns.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {columns.map((status) => {
                const list = visible.filter((o) => o.status === status);
                return (
                  <div key={status} className="space-y-2 rounded-2xl border border-border bg-secondary/20 p-3" data-testid={`orders-col-${status}`}>
                    <div className="flex items-center justify-between px-1">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[status]}`}>{labels[status]}</span>
                      <span className="text-xs text-muted-foreground">{list.length}</span>
                    </div>
                    {list.length === 0 ? <p className="px-1 py-4 text-center text-xs text-muted-foreground">Vazio</p> : list.map(card)}
                  </div>
                );
              })}
            </div>
          ) : visible.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">Nada por aqui.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map(card)}</div>
          )}
        </>
      )}

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  Pedido #{selected.number}
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[selected.status]}`}>{labels[selected.status]}</span>
                </DialogTitle>
                <DialogDescription>
                  {new Date(selected.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  {selected.source === 'ia' ? ' · anotado pela assistente' : ' · criado no painel'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="space-y-1">
                  <p className="font-semibold">{customerOf(selected)}</p>
                  {(selected.customer_phone || selected.contact?.phone_number) && (
                    <p className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" /> {selected.customer_phone || selected.contact?.phone_number}</p>
                  )}
                  <p className="flex items-center gap-1 text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {DELIVERY_LABELS[selected.delivery_method]}{selected.delivery_address ? `: ${selected.delivery_address}` : ''}
                  </p>
                  {selected.payment_method && <p className="text-muted-foreground">Pagamento: {selected.payment_method}</p>}
                </div>
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {selected.items.map((i, idx) => (
                    <li key={idx} className="flex items-start justify-between gap-3 p-2">
                      <span>
                        {i.quantity}× {i.name}
                        {i.notes && <span className="block text-xs text-muted-foreground">{i.notes}</span>}
                        {i.price_to_confirm && <span className="block text-xs text-amber-500">preço a confirmar</span>}
                      </span>
                      <span className="whitespace-nowrap">{brl(i.quantity * i.unit_price)}</span>
                    </li>
                  ))}
                </ul>
                <div className="space-y-1 rounded-xl bg-secondary/50 p-3">
                  <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{brl(selected.subtotal)}</span></div>
                  {Number(selected.delivery_fee) > 0 && <div className="flex justify-between text-muted-foreground"><span>Entrega</span><span>{brl(selected.delivery_fee)}</span></div>}
                  {Number(selected.discount) > 0 && <div className="flex justify-between text-muted-foreground"><span>Desconto</span><span>− {brl(selected.discount)}</span></div>}
                  <div className="flex justify-between text-base font-bold"><span>Total</span><span>{brl(selected.total)}</span></div>
                </div>
                {selected.notes && <p className="text-muted-foreground">Obs.: {selected.notes}</p>}
                <div className="flex flex-wrap gap-2">
                  {NEXT_STATUS[selected.status] && (
                    <Button onClick={() => setStatus(selected, NEXT_STATUS[selected.status]!)} data-testid="order-next">
                      {labels[NEXT_STATUS[selected.status]!]} <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  )}
                  {OPEN_STATUSES.includes(selected.status) && (
                    <Button variant="outline" onClick={() => { setEditing(selected); setDialogOpen(true); }}>
                      <Edit2 className="mr-1 h-4 w-4" /> Editar
                    </Button>
                  )}
                  {selected.status !== 'cancelado' && selected.status !== 'entregue' && (
                    <Button
                      variant="ghost"
                      onClick={() => window.confirm(`Cancelar o pedido #${selected.number}?`) && setStatus(selected, 'cancelado')}
                    >
                      <X className="mr-1 h-4 w-4" /> Cancelar pedido
                    </Button>
                  )}
                  {(selected.status === 'cancelado' || selected.status === 'entregue') && (
                    <Button variant="ghost" onClick={() => setStatus(selected, 'novo')}>Reabrir</Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <OrderDialog open={dialogOpen} onOpenChange={setDialogOpen} niche={niche} order={editing} onSaved={load} />
    </div>
  );
};

export default Orders;
