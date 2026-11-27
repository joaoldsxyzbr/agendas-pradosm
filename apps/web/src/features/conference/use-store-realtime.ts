import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { startRealtime, type RealtimeStatus } from "@/lib/realtime";
import { apiFetch } from "@/lib/api";

export type StoreRealtimeStatus = RealtimeStatus;

// Presenca do conferente para os paineis do admin. O servidor ja expoe as duas
// vias; este hook passa a alimenta-las:
// - WebSocket presence.set: o RealtimeHub retransmite presence.changed em tempo real.
// - REST /api/store/presence: mantem o polling de 30s do Recebimento coerente com o
//   WebSocket (mesma janela de interacao do worker/lib/presence.ts).
const PRESENCE_REPORT_MS = 30_000;
const PRESENCE_ONLINE_MS = 3 * 60_000;
type LivePresenceStatus = "online" | "away";

function presenceSetMessage(status: LivePresenceStatus) {
  return JSON.stringify({ version: 1, type: "presence.set", status });
}

export function useStoreRealtime(selectedDate: string) {
  const client = useQueryClient();
  const [status, setStatus] = useState<StoreRealtimeStatus>("off");
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);
  const sendRef = useRef<(message: string) => boolean>(() => false);
  const lastInteractionRef = useRef(Date.now());
  const lastSentPresenceRef = useRef<LivePresenceStatus | null>(null);
  const restReportedRef = useRef(false);

  const currentPresence = (): LivePresenceStatus =>
    document.hidden || Date.now() - lastInteractionRef.current > PRESENCE_ONLINE_MS ? "away" : "online";
  const userInteracted = () => Date.now() - lastInteractionRef.current <= PRESENCE_ONLINE_MS;
  const pushPresence = () => {
    const next = currentPresence();
    if (next === lastSentPresenceRef.current) return;
    if (sendRef.current(presenceSetMessage(next))) lastSentPresenceRef.current = next;
  };
  const reportRestPresence = (interacted: boolean) => {
    restReportedRef.current = true;
    void apiFetch("/api/store/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interacted }),
    }).catch(() => undefined); // Best-effort: o painel do admin mantem o polling REST.
  };
  const clearRestPresence = (keepalive: boolean) => {
    if (!restReportedRef.current) return;
    restReportedRef.current = false;
    void apiFetch("/api/store/presence", { method: "DELETE", ...(keepalive ? { keepalive: true } : {}) })
      .catch(() => undefined);
  };

  useEffect(() => {
    const refreshAgenda = () => void client.invalidateQueries({ queryKey: ["conference", "agenda", selectedDateRef.current] });
    return startRealtime({
      onStatus: setStatus,
      onOpen(send) {
        sendRef.current = send;
        const initial = currentPresence();
        if (send(presenceSetMessage(initial))) lastSentPresenceRef.current = initial;
      },
      onDisconnect() {
        sendRef.current = () => false;
        lastSentPresenceRef.current = null;
      },
      onEvent(event, mode) {
        if (event.type === "realtime.ready") {
          refreshAgenda();
          void client.invalidateQueries({ queryKey: ["avisos"] });
        } else if (event.type === "avisos.changed" && mode === "on") {
          void client.invalidateQueries({ queryKey: ["avisos"] });
        } else if (event.type === "agenda.changed" && event.date === selectedDateRef.current) {
          refreshAgenda();
        }
      }
    });
  }, [client]);

  // Sinal de presenca: atividade recente define online; heartbeat REST a cada
  // 30s e saida no pagehide mantem o D1 coerente com o WebSocket.
  useEffect(() => {
    let cancelled = false;
    let reportTimer: number | null = null;
    const markInteraction = () => { lastInteractionRef.current = Date.now(); };
    const report = () => {
      if (cancelled) return;
      reportRestPresence(userInteracted());
      pushPresence();
    };
    const onPageHide = () => { if (!cancelled) clearRestPresence(true); };
    document.addEventListener("pointerdown", markInteraction, { passive: true });
    document.addEventListener("keydown", markInteraction, { passive: true });
    document.addEventListener("visibilitychange", report);
    window.addEventListener("pagehide", onPageHide);
    report();
    reportTimer = window.setInterval(report, PRESENCE_REPORT_MS);
    return () => {
      cancelled = true;
      if (reportTimer !== null) window.clearInterval(reportTimer);
      document.removeEventListener("pointerdown", markInteraction);
      document.removeEventListener("keydown", markInteraction);
      document.removeEventListener("visibilitychange", report);
      window.removeEventListener("pagehide", onPageHide);
      clearRestPresence(false);
    };
  }, []);

  return status;
}
