// Envios ativos da clínica (DISPARO e FOLLOW-UP).
// Modelos (templates) só pela API oficial da Meta; texto livre pela Meta ou
// pela Evolution (QR code). Toda mensagem enviada é gravada na conversa do
// cliente, para a resposta cair no Atendimento como qualquer outra.

import { evoSend } from "./evolution.ts";

export const GRAPH_URL = "https://graph.facebook.com/v23.0";

export type OrgWhatsApp = {
  whatsapp_provider: string | null;
  whatsapp_access_token: string | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
  evolution_instance: string | null;
  evolution_status: string | null;
  timezone: string | null;
};

export type TemplateParam = { source: "first_name" | "name" | "fixed"; value?: string };

export class SendError extends Error {
  code: number | null;
  // 'campaign' = pausar a campanha inteira; 'recipient' = só esse número falha; 'retry' = tentar depois
  scope: "campaign" | "recipient" | "retry";
  constructor(message: string, code: number | null, scope: "campaign" | "recipient" | "retry") {
    super(message);
    this.code = code;
    this.scope = scope;
  }
}

export function isMeta(s: OrgWhatsApp | null): boolean {
  return !!s && s.whatsapp_provider !== "evolution" && !!s.whatsapp_access_token && !!s.whatsapp_phone_number_id;
}

export async function loadOrgWhatsApp(supabase: any, orgId: string): Promise<OrgWhatsApp | null> {
  const { data } = await supabase
    .from("nina_settings")
    .select("whatsapp_provider, whatsapp_access_token, whatsapp_phone_number_id, whatsapp_business_account_id, evolution_instance, evolution_status, timezone")
    .eq("organization_id", orgId)
    .maybeSingle();
  return data ?? null;
}

// Hora local da clínica (0-23)
export function localHour(tz: string | null, at = new Date()): number {
  const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz || "America/Sao_Paulo" }).format(at);
  return Number(h) % 24;
}

export function insideWindow(tz: string | null, start: number, end: number, at = new Date()): boolean {
  const h = localHour(tz, at);
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

export function firstName(name: string | null | undefined): string {
  const n = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
}

export function resolveParams(params: TemplateParam[], name: string | null | undefined): string[] {
  return (params ?? []).map((p) => {
    if (p.source === "first_name") return firstName(name) || "tudo bem";
    if (p.source === "name") return (name ?? "").trim() || "cliente";
    return (p.value ?? "").trim() || "-";
  });
}

export function fillBody(body: string | null | undefined, values: string[]): string {
  return (body ?? "").replace(/\{\{(\d+)\}\}/g, (_, i) => values[Number(i) - 1] ?? "");
}

// Erros da Meta que pedem para parar tudo (proteger o número)
const CAMPAIGN_STOP = new Set([
  190, // token vencido/inválido
  368, // bloqueado temporariamente por violar políticas
  131031, // conta bloqueada
  131048, // limite de spam atingido
  132000, 132001, 132005, 132007, 132012, 132015, 132016, // problemas no modelo
  133010, // número não registrado
]);
const RETRY_LATER = new Set([4, 80007, 130429, 131016, 131056]);

async function graphPost(s: OrgWhatsApp, payload: Record<string, unknown>): Promise<string | null> {
  const resp = await fetch(`${GRAPH_URL}/${s.whatsapp_phone_number_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.whatsapp_access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const code = Number(data?.error?.code ?? data?.error?.error_subcode ?? 0) || null;
    const msg = data?.error?.error_data?.details || data?.error?.message || `Erro ${resp.status} da Meta`;
    const scope = code && CAMPAIGN_STOP.has(code) ? "campaign" : code && RETRY_LATER.has(code) ? "retry" : "recipient";
    throw new SendError(msg, code, scope);
  }
  return data?.messages?.[0]?.id ?? null;
}

export async function sendTemplate(s: OrgWhatsApp, to: string, t: {
  name: string; language: string; values: string[];
  headerMediaUrl?: string | null; headerMediaType?: string | null;
}): Promise<string | null> {
  if (!isMeta(s)) throw new SendError("Disparo com modelo só funciona com a API oficial do WhatsApp", null, "campaign");
  const components: any[] = [];
  if (t.headerMediaUrl && t.headerMediaType) {
    components.push({ type: "header", parameters: [{ type: t.headerMediaType, [t.headerMediaType]: { link: t.headerMediaUrl } }] });
  }
  if (t.values.length) {
    components.push({ type: "body", parameters: t.values.map((text) => ({ type: "text", text })) });
  }
  return graphPost(s, {
    to,
    type: "template",
    template: { name: t.name, language: { code: t.language || "pt_BR" }, ...(components.length ? { components } : {}) },
  });
}

export async function sendText(s: OrgWhatsApp, to: string, text: string): Promise<string | null> {
  if (s.whatsapp_provider === "evolution") {
    if (!s.evolution_instance || s.evolution_status !== "open") {
      throw new SendError("WhatsApp (QR code) desconectado", null, "campaign");
    }
    return evoSend(s.evolution_instance, to, { message_type: "text", content: text, media_url: null });
  }
  if (!isMeta(s)) throw new SendError("WhatsApp não configurado", null, "campaign");
  return graphPost(s, { to, type: "text", text: { body: text } });
}

// Qualidade do número na Meta: GREEN, YELLOW, RED (ou null se não deu para ler)
export async function phoneQuality(s: OrgWhatsApp): Promise<{ quality: string | null; tier: string | null; phone: string | null; name: string | null }> {
  if (!isMeta(s)) return { quality: null, tier: null, phone: null, name: null };
  try {
    const resp = await fetch(
      `${GRAPH_URL}/${s.whatsapp_phone_number_id}?fields=quality_rating,messaging_limit_tier,display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${s.whatsapp_access_token}` } },
    );
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok) return { quality: null, tier: null, phone: null, name: null };
    return { quality: d.quality_rating ?? null, tier: d.messaging_limit_tier ?? null, phone: d.display_phone_number ?? null, name: d.verified_name ?? null };
  } catch {
    return { quality: null, tier: null, phone: null, name: null };
  }
}

// Conversa ativa do cliente (cria se não existir)
export async function ensureConversation(supabase: any, orgId: string, contactId: string): Promise<string> {
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("contact_id", contactId)
    .eq("is_active", true)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (conv?.id) return conv.id;
  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ organization_id: orgId, contact_id: contactId, status: "nina", is_active: true })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

export async function recordOutbound(supabase: any, orgId: string, conversationId: string, content: string,
  whatsappMessageId: string | null, metadata: Record<string, unknown>): Promise<string | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      organization_id: orgId,
      conversation_id: conversationId,
      whatsapp_message_id: whatsappMessageId,
      content,
      type: "text",
      from_type: "human",
      status: "sent",
      sent_at: now,
      metadata,
    })
    .select("id")
    .single();
  if (error) console.error("[outbound] erro ao gravar mensagem", error);
  await supabase.from("conversations").update({ last_message_at: now }).eq("id", conversationId);
  return data?.id ?? null;
}

// Cliente falou com a clínica nas últimas 24h? (janela em que texto livre é permitido)
export async function windowOpen(supabase: any, conversationId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("from_type", "user")
    .gte("sent_at", since);
  return (count ?? 0) > 0;
}

// Só o cron (chave service_role) pode chamar os processadores
export function isServiceCall(req: Request): boolean {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  return !!key && auth === `Bearer ${key}`;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
