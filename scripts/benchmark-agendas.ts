// Benchmark sintético e opcional: sem token, HTTP ou conexão com Cloudflare/D1 real.
// Node 22+ inclui node:sqlite (experimental em algumas versões).
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgendaSummaryRow } from "../worker/repositories/agendas.ts";
import { listAdminAgendas, listStoreAgendas } from "../worker/repositories/agendas.ts";

const quick = process.argv.includes("--quick");
const sizes = quick ? [40] : [162, 1_000, 5_000];
const stores = 10;
const appointmentsPerAgenda = 15;
const repetitions = quick ? 2 : 5;
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
const migrationsDir = fileURLToPath(new URL("../migrations-v2/", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter(name => /^\d{4}_[\w-]+\.sql$/.test(name))
  .sort();
for (const name of migrations) db.exec(readFileSync(join(migrationsDir, name), "utf8"));
const fixedNow = "2026-10-19T12:00:00.000Z";
for (let index = 0; index < stores; index++)
  db.prepare("INSERT INTO lojas (id,codigo,nome,criado_em,atualizado_em) VALUES (?,?,?,?,?)")
    .run(`l${index}`, String(index + 1).padStart(2, "0"), `Loja ${index + 1}`, fixedNow, fixedNow);
db.prepare("INSERT INTO usuarios (id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?)")
  .run("u1", "Admin sintético", "benchmark-local", "hash-ficticio", "admin", fixedNow, fixedNow);

const insertAgenda = db.prepare(`INSERT INTO agendas
  (id,loja_id,data_agenda,arquivo_original,criado_por,status_dia,criado_em,atualizado_em)
  VALUES (?,?,?,?,?,?,?,?)`);
const insertAppointment = db.prepare(`INSERT INTO agendamentos
  (id,agenda_id,protocolo,horario_inicio,horario_fim,fornecedor,ativo,status,origem,criado_em,atualizado_em)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
function dateAt(index: number): string {
  return new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
}
function addFixture(from: number, to: number): void {
  db.exec("BEGIN TRANSACTION");
  try {
    for (let i = from; i < to; i++) {
      const store = i % stores;
      const agenda = `a${i}`;
      const date = dateAt(Math.floor(i / stores));
      insertAgenda.run(agenda, `l${store}`, date, "agenda.csv", "u1", "aberto", fixedNow, fixedNow);
      for (let j = 0; j < appointmentsPerAgenda; j++) {
        const status = ["aguardando", "recebido", "nao_chegou", "recusado"][j % 4];
        insertAppointment.run(`p${i}-${j}`, agenda, `P${j}`, String(j).padStart(2, "0") + ":00",
          String(j).padStart(2, "0") + ":30", `Fornecedor ${j}`, 1, status,
          j % 7 === 0 ? "manual" : "importado", fixedNow, fixedNow);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Adaptador restrito ao contrato .prepare().bind().all() do D1.
// Roda as próprias consultas do repositório, não cópias de SQL.
type RecordedQuery = { sql: string; values: SQLInputValue[] };
function sqliteValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  throw new TypeError("Valor SQL não suportado pelo benchmark de leitura.");
}
let lastQuery: RecordedQuery | null = null;
const adapter = {
  prepare(sql: string) {
    const statement = db.prepare(sql);
    const query: RecordedQuery = { sql, values: [] };
    lastQuery = query;
    const prepared: D1PreparedStatement = {
      bind(...params: unknown[]) {
        query.values = params.map(sqliteValue);
        lastQuery = query;
        return prepared;
      },
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        return (statement.get(...query.values) as T | undefined) ?? null;
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        return { success: true, results: statement.all(...query.values) as T[] };
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const result = statement.run(...query.values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async raw<T = unknown>(): Promise<T[]> { throw new Error("Benchmark usa somente consultas all()."); }
    };
    return prepared;
  }
} as D1Database;
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function measure(label: string, fn: () => Promise<AgendaSummaryRow[]>, expected: number) {
  await fn(); // aquecimento sem contabilizar
  const ms = [];
  for (let i = 0; i < repetitions; i++) {
    const start = performance.now();
    const rows = await fn();
    ms.push(performance.now() - start);
    assert.equal(rows.length, expected, `Quantidade inesperada em ${label}`);
  }
  if (!lastQuery) throw new Error("Nenhuma consulta foi executada pelo benchmark.");
  const plan = db.prepare("EXPLAIN QUERY PLAN " + lastQuery.sql).all(...lastQuery.values);
  return {
    scenario: label,
    count: expected,
    median_ms: Number(median(ms).toFixed(2)),
    uses_temporary_sort: plan.some(row => /USE TEMP B-TREE/.test(String(row.detail))),
    plan: plan.map(row => String(row.detail))
  };
}

let previous = 0;
for (const total of sizes) {
  addFixture(previous, total);
  previous = total;
  const latestDate = dateAt(Math.floor((total - 1) / stores));
  const expectedDateRows = total - (Math.floor((total - 1) / stores) * stores);
  const cases = [
    await measure("ADM sem filtros", () => listAdminAgendas(adapter), total),
    await measure("ADM filtrado por data", () => listAdminAgendas(adapter, { date: latestDate }), expectedDateRows),
    await measure("Conferente/loja", () => listStoreAgendas(adapter, "l0"), Math.ceil(total / stores))
  ];
  console.log(JSON.stringify({
    agendas: total,
    appointments: total * appointmentsPerAgenda,
    stores,
    engine: "node:sqlite (local; NÃO Cloudflare D1)",
    cases
  }, null, 2));
}
db.close();
