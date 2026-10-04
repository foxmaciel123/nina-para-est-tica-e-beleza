import React from 'react';
import { Chip, PageHeader, Panel } from '../ownerUi';
import { useClinic } from './OwnerClinicLayout';

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const MODEL_LABEL: Record<string, string> = {
  flash: 'Rápido (Gemini Flash)',
  pro: 'Avançado (Gemini Pro)',
  pro3: 'Avançado (Gemini Pro)',
  adaptive: 'Adaptativo',
};

const OnOff: React.FC<{ on: boolean; onLabel?: string; offLabel?: string }> = ({ on, onLabel = 'Ligado', offLabel = 'Desligado' }) =>
  on ? <Chip tone="ok">{onLabel}</Chip> : <Chip tone="neutral">{offLabel}</Chip>;

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5 text-sm last:border-0">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium">{children}</span>
  </div>
);

const ClinicAgent: React.FC = () => {
  const { detail } = useClinic();
  const s = detail.settings;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6" data-testid="clinic-agent">
      <PageHeader eyebrow="Clínica · Agente IA" title="Agente IA" description="Como a Nina está configurada nesta clínica." />

      {!s ? (
        <Panel>
          <p className="text-sm text-muted-foreground">A clínica ainda não fez o primeiro acesso, então a Nina não foi configurada.</p>
        </Panel>
      ) : (
        <>
          <Panel title="Assistente">
            <Row label="Nome da assistente">{s.assistant_name ?? 'Nina'}</Row>
            <Row label="Nome usado nas conversas">{s.company_name ?? '—'}</Row>
            <Row label="Nina"><OnOff on={s.is_active} onLabel="Ligada" offLabel="Desligada" /></Row>
            <Row label="Resposta automática"><OnOff on={s.auto_response_enabled} /></Row>
            <Row label="Modelo">{MODEL_LABEL[s.ai_model_mode ?? ''] ?? s.ai_model_mode ?? '—'}</Row>
            <Row label="Agenda pela IA"><OnOff on={s.ai_scheduling_enabled} /></Row>
            <Row label="Respostas em áudio"><OnOff on={s.audio_response_enabled} /></Row>
          </Panel>

          <Panel title="Horário de atendimento">
            <Row label="Horário">{s.business_hours ?? '—'}</Row>
            <Row label="Dias">
              {s.business_days && s.business_days.length > 0
                ? [...s.business_days].sort().map((d) => DAY_LABELS[d] ?? d).join(', ')
                : '—'}
            </Row>
          </Panel>

          <Panel title="Prompt">
            {s.custom_prompt ? (
              <>
                <p className="text-sm text-muted-foreground">A clínica personalizou o prompt. Início do texto:</p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-4 text-xs leading-relaxed">{s.prompt_preview}</pre>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Usa o prompt padrão de estética da Nina.</p>
            )}
          </Panel>

          <p className="text-xs text-muted-foreground">Para alterar, a clínica usa o painel dela em Configurações → Agente.</p>
        </>
      )}
    </div>
  );
};

export default ClinicAgent;
