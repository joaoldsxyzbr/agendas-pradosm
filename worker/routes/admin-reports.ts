import type { AppEnv } from "../env.ts";
import { scopedStoreIds } from "../middleware/enforce-access.ts";
import { Hono, type HonoRequest } from "hono";
import { storeFilter, OCCURRENCE_TYPES, occurrenceCondition, occurrenceSearch, absence, notReceived, refused } from "../repositories/report-filters.ts";
import { z } from "zod";
interface ReportRow { date: string; storeCode: string; storeName: string; dayStatus: string; total: number; aguardando: number; naoCompareceu: number; recebido: number; naoChegou: number; recusado: number; semAgenda: number; semAgendaRecebidos: number; }
interface SupplierRow { supplier: string; total: number; recebido: number; naoChegou: number; naoCompareceu: number; recusado: number; rankedSuppliers: number; }
interface ManualSupplierRow { supplier: string; vezes: number; ultima: string; recebidos: number; rankedSuppliers: number; }
interface OccurrenceRow { date: string; storeCode: string; storeName: string; protocol: string; supplier: string; observation: string | null; origin: string; occurrenceType: string; classificationOrigin: string; }
const adminReportRoutes = new Hono<AppEnv>();
const DAY_MS = 864e5;
const MAX_REPORT_DAYS = 93;
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (date) => {
    const ms = Date.parse(date + "T00:00:00Z");
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
  }
);
const reportFilters = z.object({
  start: dateSchema,
  end: dateSchema,
  storeCodes: z.array(z.string().trim().min(1).max(20)).max(50)
}).refine(
  ({ start, end }) => {
    const span = (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / DAY_MS;
    return span >= 0 && span < MAX_REPORT_DAYS;
  },
  { message: "Selecione um intervalo de 1 a 93 dias." }
);
function parseFilters(req: HonoRequest) {
  return reportFilters.safeParse({
    start: req.query("start"),
    end: req.query("end"),
    // Mantém a API de uma loja e permite repetir storeCode para múltiplas.
    storeCodes: req.queries("storeCode") ?? []
  });
}
adminReportRoutes.get("/", async (c) => {
  const parsed = parseFilters(c.req);
  if (!parsed.success) {
    return c.json({ error: "FILTROS_INVALIDOS", message: "Informe um per\xEDodo v\xE1lido de at\xE9 93 dias." }, 400);
  }
  const { start, end } = parsed.data;
  const {where,args:filters,codes}=storeFilter(parsed.data,scopedStoreIds(c));
  const [rows, suppliers, semAgendaSuppliers] = await Promise.all([
    c.env.DB.prepare([
    "SELECT a.data_agenda AS date, l.codigo AS storeCode, l.nome AS storeName,",
    "a.status_dia AS dayStatus, COUNT(ag.id) AS total,",
    "SUM(CASE WHEN ag.status = 'aguardando' AND a.status_dia = 'aberto' THEN 1 ELSE 0 END) AS aguardando,",
    `SUM(CASE WHEN ${absence} THEN 1 ELSE 0 END) AS naoCompareceu,`,
    "SUM(CASE WHEN ag.status = 'recebido' THEN 1 ELSE 0 END) AS recebido,",
    `SUM(CASE WHEN ${notReceived} THEN 1 ELSE 0 END) AS naoChegou,`,
    `SUM(CASE WHEN ${refused} THEN 1 ELSE 0 END) AS recusado,`,
    "SUM(CASE WHEN ag.origem = 'manual' THEN 1 ELSE 0 END) AS semAgenda,",
    "SUM(CASE WHEN ag.origem = 'manual' AND ag.status = 'recebido' THEN 1 ELSE 0 END) AS semAgendaRecebidos",
    "FROM agendas a JOIN lojas l ON l.id = a.loja_id",
    "LEFT JOIN agendamentos ag ON ag.agenda_id = a.id AND ag.ativo = 1",
    "WHERE",
    where,
    "GROUP BY a.id ORDER BY a.data_agenda ASC, l.codigo ASC"
  ].join(" ")).bind(...filters).all<ReportRow>(),
    c.env.DB.prepare([
    "SELECT ag.fornecedor AS supplier, COUNT(*) AS total,",
    "SUM(CASE WHEN ag.status = 'recebido' THEN 1 ELSE 0 END) AS recebido,",
    `SUM(CASE WHEN ${notReceived} THEN 1 ELSE 0 END) AS naoChegou,`,
    `SUM(CASE WHEN ${absence} THEN 1 ELSE 0 END) AS naoCompareceu,`,
    `SUM(CASE WHEN ${refused} THEN 1 ELSE 0 END) AS recusado,`,
    "COUNT(*) OVER() AS rankedSuppliers",
    "FROM agendamentos ag",
    "JOIN agendas a ON a.id = ag.agenda_id",
    "JOIN lojas l ON l.id = a.loja_id",
    "WHERE",
    where,
    "AND ag.ativo = 1",
    "GROUP BY ag.fornecedor",
    "HAVING naoChegou + naoCompareceu + recusado > 0",
    "ORDER BY (naoChegou + naoCompareceu + recusado) DESC, ag.fornecedor ASC LIMIT 12"
  ].join(" ")).bind(...filters).all<SupplierRow>(),
    // Fornecedores que mais entregam sem agenda: agendamentos de origem
    // "manual" (registrados na hora na conferência, sem importação prévia),
    // agrupados por fornecedor — alimenta o card "Fornecedores sem agenda".
    c.env.DB.prepare([
    "SELECT ag.fornecedor AS supplier, COUNT(*) AS vezes, MAX(a.data_agenda) AS ultima,",
    "SUM(CASE WHEN ag.status = 'recebido' THEN 1 ELSE 0 END) AS recebidos,",
    "COUNT(*) OVER() AS rankedSuppliers",
    "FROM agendamentos ag",
    "JOIN agendas a ON a.id = ag.agenda_id",
    "JOIN lojas l ON l.id = a.loja_id",
    "WHERE",
    where,
    "AND ag.ativo = 1 AND ag.origem = 'manual'",
    "GROUP BY ag.fornecedor",
    "ORDER BY vezes DESC, ag.fornecedor ASC LIMIT 12"
  ].join(" ")).bind(...filters).all<ManualSupplierRow>()
  ]);
  if (!rows.success || !suppliers.success || !semAgendaSuppliers.success || !rows.results || !suppliers.results || !semAgendaSuppliers.results) throw new Error("REPORT_QUERY_FAILED");
  return c.json({
    start,
    end,
    storeCode: codes.length===1?codes[0]:null,
    storeCodes: codes,
    rows: rows.results.map((row) => ({
      ...row,
      total: Number(row.total),
      aguardando: Number(row.aguardando),
      naoCompareceu: Number(row.naoCompareceu),
      recebido: Number(row.recebido),
      naoChegou: Number(row.naoChegou),
      recusado: Number(row.recusado),
      semAgenda: Number(row.semAgenda),
      semAgendaRecebidos: Number(row.semAgendaRecebidos)
    })),
    occurrenceSupplierCount: Number(suppliers.results[0]?.rankedSuppliers ?? 0),
    manualSupplierCount: Number(semAgendaSuppliers.results[0]?.rankedSuppliers ?? 0),
    suppliers: suppliers.results.map((supplier) => ({
      ...supplier,
      total: Number(supplier.total),
      recebido: Number(supplier.recebido),
      naoChegou: Number(supplier.naoChegou),
      naoCompareceu: Number(supplier.naoCompareceu),
      recusado: Number(supplier.recusado)
    })),
    semAgendaSuppliers: semAgendaSuppliers.results.map((supplier) => ({
      ...supplier,
      vezes: Number(supplier.vezes),
      recebidos: Number(supplier.recebidos)
    }))
  });
});
const occurrencesFilters = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1e5).default(0),
  q: z.string().trim().min(1).max(80).optional(),
  type: z.enum(OCCURRENCE_TYPES).default("todos")
});
adminReportRoutes.get("/occurrences", async (c) => {
  const parsed = parseFilters(c.req);
  const paging = occurrencesFilters.safeParse({
    limit: c.req.query("limit") ?? void 0,
    offset: c.req.query("offset") ?? void 0,
    q: (c.req.query("q") || "").trim() || void 0,
    type: c.req.query("type") ?? void 0
  });
  if (!parsed.success || !paging.success) {
    return c.json({ error: "FILTROS_INVALIDOS", message: "Filtros ou pagina\xE7\xE3o inv\xE1lidos." }, 400);
  }
  const {where,args:filters}=storeFilter(parsed.data,scopedStoreIds(c));
  const base = [
    "FROM agendamentos ag",
    "JOIN agendas a ON a.id = ag.agenda_id",
    "JOIN lojas l ON l.id = a.loja_id",
    "WHERE",
    where,
    "AND ag.ativo = 1 AND", occurrenceCondition(paging.data.type)
  ].join(" ");
  const { clause: searchClause, args: searchArgs } = occurrenceSearch(paging.data.q);
  const [count, rows] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS total " + base + searchClause).bind(...filters, ...searchArgs).first<{ total: number }>(),
    c.env.DB.prepare([
      "SELECT a.data_agenda AS date, l.codigo AS storeCode,",
      "l.nome AS storeName, ag.protocolo AS protocol,",
      "ag.fornecedor AS supplier, ag.observacao AS observation,",
      "ag.origem AS origin,",
      `CASE WHEN ${refused} THEN 'recusado' WHEN ${absence} THEN 'nao_compareceu' ELSE 'nao_recebido' END AS occurrenceType,`,
      "CASE WHEN ag.status = 'aguardando' THEN 'historico' WHEN ag.status = 'nao_chegou' AND ag.observacao = 'Não compareceu' THEN 'sistema' ELSE 'manual' END AS classificationOrigin",
      base,
      searchClause,
      "ORDER BY a.data_agenda DESC, l.codigo ASC, ag.horario_inicio ASC, ag.id ASC",
      "LIMIT ? OFFSET ?"
    ].join(" ")).bind(...filters, ...searchArgs, paging.data.limit, paging.data.offset).all<OccurrenceRow>()
  ]);
  if (!count || !rows.success || !rows.results) throw new Error("REPORT_OCCURRENCES_QUERY_FAILED");
  return c.json({
    total: Number(count.total),
    offset: paging.data.offset,
    limit: paging.data.limit,
    rows: rows.results.map((row) => ({
      ...row,
      protocol: row.origin === "manual" ? "Sem agenda" : row.protocol
    }))
  });
});
export {
  adminReportRoutes
};
