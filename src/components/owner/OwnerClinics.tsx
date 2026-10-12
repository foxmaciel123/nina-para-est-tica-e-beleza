import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import NewClinicDialog from './NewClinicDialog';
import {
  BillingChip, ErrorNote, PageHeader, PageLoader, StatusChip, WhatsAppChip,
  formatBRL, formatDay, formatNumber, formatRelative,
} from './ownerUi';
import { usePanel } from './panelScope';

type ClinicRow = Database['public']['Functions']['owner_organizations_overview']['Returns'][number] & {
  agency_id?: string | null;
  agency_name?: string | null;
};

const OwnerClinics: React.FC = () => {
  const navigate = useNavigate();
  const panel = usePanel();
  const isOwner = panel.kind === 'owner';
  const [clinics, setClinics] = useState<ClinicRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  // Só a primeira carga troca a tela pelo "carregando": recarregar depois de criar
  // uma clínica não pode desmontar a janela que mostra o link de acesso.
  const load = async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('owner_organizations_overview');
    if (rpcError) {
      console.error('[OwnerClinics]', rpcError);
      setError('Não foi possível carregar as clínicas.');
    } else {
      setClinics((data ?? []) as ClinicRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clinics;
    return clinics.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.admin_email ?? '').toLowerCase().includes(q) || (c.agency_name ?? '').toLowerCase().includes(q));
  }, [clinics, query]);

  if (loading) return <PageLoader />;

  const open = (id: string) => navigate(`${panel.base}/clinicas/${id}`);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6" data-testid="owner-clinics">
      <PageHeader
        eyebrow={`${panel.title} · Visão`}
        title="Clínicas"
        description={isOwner
          ? 'Todas as clínicas (suas e das agências), com mensalidade e uso dos últimos 30 dias.'
          : 'As clínicas da agência, com mensalidade e uso dos últimos 30 dias.'}
        actions={
          <>
          <Button onClick={() => setCreating(true)} className="gap-2" data-testid="new-clinic-button">
            <Plus className="h-4 w-4" /> Nova clínica
          </Button>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="owner-clinic-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isOwner ? 'Buscar por nome, e-mail ou agência' : 'Buscar por nome ou e-mail'}
              className="pl-9"
              aria-label="Buscar clínica"
            />
          </div>
          </>
        }
      />

      <NewClinicDialog open={creating} onClose={() => setCreating(false)} onCreated={load} />

      {error && <ErrorNote message={error} onRetry={load} />}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
        <table className="w-full min-w-[1040px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Clínica</th>
              {isOwner && <th className="px-4 py-3 font-semibold">Agência</th>}
              <th className="px-4 py-3 font-semibold">Acesso</th>
              <th className="px-4 py-3 font-semibold">Mensalidade</th>
              <th className="px-4 py-3 font-semibold">Pagamento</th>
              <th className="px-4 py-3 font-semibold">WhatsApp</th>
              <th className="px-4 py-3 text-right font-semibold">Conversas</th>
              <th className="px-4 py-3 text-right font-semibold">Respostas IA</th>
              <th className="px-4 py-3 text-right font-semibold">Agendamentos</th>
              <th className="px-4 py-3 font-semibold">Última atividade</th>
              <th className="px-4 py-3"><span className="sr-only">Abrir</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => open(c.id)} className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3">
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.admin_email ?? 'sem administrador'}</div>
                </td>
                {isOwner && <td className="px-4 py-3 text-muted-foreground">{c.agency_name ?? 'Direta'}</td>}
                <td className="px-4 py-3"><StatusChip status={c.status} /></td>
                <td className="px-4 py-3 tabular-nums">{Number(c.monthly_fee) > 0 ? formatBRL(c.monthly_fee) : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <BillingChip state={c.billing_state} />
                    {c.next_due_date && <span className="text-xs text-muted-foreground">vence {formatDay(c.next_due_date)}</span>}
                  </div>
                </td>
                <td className="px-4 py-3"><WhatsAppChip connected={c.whatsapp_connected} /></td>
                <td className="px-4 py-3 text-right tabular-nums">{formatNumber(c.conversations_30d)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatNumber(c.ai_messages_30d)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatNumber(c.appointments_30d)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatRelative(c.last_activity_at)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); open(c.id); }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Abrir <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={isOwner ? 11 : 10} className="px-4 py-10 text-center text-muted-foreground">
                  {clinics.length === 0 ? 'Nenhuma clínica cadastrada ainda.' : 'Nenhuma clínica encontrada para essa busca.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OwnerClinics;
