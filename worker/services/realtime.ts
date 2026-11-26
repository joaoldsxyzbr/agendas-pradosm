import type { Env } from "../env.ts";
interface AgendaChangedInput {
  agendaId: string;
  storeId: string;
  date: string;
  reason: "status" | "exchanges" | "manual" | "day-status" | "import" | "observation";
}
import {
  REALTIME_PROTOCOL_VERSION
} from "../../shared/realtime.ts";
async function publishAgendaChanged(env: Env, input: AgendaChangedInput): Promise<boolean> {
  if (env.REALTIME_MODE !== "on") return false;
  const event = {
    version: REALTIME_PROTOCOL_VERSION,
    type: "agenda.changed",
    ...input
  };
  try {
    const hubId = env.REALTIME_HUB.idFromName("agenda-prado");
    const response = await env.REALTIME_HUB.get(hubId).fetch(
      new Request("https://realtime.internal/internal/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event)
      })
    );
    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "realtime_publish_failed",
          type: event.type,
          reason: event.reason,
          status: response.status
        })
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "realtime_publish_failed",
        type: event.type,
        reason: event.reason
      }),
      error
    );
    return false;
  }
}
async function revokeRealtimeUser(env: Env, userId: string, mode: "terminate" | "refresh" = "terminate"): Promise<boolean> {
  if (env.REALTIME_MODE !== "on") return false;
  try {
    const hubId = env.REALTIME_HUB.idFromName("agenda-prado");
    const response = await env.REALTIME_HUB.get(hubId).fetch(
      new Request("https://realtime.internal/internal/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, reconnect: mode === "refresh" })
      })
    );
    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "realtime_revoke_failed",
          status: response.status
        })
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({ event: "realtime_revoke_failed" }),
      error
    );
    return false;
  }
}
// Apenas sinal de invalidação; conteúdo e autorização continuam na API HTTP.
async function publishAvisosChanged(env: Env, avisoId: string): Promise<boolean> {
  if (env.REALTIME_MODE !== "on") return false;
  try {
    const rows = await env.DB.prepare("SELECT loja_id AS store_id FROM avisos_lojas WHERE aviso_id = ?").bind(avisoId).all<{ store_id: string | null }>();
    const lojas = rows.results ?? [];
    const storeIds = lojas.length ? lojas.map(row => row.store_id).filter(id => typeof id === "string") : null;
    const response = await env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName("agenda-prado")).fetch(new Request("https://realtime.internal/internal/publish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: REALTIME_PROTOCOL_VERSION, type: "avisos.changed", storeIds })
    }));
    if (!response.ok) console.error("realtime_avisos_publish_failed", { status: response.status });
    return response.ok;
  } catch {
    console.error("realtime_avisos_publish_failed");
    return false;
  }
}
export {
  publishAvisosChanged,
  publishAgendaChanged,
  revokeRealtimeUser
};