import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertTriangle, CirclePause, CirclePlay } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Chip, OwnerEyebrow, StatusChip, WhatsAppChip, formatDate, formatNumber, formatRelative } from './ownerUi';

interface ClinicDetail {
  organization: { id: string; name: string; status: string; created_at: string };
  members: { email: string; role: string; full_name: string | null; joined_at: string; last_sign_in_at: string | null }[];
  settings: {
    company_name: string | null;
    assistant_name: string | null;
    is_active: boolean;
    whatsapp_connected: boolean;
    custom_prompt: boolean;
    ai_model_mode: string | null;
    business_hours: string | null;
  } | null;
  usage_30d: {
    contacts_total: number;
    new_contacts: number;
    conversations: number;
    messages_received: number;
    ai_messages: number;
    appointments: number;
  };
  daily_ai_messages: { day: string; count: number }[];
}

const Card: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className = '' }) => (
  <section className={`flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm ${className}`}>
    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
    {children}
  </section>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium">{children}</span>
  </div>
);

const OwnerClinicDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ClinicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('owner_organization_detail', { p_org: id });
    if (rpcError) {
      console.error('[OwnerClinicDetail]', rpcError);
      setError(rpcError.code === 'P0002' ? 'Clínica não encontrada.' : 'Não foi possível carregar esta clínica.');
    } else {
      setDetail(data as unknown as ClinicDetail);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [id]);

  const isSuspended = detail?.organization.status === 'suspended';

  const toggleStatus = async () => {
    if (!detail) return;
    setSaving(true);
    const nextStatus = isSuspended ? 'active' : 'suspended';
    const { error: rpcError } = await supabase.rpc('owner_set_organization_status', {
      p_org: detail.organization.id,
      p_status: nextStatus,
    });
    setSaving(false);
    setConfirmOpen(false);
    if (rpcError) {
      console.error('[OwnerClinicDetail] status', rpcError);
      toast.error('Não foi possível alterar a situação da clínica. Tente de novo.');
      return;
    }
    toast.success(nextStatus === 'suspended' ? 'Clínica suspensa' : 'Clínica reativada');
    load();
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-muted-foreground">{error ?? 'Clínica não encontrada.'}</p>
        <Link to="/dono" className="text-sm font-semibold text-accent hover:underline">Voltar para as clínicas</Link>
      </div>
    );
  }

  const { organization, members, settings, usage_30d: usage, daily_ai_messages: daily } = detail;
  const chartData = daily.map((d) => ({
    label: new Date(`${d.day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    count: d.count,
  }));

  const usageItems = [
    { label: 'Clientes no total', value: usage.contacts_total },
    { label: 'Novas clientes', value: usage.new_contacts },
    { label: 'Conversas', value: usage.conversations },
    { label: 'Mensagens recebidas', value: usage.messages_received },
    { label: 'Respostas da IA', value: usage.ai_messages },
    { label: 'Agendamentos', value: usage.appointments },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background p-6 text-foreground custom-scrollbar" data-testid="owner-clinic-detail">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <Link to="/dono" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Clínicas
        </Link>

        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <OwnerEyebrow>Painel do Dono · Clínica</OwnerEyebrow>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-bold tracking-tight">{organization.name}</h2>
              <StatusChip status={organization.status} />
            </div>
            <p className="text-sm text-muted-foreground">Cliente desde {formatDate(organization.created_at)}</p>
          </div>
          <Button
            variant={isSuspended ? 'default' : 'destructive'}
            onClick={() => setConfirmOpen(true)}
            className="gap-2"
          >
            {isSuspended ? <CirclePlay className="h-4 w-4" /> : <CirclePause className="h-4 w-4" />}
            {isSuspended ? 'Reativar clínica' : 'Suspender clínica'}
          </Button>
        </header>

        {isSuspended && (
          <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
            <CirclePause className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <p>A equipe desta clínica está sem acesso ao painel e a Nina não responde nem envia mensagens. As mensagens que chegam continuam guardadas.</p>
          </div>
        )}

        <Card title="Uso nos últimos 30 dias">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {usageItems.map((item) => (
              <div key={item.label} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <span className="text-2xl font-bold tabular-nums">{formatNumber(item.value)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Respostas da IA por dia">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval={4} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                  formatter={(value: number) => [formatNumber(value), 'Respostas']}
                />
                <Bar dataKey="count" fill="hsl(var(--accent))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Configuração da Nina">
            {settings ? (
              <div className="flex flex-col">
                <Row label="Nome usado nas conversas">{settings.company_name ?? '—'}</Row>
                <Row label="Assistente">{settings.assistant_name ?? 'Nina'}</Row>
                <Row label="WhatsApp"><WhatsAppChip connected={settings.whatsapp_connected} /></Row>
                <Row label="Nina">{settings.is_active ? <Chip tone="ok">Ligada</Chip> : <Chip tone="neutral">Desligada</Chip>}</Row>
                <Row label="Prompt">{settings.custom_prompt ? 'Personalizado' : 'Padrão de estética'}</Row>
                <Row label="Horário de atendimento">{settings.business_hours ?? '—'}</Row>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">A clínica ainda não fez o primeiro acesso, então a Nina não foi configurada.</p>
            )}
          </Card>

          <Card title={`Equipe · ${members.length}`}>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum usuário vinculado a esta clínica.</p>
            ) : (
              <ul className="flex flex-col">
                {members.map((m) => (
                  <li key={m.email} className="flex items-center justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.full_name || m.email}</div>
                      <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      <Chip tone={m.role === 'admin' ? 'ok' : 'neutral'}>{m.role === 'admin' ? 'Admin' : 'Equipe'}</Chip>
                      <span className="text-xs text-muted-foreground">
                        {m.last_sign_in_at ? `último acesso ${formatRelative(m.last_sign_in_at)}` : 'nunca acessou'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isSuspended ? `Reativar ${organization.name}?` : `Suspender ${organization.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {isSuspended
                ? 'A equipe volta a acessar o painel e a Nina volta a responder no WhatsApp da clínica.'
                : 'A equipe perde o acesso ao painel e a Nina para de responder e de enviar lembretes. As mensagens que chegarem continuam guardadas e aparecem quando você reativar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); toggleStatus(); }}
              disabled={saving}
              className={isSuspended ? '' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSuspended ? 'Reativar' : 'Suspender'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default OwnerClinicDetail;
