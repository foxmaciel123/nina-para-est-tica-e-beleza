// DISPARO: envia as campanhas em andamento, um número por vez, no ritmo
// escolhido. Roda pelo cron a cada minuto (cerca de 50 s por rodada).
//
// Proteções do número (API oficial):
//   * só modelos aprovados; horário comercial da clínica; limite diário;
//   * qualidade VERMELHA na Meta → pausa todas as campanhas da clínica;
//   * erros graves da Meta (spam, token, modelo) → pausa a campanha;
//   * mais de 25% de falhas depois de 20 tentativas → pausa a campanha;
//   * "nao-perturbe" e bloqueados nunca recebem.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isOrgActive } from "../_shared/tenant.ts";
import {
  ensureConversation, fillBody, insideWindow, isServiceCall, loadOrgWhatsApp, phoneQuality,
  recordOutbound, resolveParams, SendError, sendTemplate, sleep, type OrgWhatsApp,
} from "../_shared/outbound.ts";

const SPEED: Record<string, [number, number]> = {
  seguro: [8000, 15000],
  normal: [4000, 8000],
  rapido: [1500, 3000],
};
const BUDGET_MS = 50_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (!isServiceCall(req)) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const started = Date.now();
  let sentTotal = 0;

  await supabase.rpc("disparo_sweep_optouts").then(({ error }: any) => error && console.error("[disparo] optouts", error));

  // Agendadas que chegaram na hora viram "running"
  await supabase
    .from("disparo_campaigns")
    .update({ status: "running" })
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString());

  const { data: campaigns, error } = await supabase
    .from("disparo_campaigns")
    .select("*")
    .eq("status", "running")
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) return json({ error: error.message }, 500);
  if (!campaigns?.length) return json({ sent: 0, campaigns: 0 });

  const orgCache = new Map<string, { s: OrgWhatsApp | null; ok: boolean; reason?: string }>();

  for (const c of campaigns) {
    if (Date.now() - started > BUDGET_MS) break;

    // Clínica: ativa, API oficial e qualidade do número
    let org = orgCache.get(c.organization_id);
    if (!org) {
      const s = await loadOrgWhatsApp(supabase, c.organization_id);
      let ok = true;
      let reason: string | undefined;
      if (!(await isOrgActive(supabase, c.organization_id))) { ok = false; reason = "Clínica suspensa"; }
      else if (!s || s.whatsapp_provider === "evolution" || !s.whatsapp_access_token || !s.whatsapp_phone_number_id) {
        ok = false; reason = "O disparo precisa da API oficial do WhatsApp conectada";
      } else {
        const q = await phoneQuality(s);
        if (q.quality === "RED") { ok = false; reason = "Qualidade do número ficou VERMELHA na Meta. Disparo pausado para proteger o número."; }
      }
      org = { s, ok, reason };
      orgCache.set(c.organization_id, org);
    }
    if (!org.ok) {
      await pause(supabase, c.id, org.reason ?? "Pausado");
      continue;
    }
    const tz = org.s!.timezone;
    if (!insideWindow(tz, c.window_start, c.window_end)) continue;

    // Limite diário (últimas 24h desta campanha)
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: sentToday } = await supabase
      .from("disparo_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .eq("status", "sent")
      .gte("sent_at", since);
    let room = c.daily_limit - (sentToday ?? 0);
    if (room <= 0) continue;

    const [minD, maxD] = SPEED[c.speed] ?? SPEED.seguro;
    if (!c.started_at) {
      await supabase.from("disparo_campaigns").update({ started_at: new Date().toISOString() }).eq("id", c.id);
    }

    let stopCampaign: string | null = null;
    while (room > 0 && !stopCampaign && Date.now() - started < BUDGET_MS) {
      // Status pode ter mudado pelo painel (pausar/cancelar)
      const { data: fresh } = await supabase.from("disparo_campaigns").select("status").eq("id", c.id).single();
      if (fresh?.status !== "running") break;

      const { data: next } = await supabase
        .from("disparo_recipients")
        .select("id, contact_id, phone, name, attempts")
        .eq("campaign_id", c.id)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!next) {
        await finishIfDone(supabase, c.id);
        break;
      }

      // Reserva o número (evita envio duplo se duas rodadas se cruzarem)
      const { data: claimed } = await supabase
        .from("disparo_recipients")
        .update({ status: "sending", attempts: (next.attempts ?? 0) + 1 })
        .eq("id", next.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      // Pediu para sair ou foi bloqueado depois de entrar na lista
      if (next.contact_id) {
        const { data: ct } = await supabase.from("contacts").select("is_blocked, tags").eq("id", next.contact_id).maybeSingle();
        if (ct && (ct.is_blocked || (ct.tags ?? []).includes("nao-perturbe"))) {
          await supabase.from("disparo_recipients").update({ status: "skipped", error: "Cliente não quer receber mensagens" }).eq("id", next.id);
          await bump(supabase, c.id, "skipped");
          continue;
        }
      }

      const values = resolveParams(c.template_params ?? [], next.name);
      try {
        const waId = await sendTemplate(org.s!, next.phone, {
          name: c.template_name,
          language: c.template_language,
          values,
          headerMediaUrl: c.header_media_url,
          headerMediaType: c.header_media_type,
        });

        let messageId: string | null = null;
        if (next.contact_id) {
          try {
            const convId = await ensureConversation(supabase, c.organization_id, next.contact_id);
            messageId = await recordOutbound(supabase, c.organization_id, convId,
              fillBody(c.template_body, values) || `[Modelo: ${c.template_name}]`, waId,
              { origem: "disparo", campaign_id: c.id, template: c.template_name });
          } catch (e) {
            console.error("[disparo] conversa", e);
          }
        }
        await supabase.from("disparo_recipients").update({
          status: "sent", sent_at: new Date().toISOString(), whatsapp_message_id: waId, message_id: messageId, error: null,
        }).eq("id", next.id);
        await bump(supabase, c.id, "sent");
        sentTotal++;
        room--;
      } catch (e) {
        const err = e instanceof SendError ? e : new SendError(e instanceof Error ? e.message : "Erro", null, "recipient");
        console.error(`[disparo] ${c.id} ${next.phone}:`, err.code, err.message);
        if (err.scope === "retry" && (next.attempts ?? 0) < 3) {
          await supabase.from("disparo_recipients").update({ status: "pending", error: err.message }).eq("id", next.id);
          break; // Meta pediu calma: tenta na próxima rodada
        }
        await supabase.from("disparo_recipients").update({ status: "failed", error: err.message }).eq("id", next.id);
        await bump(supabase, c.id, "failed");
        if (err.scope === "campaign") stopCampaign = `Meta recusou: ${err.message}`;
        else stopCampaign = await tooManyFailures(supabase, c.id);
      }

      await sleep(minD + Math.random() * (maxD - minD));
    }

    if (stopCampaign) await pause(supabase, c.id, stopCampaign);
  }

  return json({ sent: sentTotal, campaigns: campaigns.length, ms: Date.now() - started });
});

async function pause(supabase: any, id: string, reason: string) {
  await supabase.from("disparo_campaigns").update({ status: "auto_paused", pause_reason: reason }).eq("id", id).eq("status", "running");
  // Quem ficou "enviando" volta para a fila
  await supabase.from("disparo_recipients").update({ status: "pending" }).eq("campaign_id", id).eq("status", "sending");
}

async function bump(supabase: any, id: string, field: "sent" | "failed" | "skipped") {
  const { count } = await supabase
    .from("disparo_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id)
    .eq("status", field);
  await supabase.from("disparo_campaigns").update({ [field]: count ?? 0 }).eq("id", id);
}

async function tooManyFailures(supabase: any, id: string): Promise<string | null> {
  const { data: c } = await supabase.from("disparo_campaigns").select("sent, failed").eq("id", id).single();
  const tried = (c?.sent ?? 0) + (c?.failed ?? 0);
  if (tried >= 20 && (c?.failed ?? 0) / tried > 0.25) {
    return "Muitas falhas seguidas (mais de 25%). Confira a lista de números antes de continuar.";
  }
  return null;
}

async function finishIfDone(supabase: any, id: string) {
  const { count } = await supabase
    .from("disparo_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id)
    .in("status", ["pending", "sending"]);
  if ((count ?? 0) === 0) {
    await supabase.from("disparo_campaigns")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", id).eq("status", "running");
  }
}
