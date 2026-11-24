import React, { useEffect, useState } from 'react';
import { Loader2, RotateCcw, Store, ImagePlus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { getNiche, type NicheId } from '@/niches/registry';
import { defaultPromptForNiche, isFactoryPrompt } from '@/niches/prompt';
import { applyBusinessNiche, saveCompanyLogo, undoBusinessNiche } from '@/niches/actions';
import NichePicker from '@/components/niche/NichePicker';
import LogoUpload from '@/components/niche/LogoUpload';
import { Button } from '../Button';
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

/**
 * Aba "Seu negócio": tipo de negócio (nicho) e logo da empresa.
 * Trocar o nicho renomeia funil/etiquetas/equipe e pode trocar o prompt;
 * nada é apagado e a última troca pode ser desfeita.
 */
const BusinessSettings: React.FC = () => {
  const { businessNiche, logoUrl, canUndoNiche, previousNiche, isAdmin, refetch } = useCompanySettings();
  const current = getNiche(businessNiche);
  const [selected, setSelected] = useState<NicheId>(current.id);
  const [swapPrompt, setSwapPrompt] = useState(true);
  const [promptIsFactory, setPromptIsFactory] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logo, setLogo] = useState<string | null>(logoUrl);

  useEffect(() => setSelected(current.id), [current.id]);
  useEffect(() => setLogo(logoUrl), [logoUrl]);

  // Prompt de fábrica pode ser trocado sem medo; prompt personalizado só se marcar
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const { data } = await supabase.from('nina_settings').select('system_prompt_override').limit(1).maybeSingle();
      const factory = isFactoryPrompt((data as any)?.system_prompt_override);
      setPromptIsFactory(factory);
      setSwapPrompt(factory);
    })();
  }, [isAdmin, businessNiche]);

  const next = getNiche(selected);
  const changed = next.id !== current.id;

  const handleApply = async () => {
    setBusy(true);
    const res = await applyBusinessNiche(next.id, swapPrompt ? defaultPromptForNiche(next.id) : null);
    setBusy(false);
    setConfirmOpen(false);
    if (res.ok) {
      toast.success(`Pronto! Agora o sistema está como ${next.label}.`);
      await refetch();
    } else if (res.missingBackend) {
      toast.error('O servidor ainda não tem a troca de nicho. Peça para a agência atualizar.');
    } else {
      toast.error('Não foi possível trocar: ' + res.error);
    }
  };

  const handleUndo = async () => {
    setBusy(true);
    const res = await undoBusinessNiche();
    setBusy(false);
    if (res.ok) {
      toast.success('Troca desfeita. Tudo voltou como estava.');
      await refetch();
    } else {
      toast.error('Não foi possível desfazer: ' + res.error);
    }
  };

  const handleLogo = async (url: string | null) => {
    setLogo(url);
    const res = await saveCompanyLogo(url);
    if (res.ok) {
      toast.success(url ? 'Logo salvo' : 'Logo removido');
      await refetch();
    } else {
      toast.error(res.missingBackend ? 'O servidor ainda não aceita logo. Peça para a agência atualizar.' : 'Não foi possível salvar o logo: ' + res.error);
    }
  };

  return (
    <div className="space-y-8" data-testid="business-settings">
      <section className="rounded-2xl border border-border bg-card/60 p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Store className="w-5 h-5 text-primary" />
              Tipo de negócio
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Hoje: <span className="font-medium text-foreground" data-testid="current-niche">{current.emoji} {current.label}</span>.
              Muda o funil, as etiquetas, a equipe, os nomes da tela e o jeito da assistente atender.
            </p>
          </div>
          {isAdmin && canUndoNiche && (
            <Button variant="ghost" onClick={handleUndo} disabled={busy} className="gap-2" data-testid="undo-niche">
              <RotateCcw className="w-4 h-4" />
              Desfazer troca{previousNiche ? ` (voltar para ${getNiche(previousNiche).label})` : ''}
            </Button>
          )}
        </div>

        <NichePicker value={selected} onChange={setSelected} disabled={!isAdmin || busy} />

        {isAdmin && changed && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary"
                checked={swapPrompt}
                onChange={(e) => setSwapPrompt(e.target.checked)}
                data-testid="swap-prompt"
              />
              Trocar também o texto da assistente (prompt) para o padrão de {next.label}
              {!promptIsFactory && <span className="text-amber-500">(o seu foi personalizado)</span>}
            </label>
            <Button onClick={() => setConfirmOpen(true)} disabled={busy} className="gap-2" data-testid="apply-niche">
              <Check className="w-4 h-4" />
              Trocar para {next.label}
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card/60 p-6 space-y-4">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <ImagePlus className="w-5 h-5 text-primary" />
          Logo da empresa
        </h3>
        <LogoUpload value={logo} onChange={handleLogo} disabled={!isAdmin} />
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar para {next.emoji} {next.label}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>O que muda:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Etapas do funil passam a ser: {next.stages.map((s) => s.title).join(', ')}.</li>
                  <li>Etiquetas e equipes ganham os nomes de {next.label}.</li>
                  <li>Menu e telas passam a falar em {next.terms.clientes}, {next.terms.catalogo.toLowerCase()}{next.features.pedidos ? ' e pedidos' : ''}.</li>
                  {swapPrompt && <li>A assistente passa a usar o texto padrão de {next.label}.</li>}
                </ul>
                <p>Nada é apagado: conversas, contatos e cards continuam onde estão. Se não gostar, use “Desfazer troca”.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleApply(); }} disabled={busy} data-testid="confirm-niche">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Trocar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BusinessSettings;
