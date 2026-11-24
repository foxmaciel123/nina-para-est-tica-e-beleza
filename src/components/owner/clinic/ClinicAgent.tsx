import React, { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { defaultPromptForNiche } from '@/niches/prompt';
import { ErrorNote, PageHeader, PageLoader, Panel } from '../ownerUi';
import { rpcErrorMessage, useClinicConfig } from '../ownerApi';
import { useClinic } from './OwnerClinicLayout';

const MODELS = [
  { id: 'flash', label: 'Rápido', hint: 'Gemini Flash: respostas rápidas e econômicas' },
  { id: 'pro', label: 'Avançado', hint: 'Gemini Pro: respostas mais elaboradas, custo maior' },
  { id: 'pro3', label: 'Avançado+', hint: 'Modelo Pro mais recente' },
  { id: 'adaptive', label: 'Adaptativo', hint: 'Escolhe o modelo conforme a conversa' },
];

const TOGGLES = [
  { key: 'is_active', label: 'Assistente ligada', hint: 'Desligada, a assistente não responde nenhuma mensagem.' },
  { key: 'auto_response_enabled', label: 'Resposta automática', hint: 'A assistente responde sozinha às mensagens novas.' },
  { key: 'ai_scheduling_enabled', label: 'Agendar pela IA', hint: 'A assistente marca, remarca e cancela avaliações na agenda.' },
  { key: 'message_breaking_enabled', label: 'Quebrar mensagens longas', hint: 'Envia a resposta em partes, como uma pessoa digitando.' },
  { key: 'audio_response_enabled', label: 'Responder em áudio', hint: 'Exige a chave do ElevenLabs configurada pela empresa.' },
] as const;

type ToggleKey = typeof TOGGLES[number]['key'];

const ClinicAgent: React.FC = () => {
  const { detail, reload: reloadDetail } = useClinic();
  const orgId = detail.organization.id;
  const { config, loading, error, reload } = useClinicConfig(orgId);

  const [name, setName] = useState('Assistente');
  const [company, setCompany] = useState('');
  const [mode, setMode] = useState('flash');
  const [prompt, setPrompt] = useState('');
  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>({
    is_active: true, auto_response_enabled: true, ai_scheduling_enabled: true,
    message_breaking_enabled: true, audio_response_enabled: false,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Prompt padrão do tipo de negócio da empresa (estética se o servidor não informar)
  const DEFAULT_NINA_PROMPT = defaultPromptForNiche((config as { business_niche?: string } | null)?.business_niche);

  useEffect(() => {
    if (!config) return;
    setName(config.sdr_name ?? 'Assistente');
    setCompany(config.company_name ?? '');
    setMode(config.ai_model_mode ?? 'flash');
    setPrompt(config.system_prompt_override ?? '');
    setToggles({
      is_active: config.is_active,
      auto_response_enabled: config.auto_response_enabled,
      ai_scheduling_enabled: config.ai_scheduling_enabled,
      message_breaking_enabled: config.message_breaking_enabled,
      audio_response_enabled: config.audio_response_enabled,
    });
  }, [config]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setFormError('Informe o nome da assistente.');
    setFormError(null);
    setSaving(true);
    // Texto igual ao padrão é guardado como "padrão" para receber melhorias futuras
    const override = prompt.trim() === DEFAULT_NINA_PROMPT.trim() ? '' : prompt;
    const { error: rpcError } = await supabase.rpc('owner_update_clinic_agent', {
      p_org: orgId,
      p_settings: { sdr_name: name, company_name: company, ai_model_mode: mode, system_prompt_override: override, ...toggles },
    });
    setSaving(false);
    if (rpcError) {
      setFormError(rpcErrorMessage(rpcError, 'Não foi possível salvar. Tente de novo.'));
      return;
    }
    toast.success('Agente da empresa salvo');
    reload();
    reloadDetail();
  };

  if (loading) return <PageLoader />;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6" data-testid="clinic-agent">
      <PageHeader eyebrow="Empresa · Agente IA" title="Agente IA" description="Como a assistente atende nesta empresa. Você pode configurar por ela." />
      {error && <ErrorNote message={error} onRetry={reload} />}

      {!config ? (
        <Panel>
          <p className="text-sm text-muted-foreground">Esta empresa ainda não tem a configuração da assistente. Ela é criada no cadastro da empresa ou no primeiro acesso da dona.</p>
        </Panel>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-6" noValidate>
          <Panel title="Assistente">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="agent-name">Nome da assistente</Label>
                <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="agent-company">Nome da empresa nas conversas</Label>
                <Input id="agent-company" placeholder="Studio Bella Pele" value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col">
              {TOGGLES.map((t) => (
                <div key={t.key} className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-0">
                  <div>
                    <Label htmlFor={`agent-${t.key}`} className="text-sm font-medium">{t.label}</Label>
                    <p className="text-xs text-muted-foreground">{t.hint}</p>
                  </div>
                  <Switch
                    id={`agent-${t.key}`}
                    checked={toggles[t.key]}
                    onCheckedChange={(v) => setToggles((prev) => ({ ...prev, [t.key]: v }))}
                  />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Modelo de IA">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Modelo de IA">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  onClick={() => setMode(m.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${mode === m.id ? 'border-accent bg-accent/10 font-semibold' : 'border-border hover:bg-muted/50'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{MODELS.find((m) => m.id === mode)?.hint}</p>
          </Panel>

          <Panel
            title="Prompt"
            actions={
              <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setPrompt(DEFAULT_NINA_PROMPT)}>
                <RotateCcw className="h-3.5 w-3.5" /> Carregar prompt padrão
              </Button>
            }
          >
            <Textarea
              id="agent-prompt"
              rows={14}
              className="font-mono text-xs leading-relaxed"
              placeholder="Em branco, a assistente usa o prompt padrão de estética. Clique em “Carregar prompt padrão” para partir dele."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Variáveis disponíveis: {'{{ clinica_nome }}'}, {'{{ cliente_nome }}'}, {'{{ data_hora }}'}, {'{{ dia_semana }}'}. Apague todo o texto para voltar ao padrão.
            </p>
          </Panel>

          {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar agente
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ClinicAgent;
