import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { startRealtime, type RealtimeStatus } from "@/lib/realtime";
import type { Presence } from "@/features/receiving/model";

export function useReceivingRealtime(sessionId: string | undefined, selectedDate: string) {
  const client = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("off");
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);
  useEffect(() => {
    if (!sessionId) { setStatus("off"); return; }
    const refreshAgenda = () => void client.invalidateQueries({ queryKey: ["receiving", "agendas", selectedDateRef.current], exact: true });
    return startRealtime({
      onStatus: setStatus,
      onEvent(event, mode) {
        if (event.type === "realtime.ready") {
          void client.invalidateQueries({ queryKey: ["avisos"] });
          refreshAgenda();
          void client.invalidateQueries({ queryKey: ["receiving", "presence"], exact: true });
        } else if (event.type === "avisos.changed") {
          if (mode === "on") void client.invalidateQueries({ queryKey: ["avisos"] });
        } else if (event.type === "agenda.changed") {
          if (event.date === selectedDateRef.current) refreshAgenda();
        } else if (mode === "on" && event.type === "presence.snapshot") {
          client.setQueryData(["receiving", "presence"], event.stores);
        } else if (mode === "on" && event.type === "presence.changed") {
          client.setQueryData<Presence[]>(["receiving", "presence"], previous => {
            const next = new Map((previous ?? []).map(row => [row.storeId, row]));
            next.set(event.storeId, { storeId: event.storeId, status: event.status });
            return [...next.values()];
          });
        }
      }
    });
  }, [client, sessionId]);
  return status;
}
