// Modelos de mensagem (templates) da clínica na Meta: listar todos (com a
// situação da análise), criar e apagar. Só pela API oficial; o token nunca sai
// do servidor. A Meta analisa cada modelo novo (minutos a 24 horas).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUserOrgId } from "../_shared/tenant.ts";
import { GRAPH_URL, isMeta, loadOrgWhatsApp } from "../_shared/outbound.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LANGUAGES = new Set(["pt_BR", "en_US", "es"]);
const CATEGORIES = new Set(["UTILITY", "MARKETING"]);
const NAME_RE = /^[a-z0-9_]{1,512}$/;

// Confere o texto antes de mandar para a Meta, para não gastar uma análise à toa.
// Devolve o número de variáveis ({{1}}, {{2}}...) ou um erro em português.
function checkBody(body: string): { vars: number } | { error: string } {
  const text = body.trim();
  if (!text) return { error: "Escreva o texto da mensagem." };
  if (text.length > 1024) return { error: "O texto pode ter no máximo 1.024 caracteres." };
  const found = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  if (/\{\{(?!\s*\d+\s*\}\})/.test(text)) return { error: "Use as variáveis só no formato {{1}}, {{2}}..." };
  const unique = [...new Set(found)].sort((a, b) => a - b);
  for (let i = 0; i < unique.length; i++) {
    if (unique[i] !== i + 1) return { error: "As variáveis precisam ser em sequência: {{1}}, {{2}}, {{3}}..." };
  }
  if (/^\{\{\s*\d+\s*\}\}/.test(text) || /\{\{\s*\d+\s*\}\}[\s.!?]*$/.test(text)) {
    return { error: "A Meta não aceita variável no começo nem no fim do texto. Coloque alguma palavra antes e depois." };
  }
  if (/\}\}\s*\{\{/.test(text)) return { error: "Coloque alguma palavra entre duas variáveis seguidas." };
  const words = (text.replace(/\{\{\s*\d+\s*\}\}/g, " ").match(/\p{L}+/gu) ?? []).length;
  if (unique.length > 0 && words < unique.length * 2) {
    return { error: "Texto curto demais para tantas variáveis. Escreva mais palavras fixas na mensagem." };
  }
  return { vars: unique.length };
}

// Mensagens de erro da Meta mais comuns, em português
function metaErrorPt(data: any, status: number): string {
  const e = data?.error ?? {};
  const msg = String(e.error_user_msg || e.message || `Erro ${status} da Meta`);
  const sub = Number(e.error_subcode ?? 0);
  if (sub === 2388024 || /already exists/i.test(msg)) return "Já existe um modelo com esse nome e idioma. Escolha outro nome.";
  if (sub === 2388023) return "Esse nome foi apagado há pouco tempo e a Meta ainda não deixa usar de novo. Escolha outro nome.";
  if (sub === 2388299) return "A Meta não aceita variável no começo nem no fim do texto.";
  if (Number(e.code) === 190) return "A chave de acesso do WhatsApp venceu. Conecte o WhatsApp de novo em Configurações.";
  if (Number(e.code) === 200 || Number(e.code) === 10) return "O app não tem permissão para gerenciar os modelos desta conta do WhatsApp.";
  return msg;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return json({ error: "Faça login de novo" }, 401);

  const orgId = await getUserOrgId(supabase, user.id);
  if (!orgId) return json({ error: "Usuário sem clínica" }, 403);

  const s = await loadOrgWhatsApp(supabase, orgId);
  if (!s || !isMeta(s)) {
    return json({ error: "Conecte o WhatsApp pela API oficial em Configurações para criar modelos." });
  }
  if (!s.whatsapp_business_account_id) {
    return json({ error: "Falta o ID da conta do WhatsApp Business (WABA) na configuração do WhatsApp da clínica." });
  }
  const waba = s.whatsapp_business_account_id;
  const auth = { Authorization: `Bearer ${s.whatsapp_access_token}` };

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "list");

  if (action === "list") {
    const templates: any[] = [];
    let url: string | null =
      `${GRAPH_URL}/${waba}/message_templates?fields=id,name,language,category,status,rejected_reason,quality_score,components&limit=100`;
    let pages = 0;
    while (url && pages < 5) {
      const resp: Response = await fetch(url, { headers: auth });
      const data: any = await resp.json().catch(() => ({}));
      if (!resp.ok) return json({ error: metaErrorPt(data, resp.status) });
      templates.push(...(data.data ?? []));
      url = data.paging?.next ?? null;
      pages++;
    }
    return json({
      templates: templates
        .map((t) => {
          const comp = (type: string) => (t.components ?? []).find((c: any) => c.type === type);
          return {
            id: t.id,
            name: t.name,
            language: t.language,
            category: t.category,
            status: t.status,
            rejected_reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
            quality: t.quality_score?.score ?? null,
            header: comp("HEADER")?.format === "TEXT" ? comp("HEADER")?.text ?? null : comp("HEADER")?.format ?? null,
            body: comp("BODY")?.text ?? "",
            footer: comp("FOOTER")?.text ?? null,
            buttons: (comp("BUTTONS")?.buttons ?? []).map((b: any) => b.text),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  if (action === "create") {
    const name = String(body.name ?? "").trim();
    const language = String(body.language ?? "pt_BR");
    const category = String(body.category ?? "UTILITY");
    const text = String(body.body ?? "").trim();
    const header = String(body.header ?? "").trim();
    const footer = String(body.footer ?? "").trim();
    const buttons: string[] = Array.isArray(body.buttons)
      ? body.buttons.map((b: unknown) => String(b ?? "").trim()).filter(Boolean)
      : [];
    const examples: string[] = Array.isArray(body.examples) ? body.examples.map((x: unknown) => String(x ?? "").trim()) : [];

    if (!NAME_RE.test(name)) return json({ error: "Nome inválido: use só letras minúsculas, números e _ (sem espaço nem acento)." });
    if (!LANGUAGES.has(language)) return json({ error: "Idioma inválido." });
    if (!CATEGORIES.has(category)) return json({ error: "Escolha a categoria: Utilidade ou Marketing." });
    const check = checkBody(text);
    if ("error" in check) return json({ error: check.error });
    if (examples.length < check.vars || examples.slice(0, check.vars).some((x) => !x)) {
      return json({ error: "Preencha um exemplo para cada variável. A Meta usa os exemplos para aprovar o modelo." });
    }
    if (header.length > 60) return json({ error: "O título pode ter no máximo 60 caracteres." });
    if (/\{\{/.test(header) || /\{\{/.test(footer)) return json({ error: "Variáveis só no texto da mensagem, não no título nem no rodapé." });
    if (footer.length > 60) return json({ error: "O rodapé pode ter no máximo 60 caracteres." });
    if (buttons.length > 3) return json({ error: "No máximo 3 botões de resposta." });
    if (buttons.some((b) => b.length > 25)) return json({ error: "Cada botão pode ter no máximo 25 caracteres." });

    const components: any[] = [];
    if (header) components.push({ type: "HEADER", format: "TEXT", text: header });
    components.push({
      type: "BODY",
      text,
      ...(check.vars ? { example: { body_text: [examples.slice(0, check.vars)] } } : {}),
    });
    if (footer) components.push({ type: "FOOTER", text: footer });
    if (buttons.length) components.push({ type: "BUTTONS", buttons: buttons.map((b) => ({ type: "QUICK_REPLY", text: b })) });

    const resp = await fetch(`${GRAPH_URL}/${waba}/message_templates`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name, language, category, components }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.warn("[whatsapp-templates] create failed", resp.status, JSON.stringify(data?.error ?? {}));
      return json({ error: metaErrorPt(data, resp.status) });
    }
    return json({ ok: true, id: data.id, status: data.status, category: data.category });
  }

  if (action === "delete") {
    const name = String(body.name ?? "").trim();
    const id = String(body.id ?? "").trim();
    if (!NAME_RE.test(name)) return json({ error: "Modelo inválido." });
    const qs = new URLSearchParams({ name, ...(/^\d+$/.test(id) ? { hsm_id: id } : {}) });
    const resp = await fetch(`${GRAPH_URL}/${waba}/message_templates?${qs}`, { method: "DELETE", headers: auth });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) return json({ error: metaErrorPt(data, resp.status) });
    return json({ ok: true });
  }

  return json({ error: "Ação desconhecida" }, 400);
});
