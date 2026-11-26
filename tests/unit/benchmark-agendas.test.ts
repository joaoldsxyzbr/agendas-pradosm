import { z } from "zod";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

describe("Benchmark SQL sintético nativo", () => {
  it("executa as consultas reais sem conectar no D1 remoto", () => {
    const execution = spawnSync(process.execPath,
      // fileURLToPath: no Windows, URL.pathname vira "/C:/..." e quebra a resolucao do modulo.
      ["--no-warnings", fileURLToPath(new URL("../../scripts/benchmark-agendas.mjs", import.meta.url)), "--quick"],
      { encoding: "utf8", timeout: 30_000 });
    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    const output = z.object({
      agendas: z.number(), appointments: z.number(), engine: z.string(),
      schema_migrations: z.number(),
      repetitions: z.number(), notice_rows: z.number(),
      cases: z.array(z.object({ count: z.number(), median_ms: z.number(), p95_ms: z.number(), statements: z.number(), plan: z.array(z.string()) })),
      reports: z.array(z.object({ count: z.number(), median_ms: z.number(), p95_ms: z.number(), statements: z.number(), plans: z.array(z.array(z.string())) })),
      notices: z.array(z.object({ count: z.number(), median_ms: z.number(), p95_ms: z.number(), statements: z.number(), plans: z.array(z.array(z.string())) }))
    }).parse(JSON.parse(execution.stdout));
    assert.equal(output.agendas, 40);
    assert.equal(output.appointments, 600);
    assert.equal(output.engine.includes("local"), true);
    assert.ok(output.schema_migrations >= 26);
    assert.deepEqual(output.cases.map(c => c.count), [40, 10, 4, 20, 20, 4, 20, 4]);
    assert.ok(output.cases.every(c => c.median_ms >= 0));
    assert.ok(output.cases.every(c => Array.isArray(c.plan) && c.plan.length > 0));
    assert.equal(output.notice_rows, 80);
    assert.deepEqual(output.reports.map(c=>c.count), [40,50,50,40]);
    assert.deepEqual(output.reports.map(c=>c.statements), [3,2,2,2]);
    assert.deepEqual(output.notices.map(c=>c.count), [50,10,20]);
    assert.deepEqual(output.notices.map(c=>c.statements), [2,2,2]);
    assert.ok([...output.reports,...output.notices].every(c=>c.plans.length===c.statements && c.plans.every(p=>p.length>0) && c.p95_ms>=0));
  });
});
