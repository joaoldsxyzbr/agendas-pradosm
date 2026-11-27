import test from "node:test";
import assert from "node:assert/strict";
import { reviewNexelloOccurrences } from "../../worker/services/nexello-lifecycle.ts";
import type { LocalOccurrence, Observation, ReviewAction } from "../../worker/services/nexello-lifecycle.ts";
import type { NexelloAppointment } from "../../worker/services/nexello-agenda.ts";
const appointment: NexelloAppointment = {
  protocol: "123456", date: "2026-11-27", storeCode: "F01", startTime: "08:00",
  endTime: "09:00", supplier: "Fornecedor fictício", type: "Pedido", nfe: [], orders: ["00123"],
};
const current: LocalOccurrence = { id: "local-1", appointment, state: "aguardando", active: true, manual: false, closedDay: false };
const confirmed: Observation = { appointment, state: "confirmed" };
const action = (observed: Observation[], local: LocalOccurrence[]): ReviewAction | undefined =>
  reviewNexelloOccurrences(observed, local)[0]?.action;
test("absence or unknown external state never authorizes cancellation or insertion", () => {
  assert.equal(action([], [current]), "not_observed");
  assert.equal(action([{ ...confirmed, state: "unknown" }], []), "unverified");
  assert.equal(action([{ ...confirmed, state: "unknown" }], [current]), "unverified");
  assert.equal(action([{ ...confirmed, state: "pending" }], []), "not_eligible");
});
test("identical duplicates collapse but divergent documents and locations conflict", () => {
  assert.equal(action([confirmed, confirmed], []), "new_candidate");
  assert.equal(action([confirmed, { ...confirmed, appointment: { ...appointment, orders: ["02"] } }], []), "duplicate_conflict");
  assert.equal(action([confirmed, { ...confirmed, appointment: { ...appointment, storeCode: "F02" } }], []), "duplicate_conflict");
});
test("only explicit confirmation produces new, unchanged, update or move candidates", () => {
  assert.equal(action([confirmed], []), "new_candidate");
  assert.equal(action([confirmed], [current]), "unchanged");
  assert.equal(action([{ ...confirmed, appointment: { ...appointment, startTime: "08:30" } }], [current]), "update_candidate");
  assert.equal(action([{ ...confirmed, appointment: { ...appointment, date: "2026-11-28" } }], [current]), "move_candidate");
  assert.equal(action([{ ...confirmed, appointment: { ...appointment, storeCode: null } }], []), "unresolved_store");
});
test("cancel and move preserve operational conflicts", () => {
  const cancelled: Observation = { ...confirmed, state: "cancelled" };
  assert.equal(action([cancelled], [current]), "cancel_candidate");
  for (const row of [{ ...current, state: "recebido" as const }, { ...current, manual: true }, { ...current, closedDay: true }]) {
    assert.equal(action([cancelled], [row]), "local_conflict");
    assert.equal(action([{ ...confirmed, appointment: { ...appointment, date: "2026-11-28" } }], [row]), "local_conflict");
  }
  assert.equal(action([confirmed], [current, { ...current, id: "local-2" }]), "local_conflict");
});
