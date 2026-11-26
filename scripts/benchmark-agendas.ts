// Benchmark sintético e opcional: sem token, HTTP ou conexão com Cloudflare/D1 real.
// Node 22+ inclui node:sqlite (experimental em algumas versões).
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { listAvisos } from "../worker/repositories/avisos.ts";
import { adminReportRoutes } from "../worker/routes/admin-reports.ts";
import { testEnv } from "../tests/helpers/sqlite-d1.ts";
import type { AgendaSummaryRow } from "../worker/repositories/agendas.ts";
import { listAdminAgendas, listStoreAgendas, listAdminAgendasPage, listStoreAgendasPage } from "../worker/repositories/agendas.ts";

const quick = process.argv.includes("--quick");
const sizes = quick ? [40] : [162, 1_000, 5_000];
const stores = 10;
const appointmentsPerAgenda = 15;
const repetitions = quick ? 2 : 20;
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

db.prepare("INSERT INTO usuarios (id,loja_id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?)")
  .run("u2", "l0", "Conferente sintético", "benchmark-conf", "hash-ficticio", "conferente", fixedNow, fixedNow);
const insertNotice = db.prepare("INSERT INTO avisos (id,tipo,titulo,mensagem,criado_por,criado_em,urgente,autor) VALUES (?,?,?,?,?,?,?,?)");
const insertTarget = db.prepare("INSERT INTO avisos_lojas (aviso_id,loja) VALUES (?,?)");
const insertRead = db.prepare("INSERT INTO avisos_lidos (aviso_id,usuario_id,lido_em) VALUES (?,?,?)");

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
      // Mesmo timestamp para exercitar o desempate por ID do cursor.
      const globalId = "g-" + String(i).padStart(6,"0");
      const targetId = "t-" + String(i).padStart(6,"0");
      insertNotice.run(globalId, "chat", null, "Mensagem sintética", "u1", fixedNow, 0, "Admin sintético");
      insertNotice.run(targetId, "aviso", "Aviso sintético", "Comunicado", "u1", fixedNow, 1, "Admin sintético");
      insertTarget.run(targetId, i % 2 === 0 ? "01" : "02");
      if (i % 4 === 0) insertRead.run(globalId, "u2", fixedNow);
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
type RecordedQuery = { sql: string; values: BindValue[] };
let lastQuery: RecordedQuery | null = null;
const queries: RecordedQuery[] = [];
function unsupported(): never { throw Error("Benchmark usa somente consultas de leitura."); }
const adapter: D1Database = {
  prepare(sql: string): D1PreparedStatement {
    const statement = db.prepare(sql);
    const query: { sql: string; values: BindValue[] } = { sql, values: [] };
    lastQuery = query;
    queries.push(query);
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
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        const row = statement.get(...query.values);
        return row === undefined ? null : row as T;
      },
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
const p95 = (values: number[]): number => [...values].sort((a,b)=>a-b)[Math.ceil(values.length * 0.95)-1];
const planFor = (query: RecordedQuery): string[] => db.prepare("EXPLAIN QUERY PLAN " + query.sql).all(...query.values).map(row => String(row.detail));
type AgendaQueryResult = AgendaSummaryRow[] | { items: AgendaSummaryRow[]; hasMore: boolean };
async function measure(label: string, fn: () => Promise<AgendaQueryResult>, expected: number, expectedHasMore?: boolean) {
  await fn();
  const ms: number[] = [];
  for (let i = 0; i < repetitions; i++) {
    queries.length = 0;
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
  const plan = planFor(query);
  return {
    scenario: label,
    count: expected,
    median_ms: Number(median(ms).toFixed(2)),
    p95_ms: Number(p95(ms).toFixed(2)),
    statements: queries.length,
    uses_temporary_sort: plan.some(detail => /USE TEMP B-TREE/.test(detail)),
    plan
  };
}

// Mede todos os statements de um cenário multi-consulta, sem inventar rows_read
// (SQLite local não expõe as métricas de cobrança do D1).
async function measureScenario(label: string, fn: () => Promise<number>) {
  await fn();
  const ms: number[] = [];
  let count = 0;
  for (let i=0;i<repetitions;i++) {
    queries.length = 0;
    const start = performance.now();
    count = await fn();
    ms.push(performance.now() - start);
  }
  const plans = queries.map(query => planFor(query));
  assert.ok(plans.length > 0);
  return {scenario:label,count,median_ms:Number(median(ms).toFixed(2)),p95_ms:Number(p95(ms).toFixed(2)),statements:plans.length,plans};
}
const reportSchema = z.object({ rows: z.array(z.object({total:z.number(), aguardando:z.number(), recebido:z.number(), naoChegou:z.number(), recusado:z.number(), naoCompareceu:z.number()})) });
const occurrencesSchema = z.object({total:z.number(),rows:z.array(z.object({date:z.string(),storeCode:z.string(),supplier:z.string()}))});
const env = testEnv(adapter,"somente-benchmark-local");
async function reportJson(path: string): Promise<unknown> {
  // Executa as rotas reais diretamente para medir consultas/serialização,
  // sem autenticação ou rede. Segurança é coberta pelos testes integrados.
  const response = await adminReportRoutes.request("http://localhost"+path,{},env);
  assert.equal(response.status,200);
  return response.json();
}
async function measureReports(total:number) {
  const endDay=Math.floor((total-1)/stores);
  const startDay=Math.max(0,endDay-92);
  const agendasInRange=total-startDay*stores;
  const query="start="+dateAt(startDay)+"&end="+dateAt(endDay);
  return [
    await measureScenario("Relatório até 93 dias",async()=>{
      const data=reportSchema.parse(await reportJson("/?"+query));
      assert.equal(data.rows.length,agendasInRange);
      for(const row of data.rows){
        assert.equal(row.total,appointmentsPerAgenda);
        assert.equal(row.aguardando+row.recebido+row.naoChegou+row.recusado+row.naoCompareceu,row.total);
      }
      return data.rows.length;
    }),
    await measureScenario("Ocorrências paginadas",async()=>{
      const data=occurrencesSchema.parse(await reportJson("/occurrences?"+query+"&limit=50"));
      assert.equal(data.total,agendasInRange*4);
      assert.equal(data.rows.length,Math.min(data.total,50));
      return data.rows.length;
    }),
    await measureScenario("Ocorrências com busca literal",async()=>{
      const data=occurrencesSchema.parse(await reportJson("/occurrences?"+query+"&limit=50&q=Fornecedor%202"));
      assert.equal(data.total,agendasInRange);
      assert.ok(data.rows.every(row=>row.supplier==="Fornecedor 2"));
      assert.equal(data.rows.length,Math.min(data.total,50));
      return data.rows.length;
    })
  ];
}
async function measureNotices(total:number) {
  const visible=total+Math.ceil(total/2);
  const unread=visible-Math.ceil(total/4);
  const first=await listAvisos(adapter,"u2","01",false,50);
  assert.ok(first.nextCursor);
  const cursor=first.nextCursor;
  const ids=new Set(first.avisos.map(row=>row.id));
  return [
    await measureScenario("Avisos: primeira página e badge",async()=>{
      const data=await listAvisos(adapter,"u2","01",false,50);
      assert.equal(data.avisos.length,50);
      assert.equal(data.naoLidos,unread);
      assert.equal(data.urgenteNaoLido,true);
      return data.avisos.length;
    }),
    await measureScenario("Avisos: segunda página por cursor",async()=>{
      const data=await listAvisos(adapter,"u2","01",false,50,cursor);
      assert.equal(data.avisos.length,Math.min(50,visible-50));
      assert.equal(data.naoLidos,unread);
      assert.ok(data.avisos.every(row=>!ids.has(row.id)));
      return data.avisos.length;
    })
  ];
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
  const reports = await measureReports(total);
  const notices = await measureNotices(total);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  console.log(JSON.stringify({
    agendas: total,
    appointments: total * appointmentsPerAgenda,
    stores,
    engine: "node:sqlite (local; NÃO Cloudflare D1)",
    schema_migrations: migrations.length,
    repetitions,
    cases,
    reports,
    notices,
    notice_rows: total * 2
  }, null, 2));
}
db.close();
