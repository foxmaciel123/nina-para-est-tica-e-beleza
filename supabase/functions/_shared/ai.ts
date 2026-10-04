// Provedor de IA da Nina.
//
// Fora do Lovable usamos a API do Google Gemini direto, pelo endpoint
// compatível com OpenAI (mesmo formato de request/response que o gateway
// do Lovable usava, incluindo tools/tool_calls).
//
// Secrets:
//   GEMINI_API_KEY   — chave do Google AI Studio (obrigatória)
//   AI_MODEL_FAST    — opcional, padrão gemini-2.5-flash
//   AI_MODEL_PRO     — opcional, padrão gemini-2.5-pro

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const AI_CHAT_URL = `${GEMINI_BASE}/openai/chat/completions`;

export function getAiApiKey(): string | undefined {
  return Deno.env.get('GEMINI_API_KEY') || undefined;
}

// O código e o banco guardam nomes no formato do gateway Lovable
// ("google/gemini-2.5-flash"). Converte para o nome que a API do Gemini aceita.
export function resolveModel(model: string | null | undefined): string {
  const fast = Deno.env.get('AI_MODEL_FAST') || 'gemini-2.5-flash';
  const pro = Deno.env.get('AI_MODEL_PRO') || 'gemini-2.5-pro';
  const name = (model || '').replace(/^google\//, '');
  if (!name) return fast;
  if (name.includes('pro')) return pro;
  if (name.includes('flash')) return fast;
  return name;
}

// Registra tokens usados por clínica (tela Consumo de IA do Painel do Dono).
// Aceita o `usage` do endpoint OpenAI-compatível ou o `usageMetadata` nativo.
// Nunca derruba a resposta da Nina se o registro falhar.
export async function logAiUsage(
  supabase: any,
  orgId: string | null | undefined,
  kind: 'chat' | 'analysis' | 'prompt' | 'transcription',
  model: string,
  usage: any,
): Promise<void> {
  if (!orgId || !usage) return;
  const promptTokens = Number(usage.prompt_tokens ?? usage.promptTokenCount ?? 0);
  const total = Number(usage.total_tokens ?? usage.totalTokenCount ?? 0);
  // total - prompt inclui tokens de raciocínio (cobrados como saída no Gemini 2.5)
  const completionTokens = total > promptTokens
    ? total - promptTokens
    : Number(usage.completion_tokens ?? usage.candidatesTokenCount ?? 0);
  try {
    await supabase.from('ai_usage_events').insert({
      organization_id: orgId,
      kind,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
    });
  } catch (err) {
    console.warn('[ai] Falha ao registrar consumo de IA:', err);
  }
}

// Transcreve áudio (ogg/opus do WhatsApp) com o Gemini nativo.
export async function transcribeAudioWithGemini(
  audioBuffer: ArrayBuffer,
  mimeType = 'audio/ogg',
  onUsage?: (model: string, usage: any) => void,
): Promise<string | null> {
  const apiKey = getAiApiKey();
  if (!apiKey) return null;

  const bytes = new Uint8Array(audioBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const base64 = btoa(binary);

  const model = resolveModel('flash');
  const response = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: 'Transcreva este áudio em português do Brasil. Responda apenas com a transcrição literal, sem comentários.' },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      }],
      generationConfig: { temperature: 0 },
    }),
  });

  if (!response.ok) {
    console.error('[ai] Gemini transcription error:', response.status, await response.text());
    return null;
  }

  const data = await response.json();
  onUsage?.(model, data.usageMetadata);
  const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('').trim();
  return text || null;
}
