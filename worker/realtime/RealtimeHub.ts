import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import type { Env } from "../env.ts";
import {
  REALTIME_PROTOCOL_VERSION, isAgendaChangedReason
} from "../../shared/realtime.ts";
const PRESENCE_STALE_MS = 12e4;
const MAX_CLIENT_MESSAGE_BYTES = 2048;
const roleSchema = z.enum(["admin", "visualizador", "conferente"]);
const livePresenceSchema = z.enum(["online", "away"]);
const attachmentSchema = z.object({
  userId: z.string(), role: roleSchema, storeId: z.string().nullable(),
  connectedAt: z.string(), sessionExpiresAt: z.number(),
  presenceStatus: livePresenceSchema.nullable(), lastPresenceAt: z.number().nullable()
});
type SocketAttachment = z.infer<typeof attachmentSchema>;
type PresenceStatus = "online" | "away" | "offline";
const agendaEventSchema = z.object({
  version: z.literal(REALTIME_PROTOCOL_VERSION), type: z.literal("agenda.changed"),
  agendaId: z.string(), storeId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().refine(isAgendaChangedReason)
});
type AgendaEvent = z.infer<typeof agendaEventSchema>;
const avisosEventSchema = z.object({
  version: z.literal(REALTIME_PROTOCOL_VERSION), type: z.literal("avisos.changed"),
  storeIds: z.array(z.string()).nullable()
});
const revokeSchema = z.object({ userId: z.string().min(1), reconnect: z.boolean().optional() });
const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ version: z.literal(REALTIME_PROTOCOL_VERSION), type: z.literal("presence.heartbeat") }),
  z.object({ version: z.literal(REALTIME_PROTOCOL_VERSION), type: z.literal("presence.set"), status: livePresenceSchema })
]);
function connectionTag(prefix: "role" | "user" | "store", value: string): string {
  return `${prefix}:${value}`;
}
function parseAgendaChangedEvent(value: unknown): AgendaEvent | null {
  const parsed = agendaEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
function parseClientMessage(message: string) {
  if (new TextEncoder().encode(message).byteLength > MAX_CLIENT_MESSAGE_BYTES) return null;
  try {
    const decoded: unknown = JSON.parse(message);
    const parsed = clientMessageSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
class RealtimeHub extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }
  override async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/internal/publish") {
      const raw: unknown = await request.json().catch(() => null);
      const avisos = avisosEventSchema.safeParse(raw);
      if (avisos.success) {
        this.broadcastAvisosChanged(avisos.data.storeIds);
        return new Response(null, { status: 204 });
      }
      const event = parseAgendaChangedEvent(raw);
      if (!event) {
        return new Response("Invalid realtime event.", { status: 400 });
      }
      this.broadcastDashboardEvent(event);
      console.log(
        JSON.stringify({
          event: "dashboard_event_published",
          protocolVersion: REALTIME_PROTOCOL_VERSION,
          type: event.type,
          reason: event.reason
        })
      );
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && url.pathname === "/internal/revoke") {
      const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return new Response("Invalid realtime revoke request.", { status: 400 });
      }
      const body = parsed.data;
      const revoked = /* @__PURE__ */ new Set<WebSocket>();
      const affectedStores = /* @__PURE__ */ new Set<string>();
      for (const ws of this.ctx.getWebSockets(connectionTag("user", body.userId))) {
        const attachment2 = this.attachment(ws);
        revoked.add(ws);
        if (attachment2?.role === "conferente" && attachment2.storeId) {
          affectedStores.add(attachment2.storeId);
        }
        ws.close(
          body.reconnect ? 4004 : 4003,
          body.reconnect ? "Identidade realtime atualizada." : "Sess\xE3o realtime revogada."
        );
      }
      for (const storeId2 of affectedStores) {
        this.broadcastPresence(storeId2, revoked);
      }
      await this.ensureAlarm(revoked);
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required.", { status: 426 });
    }
    const userId = request.headers.get("X-Agenda-Realtime-User-Id");
    const role = request.headers.get("X-Agenda-Realtime-Role");
    const storeId = request.headers.get("X-Agenda-Realtime-Store-Id") || null;
    const sessionExpiresAtSeconds = Number(
      request.headers.get("X-Agenda-Realtime-Session-Exp")
    );
    if (!userId || !Number.isInteger(sessionExpiresAtSeconds) || sessionExpiresAtSeconds <= Math.floor(Date.now() / 1e3) || role !== "admin" && role !== "visualizador" && role !== "conferente" || role === "conferente" && !storeId) {
      return new Response("Invalid realtime identity.", { status: 400 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const now = Date.now();
    const attachment: SocketAttachment = {
      userId,
      role,
      storeId,
      connectedAt: new Date(now).toISOString(),
      sessionExpiresAt: sessionExpiresAtSeconds * 1e3,
      presenceStatus: null,
      lastPresenceAt: role === "conferente" ? now : null
    };
    server.serializeAttachment(attachment);
    const tags = [
      connectionTag("role", role),
      connectionTag("user", userId)
    ];
    if (storeId) tags.push(connectionTag("store", storeId));
    this.ctx.acceptWebSocket(server, tags);
    const ready = {
      version: REALTIME_PROTOCOL_VERSION,
      type: "realtime.ready"
    };
    server.send(JSON.stringify(ready));
    if (role === "admin" || role === "visualizador") {
      const snapshot = {
        version: REALTIME_PROTOCOL_VERSION,
        type: "presence.snapshot",
        stores: this.presenceSnapshot()
      };
      server.send(JSON.stringify(snapshot));
    }
    await this.ensureAlarm();
    console.log(
      JSON.stringify({
        event: "websocket_connected",
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        role,
        hasStore: Boolean(storeId)
      })
    );
    return new Response(null, { status: 101, webSocket: client });
  }
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string" && message === "ping") {
      return;
    }
    const attachment = this.attachment(ws);
    if (!attachment || attachment.role !== "conferente" || !attachment.storeId) {
      this.rejectMessage(ws);
      return;
    }
    if (typeof message !== "string") {
      this.rejectMessage(ws);
      return;
    }
    const parsed = parseClientMessage(message);
    if (!parsed) {
      this.rejectMessage(ws);
      return;
    }
    const now = Date.now();
    attachment.lastPresenceAt = now;
    if (parsed.type === "presence.set") {
      attachment.presenceStatus = parsed.status;
    }
    ws.serializeAttachment(attachment);
    await this.ensureAlarm();
    if (parsed.type === "presence.set") {
      this.broadcastPresence(attachment.storeId);
    }
  }
  override async webSocketClose(ws: WebSocket, code: number, _reason: string) {
    const attachment = this.attachment(ws);
    if (attachment?.role === "conferente" && attachment.storeId) {
      this.broadcastPresence(attachment.storeId, /* @__PURE__ */ new Set([ws]));
      await this.ensureAlarm(/* @__PURE__ */ new Set([ws]));
    }
    console.log(
      JSON.stringify({
        event: "websocket_disconnected",
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        role: attachment?.role ?? "unknown",
        code
      })
    );
  }
  override async webSocketError(ws: WebSocket) {
    const attachment = this.attachment(ws);
    if (attachment?.role === "conferente" && attachment.storeId) {
      this.broadcastPresence(attachment.storeId, /* @__PURE__ */ new Set([ws]));
      await this.ensureAlarm(/* @__PURE__ */ new Set([ws]));
    }
    console.error(
      JSON.stringify({
        event: "websocket_error",
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        role: attachment?.role ?? "unknown"
      })
    );
    ws.close(1011, "Erro na conex\xE3o realtime.");
  }
  override async alarm() {
    const now = Date.now();
    const expired = /* @__PURE__ */ new Set<WebSocket>();
    const stale = /* @__PURE__ */ new Set<WebSocket>();
    const affectedStores = /* @__PURE__ */ new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.attachment(ws);
      if (!attachment) continue;
      if (now >= attachment.sessionExpiresAt) {
        expired.add(ws);
        if (attachment.role === "conferente" && attachment.storeId) {
          affectedStores.add(attachment.storeId);
        }
        continue;
      }
      if (attachment.role !== "conferente" || !attachment.storeId) continue;
      const lastSeen = this.connectionLastSeen(ws, attachment);
      if (!Number.isFinite(lastSeen) || now - lastSeen >= PRESENCE_STALE_MS) {
        stale.add(ws);
        affectedStores.add(attachment.storeId);
      }
    }
    for (const ws of expired) {
      ws.close(4003, "Sess\xE3o realtime expirada.");
    }
    for (const ws of stale) {
      ws.close(4001, "Presen\xE7a realtime expirada.");
    }
    const excluded = /* @__PURE__ */ new Set([...expired, ...stale]);
    for (const storeId of affectedStores) {
      this.broadcastPresence(storeId, excluded);
    }
    await this.ensureAlarm(excluded);
  }
  attachment(ws: WebSocket): SocketAttachment | null {
    const parsed = attachmentSchema.safeParse(ws.deserializeAttachment());
    return parsed.success ? parsed.data : null;
  }
  rejectMessage(ws: WebSocket) {
    console.warn(
      JSON.stringify({
        event: "invalid_realtime_message",
        protocolVersion: REALTIME_PROTOCOL_VERSION
      })
    );
    ws.close(1008, "Mensagem realtime n\xE3o suportada.");
  }
  connectionLastSeen(ws: WebSocket, attachment: SocketAttachment) {
    const presenceSeen = attachment.lastPresenceAt ?? Date.parse(attachment.connectedAt);
    const autoResponseSeen = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? Number.NaN;
    if (!Number.isFinite(presenceSeen)) return autoResponseSeen;
    if (!Number.isFinite(autoResponseSeen)) return presenceSeen;
    return Math.max(presenceSeen, autoResponseSeen);
  }
  storePresence(storeId: string, excluded = /* @__PURE__ */ new Set<WebSocket>()): PresenceStatus {
    const now = Date.now();
    let status: PresenceStatus = "offline";
    for (const ws of this.ctx.getWebSockets(connectionTag("store", storeId))) {
      if (excluded.has(ws)) continue;
      const attachment = this.attachment(ws);
      if (attachment?.role !== "conferente" || attachment.storeId !== storeId || !attachment.presenceStatus) {
        continue;
      }
      const lastSeen = this.connectionLastSeen(ws, attachment);
      if (!Number.isFinite(lastSeen) || now - lastSeen >= PRESENCE_STALE_MS) {
        continue;
      }
      if (attachment.presenceStatus === "online") {
        return "online";
      }
      status = "away";
    }
    return status;
  }
  presenceSnapshot() {
    const stores = /* @__PURE__ */ new Set<string>();
    for (const ws of this.ctx.getWebSockets(connectionTag("role", "conferente"))) {
      const attachment = this.attachment(ws);
      if (attachment?.storeId) stores.add(attachment.storeId);
    }
    return [...stores].map((storeId) => ({
      storeId,
      status: this.storePresence(storeId)
    }));
  }
  broadcastPresence(storeId: string, excluded = /* @__PURE__ */ new Set<WebSocket>()) {
    const event = JSON.stringify({
      version: REALTIME_PROTOCOL_VERSION,
      type: "presence.changed",
      storeId,
      status: this.storePresence(storeId, excluded)
    });
    for (const role of ["admin", "visualizador"]) {
      for (const ws of this.ctx.getWebSockets(connectionTag("role", role))) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(event);
        }
      }
    }
  }
  broadcastAvisosChanged(storeIds: string[] | null) {
    const payload = JSON.stringify({ version: REALTIME_PROTOCOL_VERSION, type: "avisos.changed" });
    const sockets = [...this.ctx.getWebSockets(connectionTag("role", "admin")), ...this.ctx.getWebSockets(connectionTag("role", "conferente"))];
    for (const ws of sockets) {
      const identity = this.attachment(ws);
      if (!identity || Date.now() >= identity.sessionExpiresAt || ws.readyState !== WebSocket.OPEN) continue;
      if (identity.role === "admin" || (identity.role === "conferente" && (storeIds === null || (identity.storeId !== null && storeIds.includes(identity.storeId))))) {
        try { ws.send(payload); } catch { /* HTTP mantém reconciliação. */ }
      }
    }
  }
  broadcastDashboardEvent(event: AgendaEvent) {
    const payload = JSON.stringify(event);
    for (const role of ["admin", "visualizador"]) {
      for (const ws of this.ctx.getWebSockets(connectionTag("role", role))) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    }
  }
  async ensureAlarm(excluded = /* @__PURE__ */ new Set<WebSocket>()) {
    let nextAlarm: number | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      if (excluded.has(ws)) continue;
      const attachment = this.attachment(ws);
      if (!attachment) continue;
      nextAlarm = nextAlarm === null ? attachment.sessionExpiresAt : Math.min(nextAlarm, attachment.sessionExpiresAt);
      if (attachment.role !== "conferente") continue;
      const lastSeen = this.connectionLastSeen(ws, attachment);
      if (!Number.isFinite(lastSeen)) continue;
      const presenceDue = lastSeen + PRESENCE_STALE_MS;
      nextAlarm = Math.min(nextAlarm, presenceDue);
    }
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (nextAlarm === null) {
      if (currentAlarm !== null) {
        await this.ctx.storage.deleteAlarm();
      }
      return;
    }
    if (currentAlarm === null || nextAlarm !== currentAlarm) {
      await this.ctx.storage.setAlarm(nextAlarm);
    }
  }
}
export {
  RealtimeHub
};