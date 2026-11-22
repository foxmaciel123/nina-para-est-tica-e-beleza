// Painel DISPARO / FOLLOW-UP: diz se a clínica está na API oficial, a
// qualidade do número e a lista de modelos (templates) APROVADOS na Meta.
// O token nunca sai do servidor.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUserOrgId } from "../_shared/tenant.ts";
import { GRAPH_URL, isMeta, loadOrgWhatsApp, phoneQuality } from "../_shared/outbound.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return json({ error: "Faça login de novo" }, 401);

  const orgId = await getUserOrgId(supabase, user.id);
  if (!orgId) return json({ error: "Usuário sem clínica" }, 403);

  const s = await loadOrgWhatsApp(supabase, orgId);
  const provider = !s ? "none" : s.whatsapp_provider === "evolution" ? "evolution" : isMeta(s) ? "meta" : "none";

  if (provider !== "meta" || !s) {
    return json({ provider, quality: null, templates: [], templatesError: null });
  }

  const quality = await phoneQuality(s);
  let templates: any[] = [];
  let templatesError: string | null = null;

  if (!s.whatsapp_business_account_id) {
    templatesError = "Falta o ID da conta do WhatsApp Business (WABA) na configuração do WhatsApp da clínica.";
  } else {
    try {
      let url: string | null =
        `${GRAPH_URL}/${s.whatsapp_business_account_id}/message_templates?fields=name,language,category,status,components&limit=100`;
      let pages = 0;
      while (url && pages < 5) {
        const resp: Response = await fetch(url, { headers: { Authorization: `Bearer ${s.whatsapp_access_token}` } });
        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          templatesError = data?.error?.message ?? `Erro ${resp.status} ao ler os modelos na Meta`;
          break;
        }
        templates.push(...(data.data ?? []));
        url = data.paging?.next ?? null;
        pages++;
      }
    } catch (e) {
      templatesError = e instanceof Error ? e.message : "Erro ao ler os modelos";
    }
  }

  const approved = templates
    .filter((t) => t.status === "APPROVED")
    .map((t) => {
      const body = (t.components ?? []).find((c: any) => c.type === "BODY");
      const header = (t.components ?? []).find((c: any) => c.type === "HEADER");
      const footer = (t.components ?? []).find((c: any) => c.type === "FOOTER");
      const buttons = (t.components ?? []).find((c: any) => c.type === "BUTTONS");
      const vars = new Set<number>();
      for (const m of String(body?.text ?? "").matchAll(/\{\{(\d+)\}\}/g)) vars.add(Number(m[1]));
      return {
        name: t.name,
        language: t.language,
        category: t.category,
        body: body?.text ?? "",
        header_format: header?.format ?? null, // TEXT, IMAGE, VIDEO, DOCUMENT
        header_text: header?.format === "TEXT" ? header?.text ?? null : null,
        footer: footer?.text ?? null,
        buttons: (buttons?.buttons ?? []).map((b: any) => b.text),
        variables: vars.size ? Math.max(...vars) : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return json({ provider, quality, templates: approved, templatesError });
});
