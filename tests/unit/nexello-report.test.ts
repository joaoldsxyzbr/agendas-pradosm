import test from "node:test";
import assert from "node:assert/strict";
import { readNexelloReportPage, NexelloReportError } from "../../worker/services/nexello-report.ts";

const sample = { data: [{ protocolo: 123456 }], page: 1, per_page: 2, last_page: 1, total: 1 };
const mockPage = (value: unknown): typeof fetch => async () =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const hasCode = (code: string) => (error: unknown) =>
  error instanceof NexelloReportError && error.code === code;

test("Nexello uses fixed HTTPS origin, GET, documented pagination and no redirects", async () => {
  const result = await readNexelloReportPage("fake-token", 60, 1, 2, async (input, init) => {
    assert.equal(String(input), "https://integracao-organiza.nexello.com.br/integracao/api/v2/relatorio-personalizado/60?limit=2&page=1");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fake-token");
    return new Response(JSON.stringify(sample));
  });
  assert.deepEqual(result, sample);
});

test("Nexello rejects invalid configuration and page before network access", async () => {
  const never: typeof fetch = async () => { throw new Error("unexpected fetch"); };
  await assert.rejects(readNexelloReportPage("", 60, 1, 2, never), hasCode("CONFIG_INVALIDA"));
  await assert.rejects(readNexelloReportPage("token", 60, 0, 2, never), hasCode("CONSULTA_INVALIDA"));
  await assert.rejects(readNexelloReportPage("token", 60, 1, 101, never), hasCode("CONSULTA_INVALIDA"));
});

test("Nexello validates page metadata, records and empty results", async () => {
  for (const invalid of [
    { ...sample, data: [] },
    { ...sample, data: [null] },
    { ...sample, page: 2 },
    { ...sample, per_page: 1 },
    { ...sample, last_page: 2 },
  ]) {
    await assert.rejects(readNexelloReportPage("token", 60, 1, 2, mockPage(invalid)), hasCode("RESPOSTA_INVALIDA"));
  }
  const empty = { ...sample, total: 0, data: [] };
  assert.deepEqual(await readNexelloReportPage("token", 60, 1, 2, mockPage(empty)), empty);
});

test("Nexello returns sanitized errors without upstream content", async () => {
  await assert.rejects(readNexelloReportPage("token", 60, 1, 2, async () =>
    new Response("sensitive", { status: 429 })), (error: unknown) =>
      error instanceof NexelloReportError && error.status === 429 && !error.message.includes("sensitive"));
  await assert.rejects(readNexelloReportPage("token", 60, 1, 2, async () =>
    { throw new Error("sensitive"); }), hasCode("TRANSPORTE"));
  await assert.rejects(readNexelloReportPage("token", 60, 1, 2, async () =>
    new Response("invalid json")), hasCode("RESPOSTA_INVALIDA"));
  await assert.rejects(readNexelloReportPage("token", 60, 1, 2, async () =>
    new Response("x".repeat(1_048_577))), hasCode("RESPOSTA_GRANDE"));
});
