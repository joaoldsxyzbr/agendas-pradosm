// Benchmark sintético e opcional: sem token, HTTP ou conexão com Cloudflare/D1 real.
// Node 22+ inclui node:sqlite (experimental em algumas versões).
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgendaSummaryRow } from "../worker/repositories/agendas.ts";
import { listAdminAgendas, listStoreAgendas, listAdminAgendasPage, listStoreAgendasPage } from "../worker/repositories/agendas.ts";

const quick = process.argv.includes("--quick");
const sizes = quick ? [40] : [162, 1_000, 5_000];
const stores = 10;
const appointmentsPerAgenda = 15;
const repetitions = quick ? 2 : 5;
const db = new DatabaseSync(":memory:");
// Usa o esquema real, não uma cópia simplificada que pode divergir da produção.
db.exec("PRAGMA foreign_keys = ON");
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrations = readdirSync(migrationsDir).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
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
  (id,agenda_id,protocolo,fornecedor,ativo,status,origem,horario_inicio,horario_fim,criado_em,atualizado_em)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
function dateAt(index: number) {
  return new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
}
function addFixture(from: number, to: number) {
  db.exec("BEGIN TRANSACTION");
  try {
    for (let i = from; i < to; i++) {
      const store = i % stores;
      const agenda = `a${i}`;
      const date = dateAt(Math.floor(i / stores));
      insertAgenda.run(agenda, `l${store}`, date, "agenda.csv", "u1", "aberto", fixedNow, fixedNow);
      for (let j = 0; j < appointmentsPerAgenda; j++) {
        const status = ["aguardando", "recebido", "nao_chegou", "recusado"][j % 4];
        insertAppointment.run(`p${i}-${j}`, agenda, `P${j}`, `Fornecedor ${j}`, 1, status,
          j % 7 === 0 ? "manual" : "importado", String(j).padStart(2, "0") + ":00", String(j).padStart(2, "0") + ":30", fixedNow, fixedNow);
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
type BindValue = string | number | bigint | null;
function sqliteValue(value: unknown): BindValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  throw new TypeError("Valor SQL não suportado pelo benchmark de leitura.");
}
let lastQuery: { sql: string; values: BindValue[] } | null = null;
function unsupported(): never { throw Error("Benchmark usa somente consultas de leitura."); }
const adapter: D1Database = {
  prepare(sql: string): D1PreparedStatement {
    const statement = db.prepare(sql);
    const query: { sql: string; values: BindValue[] } = { sql, values: [] };
    lastQuery = query;
    const prepared: D1PreparedStatement = {
      bind(...params: unknown[]) {
        query.values = params.map(sqliteValue);
        lastQuery = query;
        return prepared;
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        // Igual ao contrato genérico D1: o chamador define a projeção SQL.
        // Coerção restrita à fronteira SQLite do benchmark, com resultados
        // verificados por cardinalidade, IDs e totais.
        return { success: true, results: statement.all(...query.values) as T[] };
      },
      async first() { return unsupported(); },
      async run() { return unsupported(); },
      async raw() { return unsupported(); }
    };
    return prepared;
  },
  async batch() { return unsupported(); }
};
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
type AgendaQueryResult = AgendaSummaryRow[] | { items: AgendaSummaryRow[]; hasMore: boolean };
async function measure(label: string, fn: () => Promise<AgendaQueryResult>, expected: number, expectedHasMore?: boolean) {
  await fn();
  const ms: number[] = [];
  for (let i = 0; i < repetitions; i++) {
    const start = performance.now();
    const result = await fn();
    ms.push(performance.now() - start);
    const rows = Array.isArray(result) ? result : result.items;
    assert.equal(rows.length, expected, `Quantidade inesperada em ${label}`);
    if (expectedHasMore !== undefined) {
      assert.ok(!Array.isArray(result), "Consulta paginada esperada: " + label);
      assert.equal(result.hasMore, expectedHasMore, label);
    }
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length, "IDs duplicados: " + label);
    assert.ok(rows.every(row => row.total === appointmentsPerAgenda), "Totais divergentes: " + label);
  }
  const query = lastQuery;
  assert.ok(query, "Consulta não registrada.");
  const plan = db.prepare("EXPLAIN QUERY PLAN " + query.sql).all(...query.values).map(row => String(row.detail));
  return {
    scenario: label,
    count: expected,
    median_ms: Number(median(ms).toFixed(2)),
    uses_temporary_sort: plan.some(detail => /USE TEMP B-TREE/.test(detail)),
    plan
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
    await measure("Conferente/loja", () => listStoreAgendas(adapter, "l0"), Math.ceil(total / stores)),
    await measure("ADM página inicial", () => listAdminAgendasPage(adapter, {}, 20, 0), Math.min(total, 20), total > 20),
    await measure("ADM página seguinte", () => listAdminAgendasPage(adapter, {}, 20, 20), Math.min(Math.max(total - 20, 0), 20), total > 40),
    await measure("Conferente página inicial", () => listStoreAgendasPage(adapter, "l0", 20, 0), Math.min(Math.ceil(total / stores), 20), Math.ceil(total / stores) > 20)
  ];
  console.log(JSON.stringify({
    agendas: total,
    appointments: total * appointmentsPerAgenda,
    stores,
    engine: "node:sqlite (local; NÃO Cloudflare D1)",
    schema_migrations: migrations.length,
    cases
  }, null, 2));
}
db.close();
