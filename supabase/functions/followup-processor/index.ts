// FOLLOW-UP: coloca clientes nas réguas ativas e envia os passos vencidos.
// Roda pelo cron a cada 5 minutos.
//
// Regras da API oficial:
//   * texto livre só chega se o cliente falou nas últimas 24h; fora disso o
//     passo de texto é pulado (o painel avisa para usar um modelo aprovado);
//   * passo com modelo aprovado funciona a qualquer hora;
//   * cliente respondeu → sai da régua (se "parar quando responder" estiver ligado);
//   * "nao-perturbe" e bloqueados saem na hora.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isOrgActive } from "../_shared/tenant.ts";
import {
  ensureConversation, fillBody, firstName, insideWindow, isMeta, isServiceCall, loadOrgWhatsApp, recordOutbound,
  resolveParams, SendError, sendTemplate, sendText, sleep, windowOpen, type OrgWhatsApp,
} from "../_shared/outbound.ts";

const BUDGET_MS = 50_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (!isServiceCall(req)) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const started = Date.now();

  await supabase.rpc("disparo_sweep_optouts").then(({ error }: any) => error && console.error("[followup] optouts", error));

  // 1. Entradas nas réguas ativas
  const { data: seqs } = await supabase.from("followup_sequences").select("id").eq("active", true);
  let enrolled = 0;
  for (const s of seqs ?? []) {
    const { data, error } = await supabase.rpc("followup_enroll", { p_seq: s.id });
    if (error) console.error("[followup] enroll", s.id, error);
    else enrolled += data ?? 0;
  }

  // 2. Passos vencidos
  const { data: due } = await supabase
    .from("followup_enrollments")
    .select("id, organization_id, sequence_id, contact_id, current_step, enrolled_at")
    .eq("status", "ativo")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(100);

  const seqCache = new Map<string, any>();
  const orgCache = new Map<string, { s: OrgWhatsApp | null; active: boolean }>();
  let sent = 0;

  for (const e of due ?? []) {
    if (Date.now() - started > BUDGET_MS) break;

    let seq = seqCache.get(e.sequence_id);
    if (!seq) {
      const { data } = await supabase
        .from("followup_sequences")
        .select("*, steps:followup_steps(*)")
        .eq("id", e.sequence_id)
        .single();
      seq = data;
      if (seq) seq.steps = (seq.steps ?? []).sort((a: any, b: any) => a.position - b.position);
      seqCache.set(e.sequence_id, seq);
    }
    if (!seq || !seq.active) continue; // régua desligada: espera religar

    let org = orgCache.get(e.organization_id);
    if (!org) {
      org = { s: await loadOrgWhatsApp(supabase, e.organization_id), active: await isOrgActive(supabase, e.organization_id) };
      orgCache.set(e.organization_id, org);
    }
    if (!org.active || !org.s) continue;

    const { data: contact } = await supabase
      .from("contacts")
      .select("id, name, call_name, phone_number, whatsapp_id, is_blocked, tags")
      .eq("id", e.contact_id)
      .maybeSingle();
    if (!contact || contact.is_blocked || (contact.tags ?? []).includes("nao-perturbe")) {
      await stop(supabase, e.id, "parado", "Cliente não quer receber mensagens");
      continue;
    }

    const convId = await ensureConversation(supabase, e.organization_id, e.contact_id);

    if (seq.stop_on_reply) {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", convId)
        .eq("from_type", "user")
        .gt("sent_at", e.enrolled_at);
      if ((count ?? 0) > 0) {
        await stop(supabase, e.id, "respondeu", "Cliente respondeu");
        continue;
      }
    }

    if (!insideWindow(org.s.timezone, seq.window_start, seq.window_end)) {
      await supabase.from("followup_enrollments")
        .update({ next_run_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() })
        .eq("id", e.id);
      continue;
    }

    const step = seq.steps[e.current_step];
    if (!step) {
      await stop(supabase, e.id, "concluido", null);
      continue;
    }

    const to = contact.whatsapp_id || contact.phone_number;
    const name = contact.call_name || contact.name;
    let outcome: "sent" | "skipped" | "failed" = "sent";
    let detail: string | null = null;
    let messageId: string | null = null;

    try {
      if (step.kind === "modelo") {
        if (!step.template_name) throw new SendError("Passo sem modelo escolhido", null, "recipient");
        const values = resolveParams(step.template_params ?? [], name);
        const waId = await sendTemplate(org.s, to, { name: step.template_name, language: step.template_language || "pt_BR", values });
        messageId = await recordOutbound(supabase, e.organization_id, convId,
          fillBody(step.template_body, values) || `[Modelo: ${step.template_name}]`, waId,
          { origem: "followup", sequence_id: seq.id, step_id: step.id });
      } else {
        const text = (step.message ?? "").replace(/\{nome\}/gi, firstName(name) || "tudo bem");
        if (!text.trim()) throw new SendError("Passo sem mensagem", null, "recipient");
        if (isMeta(org.s) && !(await windowOpen(supabase, convId))) {
          outcome = "skipped";
          detail = "Pulado: o cliente não falou nas últimas 24h (use um modelo aprovado nesse passo)";
        } else {
          const waId = await sendText(org.s, to, text);
          messageId = await recordOutbound(supabase, e.organization_id, convId, text, waId,
            { origem: "followup", sequence_id: seq.id, step_id: step.id });
        }
      }
    } catch (err) {
      const se = err instanceof SendError ? err : new SendError(err instanceof Error ? err.message : "Erro", null, "recipient");
      console.error(`[followup] ${e.id}:`, se.code, se.message);
      if (se.scope === "retry") {
        await supabase.from("followup_enrollments")
          .update({ next_run_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() })
          .eq("id", e.id);
        continue;
      }
      if (se.scope === "campaign") {
        await log(supabase, e, step.id, "failed", null, se.message);
        await stop(supabase, e.id, "erro", se.message);
        continue;
      }
      outcome = "failed";
      detail = se.message;
    }

    await log(supabase, e, step.id, outcome, messageId, detail);
    if (outcome === "sent") sent++;

    const nextIndex = e.current_step + 1;
    const nextStep = seq.steps[nextIndex];
    if (!nextStep) {
      await supabase.from("followup_enrollments").update({
        status: "concluido", current_step: nextIndex,
        last_sent_at: outcome === "sent" ? new Date().toISOString() : undefined,
      }).eq("id", e.id);
    } else {
      await supabase.from("followup_enrollments").update({
        current_step: nextIndex,
        next_run_at: new Date(Date.now() + nextStep.delay_hours * 3600 * 1000).toISOString(),
        ...(outcome === "sent" ? { last_sent_at: new Date().toISOString() } : {}),
      }).eq("id", e.id);
    }

    await sleep(1500 + Math.random() * 2500);
  }

  return json({ enrolled, processed: due?.length ?? 0, sent, ms: Date.now() - started });
});

async function stop(supabase: any, id: string, status: string, reason: string | null) {
  await supabase.from("followup_enrollments").update({ status, stop_reason: reason }).eq("id", id);
}

async function log(supabase: any, e: any, stepId: string, status: string, messageId: string | null, detail: string | null) {
  await supabase.from("followup_sends").insert({
    organization_id: e.organization_id, enrollment_id: e.id, step_id: stepId, status, message_id: messageId, detail,
  });
}
