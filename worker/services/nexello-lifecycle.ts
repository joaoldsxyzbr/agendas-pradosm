import type { NexelloAppointment } from "./nexello-agenda.ts";

export type ExternalState = "unknown" | "pending" | "confirmed" | "cancelled" | "rejected";
export type LocalState = "aguardando" | "recebido" | "nao_chegou" | "recusado";
export interface LocalOccurrence {
  id: string;
  appointment: NexelloAppointment;
  state: LocalState;
  active: boolean;
  manual: boolean;
  closedDay: boolean;
}
export interface Observation {
  appointment: NexelloAppointment;
  state: ExternalState;
}
export type ReviewAction =
  "unverified" | "unresolved_store" | "duplicate_conflict" |
  "not_eligible" | "new_candidate" | "unchanged" | "update_candidate" |
  "move_candidate" | "cancel_candidate" | "local_conflict" | "not_observed";
export interface ReviewItem {
  protocol: string;
  action: ReviewAction;
  localIds: string[];
}

/** Read-only classification. A candidate never authorizes a write.
 * The report 60 adapter cannot prove external state: pass unknown. */
export function appointmentFingerprint(a: NexelloAppointment): string {
  return JSON.stringify([
    a.protocol, a.date, a.storeCode, a.startTime, a.endTime, a.supplier, a.type,
    [...new Set(a.nfe)].sort(), [...new Set(a.orders)].sort(),
  ]);
}

export function reviewNexelloOccurrences(
  observed: readonly Observation[],
  local: readonly LocalOccurrence[],
): ReviewItem[] {
  const incoming = new Map<string, Observation[]>();
  const existing = new Map<string, LocalOccurrence[]>();
  for (const row of observed) {
    const key = row.appointment.protocol;
    const group = incoming.get(key) ?? [];
    group.push(row);
    incoming.set(key, group);
  }
  for (const row of local) {
    const key = row.appointment.protocol;
    const group = existing.get(key) ?? [];
    group.push(row);
    existing.set(key, group);
  }
  const protocols = [...new Set([...incoming.keys(), ...existing.keys()])].sort();
  return protocols.map(protocol => {
    const source = incoming.get(protocol) ?? [];
    const candidates = existing.get(protocol) ?? [];
    const localIds = candidates.map(row => row.id).sort();
    const first = source[0];
    const current = candidates[0];
    let action: ReviewAction;
    if (!first) action = "not_observed";
    else if (source.some(row => row.state !== first.state ||
      appointmentFingerprint(row.appointment) !== appointmentFingerprint(first.appointment))) action = "duplicate_conflict";
    else if (candidates.length > 1) action = "local_conflict";
    else if (first.state === "unknown") action = "unverified";
    else if (first.state === "pending" || first.state === "rejected") action = "not_eligible";
    else if (first.state === "cancelled") {
      if (!current || !current.active) action = "not_eligible";
      else if (current.manual || current.closedDay || current.state !== "aguardando" ||
        current.appointment.date !== first.appointment.date ||
        current.appointment.storeCode !== first.appointment.storeCode ||
        first.appointment.storeCode === null) action = "local_conflict";
      else action = "cancel_candidate";
    } else if (!first.appointment.storeCode) action = "unresolved_store";
    else if (!current) action = "new_candidate";
    else if (current.manual || !current.active) action = "local_conflict";
    else if (appointmentFingerprint(current.appointment) === appointmentFingerprint(first.appointment)) action = "unchanged";
    else if (current.closedDay || current.state !== "aguardando") action = "local_conflict";
    else if (current.appointment.date !== first.appointment.date ||
      current.appointment.storeCode !== first.appointment.storeCode) action = "move_candidate";
    else action = "update_candidate";
    return { protocol, action, localIds };
  });
}
