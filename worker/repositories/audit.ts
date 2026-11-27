interface AuditInput {
  id?:string; userId:string|null; action:string; entity:string; entityId:string;
  storeId?:string|null; agendaId?:string|null; appointmentId?:string|null;
  before?:unknown; after?:unknown; details?:string|null; createdAt?:string; onlyIfPreviousWrite?:boolean;
}
interface AuditRow {
  id:string; usuario_id:string|null; usuario_nome:string|null; acao:string; entidade:string; entidade_id:string;
  loja_id:string|null; agenda_id:string|null; agendamento_id:string|null; antes:string|null; depois:string|null; detalhes:string|null; criado_em:string;
}
function jsonValue(value:unknown):string|null {
  return value === void 0 ? null : JSON.stringify(value) ?? null;
}
function auditStatement(db:D1Database, input:AuditInput):D1PreparedStatement {
  const createdAt = input.createdAt ?? (/* @__PURE__ */ new Date()).toISOString();
  // Dentro de D1.batch(), changes() identifica se o UPDATE anterior
  // realmente alterou a linha. Sem alteração não deve existir auditoria.
  const values = Array(12).fill("?").join(", ");
  const insert = input.onlyIfPreviousWrite
    ? `SELECT ${values} WHERE changes() = 1`
    : `VALUES (${values})`;
  return db.prepare(
    `INSERT INTO auditoria (
        id,
        usuario_id,
        acao,
        entidade,
        entidade_id,
        loja_id,
        agenda_id,
        agendamento_id,
        antes,
        depois,
        detalhes,
        criado_em
      ) ${insert}`
  ).bind(
    input.id ?? crypto.randomUUID(),
    input.userId,
    input.action,
    input.entity,
    input.entityId,
    input.storeId ?? null,
    input.agendaId ?? null,
    input.appointmentId ?? null,
    jsonValue(input.before),
    jsonValue(input.after),
    input.details ?? null,
    createdAt
  );
}
async function recordAudit(db:D1Database, input:AuditInput):Promise<void> {
  await auditStatement(db, input).run();
}
async function listAudit(db:D1Database, filters: { entity?: string; entityId?: string; agendaId?: string; userId?: string; storeId?: string; date?: string; limit?: number } = {}) {
  const clauses = [];
  const values: (string|number)[] = [];
  if (filters.entity) {
    clauses.push("a.entidade = ?");
    values.push(filters.entity);
  }
  if (filters.entityId) {
    clauses.push("a.entidade_id = ?");
    values.push(filters.entityId);
  }
  if (filters.agendaId) {
    clauses.push("a.agenda_id = ?");
    values.push(filters.agendaId);
  }
  if (filters.userId) {
    clauses.push("a.usuario_id = ?");
    values.push(filters.userId);
  }
  if (filters.storeId) {
    clauses.push("a.loja_id = ?");
    values.push(filters.storeId);
  }
  if (filters.date) {
    clauses.push("a.criado_em >= ? AND a.criado_em < ?");
    values.push(filters.date + "T00:00:00.000Z", filters.date + "T23:59:59.999Z");
  }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await db.prepare(
    `SELECT
         a.id,
         a.usuario_id,
         u.nome AS usuario_nome,
         a.acao,
         a.entidade,
         a.entidade_id,
         a.loja_id,
         a.agenda_id,
         a.agendamento_id,
         a.antes,
         a.depois,
         a.detalhes,
         a.criado_em
       FROM auditoria a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       ${where}
       ORDER BY a.criado_em DESC, a.id DESC
       LIMIT ?`
  ).bind(...values, limit).all<AuditRow>();
  if(!result.success||!result.results)throw new Error("AUDITORIA_CONSULTA_FALHOU");
  return result.results;
}
function parseAuditJson(value:string|null):unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
export {
  auditStatement,
  listAudit,
  parseAuditJson,
  recordAudit
};