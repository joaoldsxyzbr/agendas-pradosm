import { apiFetch } from "@/lib/api";
import { realtimeConfigSchema, realtimeEventSchema, type RealtimeEvent, type RealtimeMode } from "../../../../shared/realtime.ts";

export type RealtimeStatus = "off" | "connecting" | "connected" | "reconnecting";
type Send = (message: string) => boolean;
interface RealtimeHandlers {
  onStatus: (status: RealtimeStatus) => void;
  onEvent: (event: RealtimeEvent, mode: RealtimeMode) => void;
  onOpen?: (send: Send) => void;
  onDisconnect?: () => void;
}
const delays = [1_000, 2_000, 5_000, 10_000, 30_000];

// Um ciclo de vida compartilhado. O polling HTTP permanece como fallback.
export function startRealtime(handlers: RealtimeHandlers): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let mode: RealtimeMode = "off";
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  const configAbort = new AbortController();
  const clearConnectionTimers = () => {
    clearTimeout(readyTimer); clearInterval(pingTimer); clearTimeout(pongTimer);
    readyTimer = undefined; pingTimer = undefined; pongTimer = undefined;
  };
  const close = (ws: WebSocket, code: number, reason: string) => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try { ws.close(code, reason); } catch { /* conexão já encerrada */ }
    }
  };
  function scheduleReconnect() {
    if (stopped || mode === "off" || reconnect !== undefined) return;
    handlers.onStatus("reconnecting");
    const delay = delays[Math.min(attempt++, delays.length - 1)] ?? 30_000;
    reconnect = setTimeout(() => { reconnect = undefined; connect(); }, Math.round(delay * (0.8 + Math.random() * 0.2)));
  }
  function connect() {
    if (stopped || mode === "off") return;
    clearConnectionTimers();
    handlers.onStatus("connecting");
    const url = new URL("/api/realtime", window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let ws: WebSocket;
    try { ws = new WebSocket(url.toString()); } catch { scheduleReconnect(); return; }
    socket = ws;
    const active = () => !stopped && socket === ws;
    const disconnect = (code: number) => {
      if (!active()) return;
      socket = null; clearConnectionTimers(); handlers.onDisconnect?.();
      if (code === 4003) { mode = "off"; handlers.onStatus("off"); }
      else scheduleReconnect();
    };
    const fail = (code: number, reason: string) => {
      if (!active()) return;
      close(ws, code, reason); disconnect(code);
    };
    const send: Send = message => {
      if (!active() || ws.readyState !== WebSocket.OPEN) return false;
      try { ws.send(message); return true; } catch { fail(4002, "Falha de conexão"); return false; }
    };
    readyTimer = setTimeout(() => fail(4000, "Realtime sem resposta"), 15_000);
    ws.onopen = () => {
      if (!active()) return;
      handlers.onOpen?.(send);
      if (!active()) return;
      pingTimer = setInterval(() => {
        if (!send("ping")) return;
        clearTimeout(pongTimer);
        pongTimer = setTimeout(() => fail(4000, "Realtime sem resposta"), 10_000);
      }, 30_000);
    };
    ws.onmessage = message => {
      if (!active()) return;
      if (message.data === "pong") { clearTimeout(pongTimer); pongTimer = undefined; return; }
      if (typeof message.data !== "string") return;
      let raw: unknown;
      try { raw = JSON.parse(message.data); } catch { return; }
      const parsed = realtimeEventSchema.safeParse(raw);
      if (!parsed.success) return;
      if (parsed.data.type === "realtime.ready") {
        clearTimeout(readyTimer); readyTimer = undefined; attempt = 0;
        handlers.onStatus("connected");
      }
      handlers.onEvent(parsed.data, mode);
    };
    ws.onclose = event => disconnect(event.code);
    ws.onerror = () => fail(4002, "Falha de conexão");
  }
  void (async () => {
    try {
      const config = realtimeConfigSchema.parse(await apiFetch<unknown>("/api/realtime/config", { signal: configAbort.signal }));
      if (stopped) return;
      mode = config.mode;
      if (mode === "off") handlers.onStatus("off"); else connect();
    } catch { if (!stopped) handlers.onStatus("off"); }
  })();
  return () => {
    stopped = true; configAbort.abort(); clearTimeout(reconnect); clearConnectionTimers();
    handlers.onDisconnect?.();
    if (socket) close(socket, 1000, "Página encerrada");
    socket = null;
  };
}
