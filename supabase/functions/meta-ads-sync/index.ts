// RASTREAMENTO DE ANÚNCIOS
// 1. Busca na Meta (só leitura) o investimento por anúncio e por dia, com os
//    nomes de campanha, conjunto e anúncio da conta de anúncios da clínica.
// 2. Devolve as vendas para a Meta (Conversions API para mensagens) quando a
//    clínica ligou a opção: assim a Meta aprende quem compra de verdade.
//
// Chamadas:
//   * cron (service_role), de hora em hora: todas as clínicas conectadas;
//   * tela "Anúncios" (usuário logado): { action: "sync" } ou { action: "test" }
//     só para a clínica de quem chamou.
// As chaves ficam só no servidor (tabela meta_ads_connections).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUserOrgId } from "../_shared/tenant.ts";
import { GRAPH_API } from "../_shared/meta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUDGET_MS = 50_000;
const MAX_ATTEMPTS = 5;
const MESSAGING_ACTIONS = new Set([
  "onsite_conversion.messaging_conversation_started_7d",
]);

function isServiceCall(req: Request): boolean {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return !!key && (req.headers.get("authorization") ?? "") === `Bearer ${key}`;
}

class MetaError extends Error {
  constructor(message: string, public code = 0) {
    super(message);
  }
}

// Erros da Meta mais comuns, em português
function metaErrorPt(data: any, status: number): MetaError {
  const e = data?.error ?? {};
  const code = Number(e.code ?? 0);
  const msg = String(e.error_user_msg || e.message || `Erro ${status} da Meta`);
  if (code === 190) return new MetaError("A chave de acesso da Meta venceu ou foi revogada. Cole uma chave nova.", code);
  if (code === 10 || code === 200 || code === 294) {
    return new MetaError("A chave não tem permissão de leitura desta conta de anúncios (precisa de ads_read).", code);
  }
  if (code === 100 && /act_|ad account/i.test(msg)) {
    return new MetaError("Conta de anúncios não encontrada. Confira o ID (só números) e se a chave tem acesso a ela.", code);
  }
  if (code === 17 || code === 4 || code === 613 || code === 80004) {
    return new MetaError("A Meta pediu para esperar (limite de consultas). Tente de novo em alguns minutos.", code);
  }
  return new MetaError(msg, code);
}

async function graphGet(url: string, token: string): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw metaErrorPt(data, res.status);
  return data;
}

async function graphPost(url: string, token: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw metaErrorPt(data, res.status);
  return data;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// --- 1. Investimento ----------------------------------------------------------

async function syncInsights(supabase: any, conn: any): Promise<{ rows: number }> {
  const days = conn.last_sync_at ? 7 : 30; // 1ª vez puxa 30 dias; depois só a última semana (a Meta ajusta números atrasados)
  const until = new Date();
  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  const params = new URLSearchParams({
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since: ymd(since), until: ymd(until) }),
    fields: "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions",
    limit: "500",
  });
  let url: string | null = `${GRAPH_API}/act_${conn.ad_account_id}/insights?${params}`;
  const ads = new Map<string, any>();
  const daily: any[] = [];

  for (let page = 0; url && page < 50; page++) {
    const data = await graphGet(url, conn.access_token);
    for (const row of data?.data ?? []) {
      if (!row.ad_id || !row.date_start) continue;
      ads.set(row.ad_id, {
        organization_id: conn.organization_id,
        ad_id: String(row.ad_id),
        ad_name: row.ad_name ?? null,
        adset_id: row.adset_id ?? null,
        adset_name: row.adset_name ?? null,
        campaign_id: row.campaign_id ?? null,
        campaign_name: row.campaign_name ?? null,
        updated_at: new Date().toISOString(),
      });
      const conversations = (row.actions ?? [])
        .filter((a: any) => MESSAGING_ACTIONS.has(a.action_type))
        .reduce((sum: number, a: any) => sum + Number(a.value ?? 0), 0);
      daily.push({
        organization_id: conn.organization_id,
        ad_id: String(row.ad_id),
        date: row.date_start,
        spend: Number(row.spend ?? 0),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        conversations,
        updated_at: new Date().toISOString(),
      });
    }
    url = data?.paging?.next ?? null;
  }

  if (ads.size > 0) {
    const { error } = await supabase.from("meta_ads").upsert([...ads.values()], { onConflict: "organization_id,ad_id" });
    if (error) throw new Error(`Erro ao salvar anúncios: ${error.message}`);
  }
  for (let i = 0; i < daily.length; i += 500) {
    const { error } = await supabase
      .from("meta_ad_insights_daily")
      .upsert(daily.slice(i, i + 500), { onConflict: "organization_id,ad_id,date" });
    if (error) throw new Error(`Erro ao salvar investimento: ${error.message}`);
  }
  return { rows: daily.length };
}

// --- 2. Devolver vendas (Conversions API para mensagens) -----------------------

async function sendConversions(supabase: any, conn: any): Promise<{ sent: number; failed: number; error?: string }> {
  const { data: pending } = await supabase
    .from("meta_conversion_events")
    .select("id, event_name, value, currency, ctwa_clid, event_time, attempts")
    .eq("organization_id", conn.organization_id)
    .eq("status", "pending")
    .order("created_at")
    .limit(50);
  if (!pending?.length) return { sent: 0, failed: 0 };

  const { data: wa } = await supabase
    .from("nina_settings")
    .select("whatsapp_business_account_id, whatsapp_access_token")
    .eq("organization_id", conn.organization_id)
    .maybeSingle();
  if (!wa?.whatsapp_business_account_id || !wa?.whatsapp_access_token) {
    return { sent: 0, failed: 0, error: "Devolver vendas para a Meta só funciona com o WhatsApp na API oficial." };
  }

  let datasetId: string | null = conn.capi_dataset_id;
  if (!datasetId) {
    try {
      // Cria (ou devolve, se já existir) o conjunto de dados da conta do WhatsApp
      const ds = await graphPost(`${GRAPH_API}/${wa.whatsapp_business_account_id}/dataset`, wa.whatsapp_access_token, {});
      datasetId = ds?.id ? String(ds.id) : null;
    } catch (e) {
      const msg = e instanceof MetaError && (e.code === 10 || e.code === 200)
        ? "O app da Meta ainda não tem a permissão whatsapp_business_manage_events (pedir na Análise do App)."
        : (e as Error).message;
      return { sent: 0, failed: 0, error: msg };
    }
    if (!datasetId) return { sent: 0, failed: 0, error: "A Meta não devolveu o conjunto de dados." };
    await supabase.from("meta_ads_connections").update({ capi_dataset_id: datasetId }).eq("organization_id", conn.organization_id);
  }

  let sent = 0, failed = 0;
  for (const ev of pending) {
    const payload = {
      data: [{
        event_name: ev.event_name,
        event_time: Math.floor(new Date(ev.event_time).getTime() / 1000),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: {
          whatsapp_business_account_id: wa.whatsapp_business_account_id,
          ctwa_clid: ev.ctwa_clid,
        },
        custom_data: { currency: ev.currency || "BRL", value: Number(ev.value ?? 0) },
      }],
    };
    try {
      await graphPost(`${GRAPH_API}/${datasetId}/events`, wa.whatsapp_access_token, payload);
      await supabase.from("meta_conversion_events")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts: ev.attempts + 1, last_error: null })
        .eq("id", ev.id);
      sent++;
    } catch (e) {
      const attempts = ev.attempts + 1;
      await supabase.from("meta_conversion_events")
        .update({ status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", attempts, last_error: (e as Error).message })
        .eq("id", ev.id);
      failed++;
    }
  }
  return { sent, failed };
}

// --- Entrada -------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "sync");

  let orgFilter: string | null = null;
  if (!isServiceCall(req)) {
    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return json({ error: "Faça login de novo" }, 401);
    orgFilter = await getUserOrgId(supabase, user.id);
    if (!orgFilter) return json({ error: "Usuário sem clínica" }, 403);
  }

  let query = supabase
    .from("meta_ads_connections")
    .select("organization_id, ad_account_id, access_token, capi_enabled, capi_dataset_id, last_sync_at");
  if (orgFilter) query = query.eq("organization_id", orgFilter);
  const { data: conns, error } = await query;
  if (error) return json({ error: error.message }, 500);

  // Teste da chave: só confere se a conta de anúncios responde
  if (action === "test") {
    const conn = conns?.[0];
    if (!conn?.ad_account_id || !conn?.access_token) return json({ ok: false, error: "Salve o ID da conta e a chave primeiro." });
    try {
      const acc = await graphGet(
        `${GRAPH_API}/act_${conn.ad_account_id}?fields=name,currency,account_status,timezone_name`,
        conn.access_token,
      );
      return json({ ok: true, account: { name: acc.name, currency: acc.currency, status: acc.account_status, timezone: acc.timezone_name } });
    } catch (e) {
      return json({ ok: false, error: (e as Error).message });
    }
  }

  const results: any[] = [];
  for (const conn of conns ?? []) {
    if (Date.now() - started > BUDGET_MS) break;
    const result: any = { organization_id: conn.organization_id };
    let syncError: string | null = null;

    if (conn.ad_account_id && conn.access_token) {
      try {
        result.insights = await syncInsights(supabase, conn);
      } catch (e) {
        syncError = (e as Error).message;
      }
    } else {
      syncError = "Conta de anúncios não conectada.";
    }

    if (conn.capi_enabled) {
      result.conversions = await sendConversions(supabase, conn);
      if (result.conversions.error && !syncError) syncError = result.conversions.error;
    }

    await supabase.from("meta_ads_connections")
      .update({
        ...(result.insights ? { last_sync_at: new Date().toISOString() } : {}),
        last_sync_error: syncError,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", conn.organization_id);
    if (syncError) result.error = syncError;
    results.push(result);
  }

  if (orgFilter) {
    const r = results[0];
    if (!r) return json({ ok: false, error: "Conecte a conta de anúncios primeiro." });
    return json({ ok: !r.error, ...r });
  }
  return json({ ok: true, clinics: results.length });
});
