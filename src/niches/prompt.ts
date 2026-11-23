// Prompt padrão de cada nicho na tela (o servidor faz igual no orchestrator).
import { DEFAULT_NINA_PROMPT } from '@/prompts/default-nina-prompt';
import { NICHES, buildNichePrompt, getNiche } from './registry';

export function defaultPromptForNiche(id: string | null | undefined): string {
  const niche = getNiche(id);
  return niche.id === 'estetica' ? DEFAULT_NINA_PROMPT : buildNichePrompt(niche);
}

/** O texto ainda é um prompt de fábrica (de qualquer nicho)? Então pode trocar sem perder nada. */
export function isFactoryPrompt(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return true;
  if (t === DEFAULT_NINA_PROMPT.trim()) return true;
  return NICHES.some((n) => n.id !== 'estetica' && buildNichePrompt(n).trim() === t);
}
