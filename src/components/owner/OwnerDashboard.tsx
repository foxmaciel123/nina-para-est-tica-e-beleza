import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, CirclePause, MessageSquare, Bot, Loader2, Search, ChevronRight, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { OwnerEyebrow, StatusChip, WhatsAppChip, formatNumber, formatRelative } from './ownerUi';

type ClinicRow = Database['public']['Functions']['owner_organizations_overview']['Returns'][number];

const OwnerDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [clinics, setClinics] = useState<ClinicRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('owner_organizations_overview');
    if (rpcError) {
      console.error('[OwnerDashboard]', rpcError);
      setError('Não foi possível carregar as clínicas. Atualize a página para tentar de novo.');
    } else {
      setClinics(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => ({
    active: clinics.filter((c) => c.status === 'active').length,
    suspended: clinics.filter((c) => c.status === 'suspended').length,
    conversations: clinics.reduce((sum, c) => sum + Number(c.conversations_30d), 0),
    aiMessages: clinics.reduce((sum, c) => sum + Number(c.ai_messages_30d), 0),
  }), [clinics]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clinics;
    return clinics.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.admin_email ?? '').toLowerCase().includes(q)
    );
  }, [clinics, query]);

  const kpis = [
    { label: 'Clínicas ativas', value: totals.active, icon: Building2 },
    { label: 'Suspensas', value: totals.suspended, icon: CirclePause },
    { label: 'Conversas · 30 dias', value: totals.conversations, icon: MessageSquare },
    { label: 'Respostas da IA · 30 dias', value: totals.aiMessages, icon: Bot },
  ];

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background p-6 text-foreground custom-scrollbar" data-testid="owner-dashboard">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <OwnerEyebrow>Painel do Dono</OwnerEyebrow>
          <h2 className="text-3xl font-bold tracking-tight">Clínicas</h2>
          <p className="text-muted-foreground">Todas as clínicas que usam a Nina, com o uso dos últimos 30 dias.</p>
        </header>

        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <Button variant="outline" size="sm" onClick={load}>Tentar de novo</Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
                <span>{kpi.label}</span>
                <kpi.icon className="h-4 w-4 text-accent" />
              </div>
              <div className="mt-3 text-3xl font-bold tracking-tight tabular-nums">{formatNumber(kpi.value)}</div>
            </div>
          ))}
        </div>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-lg font-semibold">Lista de clínicas</h3>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="owner-clinic-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nome ou e-mail"
                className="pl-9"
                aria-label="Buscar clínica"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Clínica</th>
                  <th className="px-4 py-3 font-semibold">Situação</th>
                  <th className="px-4 py-3 font-semibold">WhatsApp</th>
                  <th className="px-4 py-3 text-right font-semibold">Clientes</th>
                  <th className="px-4 py-3 text-right font-semibold">Conversas</th>
                  <th className="px-4 py-3 text-right font-semibold">Respostas IA</th>
                  <th className="px-4 py-3 text-right font-semibold">Agendamentos</th>
                  <th className="px-4 py-3 font-semibold">Última atividade</th>
                  <th className="px-4 py-3"><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((clinic) => (
                  <tr
                    key={clinic.id}
                    onClick={() => navigate(`/dono/clinicas/${clinic.id}`)}
                    className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">{clinic.name}</div>
                      <div className="text-xs text-muted-foreground">{clinic.admin_email ?? 'sem administrador'}</div>
                    </td>
                    <td className="px-4 py-3"><StatusChip status={clinic.status} /></td>
                    <td className="px-4 py-3"><WhatsAppChip connected={clinic.whatsapp_connected} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(clinic.contacts)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(clinic.conversations_30d)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(clinic.ai_messages_30d)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(clinic.appointments_30d)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatRelative(clinic.last_activity_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/dono/clinicas/${clinic.id}`); }}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        Abrir <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                      {clinics.length === 0 ? 'Nenhuma clínica cadastrada ainda.' : 'Nenhuma clínica encontrada para essa busca.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Conversas, respostas da IA e agendamentos contam os últimos 30 dias.</p>
        </section>
      </div>
    </div>
  );
};

export default OwnerDashboard;
