// Cliente da Evolution API exclusiva da Nina (WhatsApp por QR code).
// Secrets: EVOLUTION_API_URL (rede interna), EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_URL.

export function evolutionConfigured(): boolean {
  return !!Deno.env.get('EVOLUTION_API_URL') && !!Deno.env.get('EVOLUTION_API_KEY');
}

export async function evo(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const base = (Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/$/, '');
  const resp = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      apikey: Deno.env.get('EVOLUTION_API_KEY') ?? '',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

// Só dígitos, com DDI (formato que a Evolution espera)
export const toNumber = (value: string) => value.replace(/\D/g, '');

// Envia uma mensagem da fila (send_queue) e devolve o id do WhatsApp
export async function evoSend(instance: string, recipient: string, item: {
  message_type: string; content: string | null; media_url: string | null;
}): Promise<string | null> {
  const number = toNumber(recipient);
  let path: string;
  let body: Record<string, unknown>;

  switch (item.message_type) {
    case 'image':
    case 'video':
    case 'document':
      path = `/message/sendMedia/${instance}`;
      body = {
        number,
        mediatype: item.message_type,
        media: item.media_url,
        caption: item.message_type === 'document' ? undefined : item.content || undefined,
        fileName: item.message_type === 'document' ? item.content || 'documento' : undefined,
      };
      break;
    case 'audio':
      path = `/message/sendWhatsAppAudio/${instance}`;
      body = { number, audio: item.media_url };
      break;
    default:
      path = `/message/sendText/${instance}`;
      body = { number, text: item.content ?? '' };
  }

  const { ok, data } = await evo(path, { method: 'POST', body: JSON.stringify(body) });
  if (!ok) {
    const message = data?.response?.message ?? data?.message ?? 'Evolution API error';
    throw new Error(Array.isArray(message) ? message.join('; ') : String(message));
  }
  return data?.key?.id ?? null;
}

// Baixa a mídia de uma mensagem recebida (áudio para transcrição)
export async function evoMediaBase64(instance: string, messageId: string): Promise<{ buffer: ArrayBuffer; mimetype: string } | null> {
  const { ok, data } = await evo(`/chat/getBase64FromMediaMessage/${instance}`, {
    method: 'POST',
    body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4: false }),
  });
  if (!ok || !data?.base64) {
    console.error('[evolution] getBase64FromMediaMessage falhou:', data);
    return null;
  }
  const binary = atob(String(data.base64).replace(/^data:[^;]+;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { buffer: bytes.buffer, mimetype: (data.mimetype ?? 'audio/ogg').split(';')[0] };
}
