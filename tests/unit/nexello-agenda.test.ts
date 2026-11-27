import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNexelloAppointment, NexelloNormalizationError } from "../../worker/services/nexello-agenda.ts";

const fixture = {
  protocolo: 123456,
  data_agenda_inicio: "27/11/2026",
  hora_agendada: "08:00 - 09:30",
  filial_entrega: "F01 - Loja fictícia",
  fornecedor: "Fornecedor fictício",
  tipo: "Nota fiscal",
  nfe_numeros: "000123, 456, 000123",
  numero_pedido: "-",
};

test("Nexello normalizes only available import fields", () => {
  assert.deepEqual(normalizeNexelloAppointment(fixture), {
    protocol: "123456", date: "2026-11-27", startTime: "08:00", endTime: "09:30",
    storeCode: "F01", supplier: "Fornecedor fictício", type: "Nota fiscal",
    nfe: ["000123", "456"], orders: [],
  });
});

test("Nexello never guesses a dock or unmapped store", () => {
  assert.equal(normalizeNexelloAppointment({ ...fixture, filial_entrega: "CD" }).storeCode, null);
  assert.equal(normalizeNexelloAppointment({ ...fixture, filial_entrega: "Loja sem código" }).storeCode, null);
});

test("Nexello rejects invalid protocol, date, interval, type and documents", () => {
  for (const invalid of [
    { protocolo: 123 },
    { protocolo: Number.MAX_SAFE_INTEGER + 1 },
    { data_agenda_inicio: "31/02/2026" },
    { hora_agendada: "09:30 - 08:00" },
    { hora_agendada: "08:00" },
    { tipo: "Desconhecido" },
    { nfe_numeros: "123 x 456" },
    { numero_pedido: null },
  ]) assert.throws(() => normalizeNexelloAppointment({ ...fixture, ...invalid }), NexelloNormalizationError);
});
