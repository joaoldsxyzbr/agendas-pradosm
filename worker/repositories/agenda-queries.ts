// Consultas de leitura de agendas. Não executa mutações nem auditoria.
export type AppointmentStatus = "aguardando" | "recebido" | "nao_chegou" | "recusado";
export type DayStatus = "aberto" | "concluido";
export interface AgendaRow {
  id: string; loja_id: string; data_agenda: string; arquivo_original: string;
  criado_por: string; status_dia: DayStatus; concluido_em: string | null;
  concluido_por: string | null; digitado_em: string | null; digitado_por: string | null;
  criado_em: string; atualizado_em: string;
}
export interface AgendaDetailRow extends AgendaRow {
  store_code: string; store_name: string; concluido_por_nome: string | null; digitado_por_nome?: string | null;
}
export interface AgendaSummaryRow extends AgendaDetailRow {
  total: number; aguardando: number; recebido: number; nao_chegou: number; recusado: number; sem_agenda: number;
}
export interface AppointmentRow {
  id: string; agenda_id: string; protocolo: string; horario_inicio: string; horario_fim: string; fornecedor: string;
  itens: number | null; volumes: number | null; paletes: number | null; carga_batida: string | null;
  tipo: string | null; nfe: string; pedidos: string; status: AppointmentStatus; trocas: number;
  observacao: string | null; origem: "manual" | "importado"; ativo: number;
  criado_em: string; atualizado_em: string; csv_campos: string | null;
}
interface HistoryRow { id: string; usuario_id: string | null; usuario_nome: string | null; alterado_em: string; }
interface AppointmentHistoryRow extends HistoryRow { agendamento_id: string; status_anterior: string; status_novo: string; observacao: string | null; }
interface AgendaHistoryRow extends HistoryRow { agenda_id: string; acao: string; detalhes: string | null; }
const AGENDA_COLUMNS = "id, loja_id, data_agenda, arquivo_original, criado_por, status_dia, concluido_em, concluido_por, digitado_em, digitado_por, criado_em, atualizado_em";
const APPOINTMENT_COLUMNS = "id, agenda_id, protocolo, horario_inicio, horario_fim, fornecedor, itens, volumes, paletes, carga_batida, tipo, nfe, pedidos, status, trocas, observacao, origem, ativo, criado_em, atualizado_em, csv_campos";
async function findStoreByCode(db: D1Database, code: string) {
  return db.prepare(
    "SELECT id, codigo, nome FROM lojas WHERE codigo = ? COLLATE NOCASE AND ativo = 1 AND excluido_em IS NULL LIMIT 1"
  ).bind(code).first<{ id: string; codigo: string; nome: string }>();
}
async function findAgendaByStoreDate(db: D1Database, storeId: string, date: string) {
  return db.prepare(
    `SELECT ${AGENDA_COLUMNS} FROM agendas WHERE loja_id = ? AND data_agenda = ? LIMIT 1`
  ).bind(storeId, date).first<AgendaRow>();
}
async function findAgendaById(db: D1Database, id: string) {
  return db.prepare(
    `SELECT a.${AGENDA_COLUMNS.replaceAll(", ", ", a.")},
              l.codigo AS store_code,
              l.nome AS store_name,
              concluidor.nome AS concluido_por_nome,
              digitador.nome AS digitado_por_nome
       FROM agendas a
       JOIN lojas l ON l.id = a.loja_id
       LEFT JOIN usuarios concluidor ON concluidor.id = a.concluido_por
       LEFT JOIN usuarios digitador ON digitador.id = a.digitado_por
       WHERE a.id = ?
       LIMIT 1`
  ).bind(id).first<AgendaDetailRow>();
}
async function listAdminAgendas(db: D1Database, filters: { date?: string; storeCode?: string } = {}) {
  const clauses = [];
  const values = [];
  if (filters.date) {
    clauses.push("a.data_agenda = ?");
    values.push(filters.date);
  }
  if (filters.storeCode) {
    clauses.push("l.codigo = ? COLLATE NOCASE");
    values.push(filters.storeCode);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const statement = db.prepare(
    `SELECT
       a.${AGENDA_COLUMNS.replaceAll(", ", ", a.")},
       l.codigo AS store_code,
       l.nome AS store_name,
       concluidor.nome AS concluido_por_nome,
       digitador.nome AS digitado_por_nome,
       SUM(CASE WHEN ag.ativo = 1 THEN 1 ELSE 0 END) AS total,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'aguardando' THEN 1 ELSE 0 END) AS aguardando,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'recebido' THEN 1 ELSE 0 END) AS recebido,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'nao_chegou' THEN 1 ELSE 0 END) AS nao_chegou,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'recusado' THEN 1 ELSE 0 END) AS recusado,
       SUM(CASE WHEN ag.ativo = 1 AND ag.origem = 'manual' THEN 1 ELSE 0 END) AS sem_agenda
     FROM agendas a
     JOIN lojas l ON l.id = a.loja_id
     LEFT JOIN usuarios concluidor ON concluidor.id = a.concluido_por
     LEFT JOIN usuarios digitador ON digitador.id = a.digitado_por
     LEFT JOIN agendamentos ag ON ag.agenda_id = a.id
     ${where}
     GROUP BY a.id, l.codigo, l.nome, concluidor.nome, digitador.nome
     ORDER BY a.data_agenda DESC, l.codigo ASC`
  );
  const result = await (values.length ? statement.bind(...values) : statement).all<AgendaSummaryRow>();
  return result.results ?? [];
}
/**
 * Paginação opt-in para o Histórico administrativo. Seleciona as agendas da
 * página ANTES de agregar agendamentos, evitando GROUP BY da base inteira.
 * A listagem antiga permanece inalterada para Recebimento e outros clientes.
 */
async function listAdminAgendasPage(db: D1Database, filters: { date?: string; storeCode?: string } = {}, limit = 20, offset = 0) {
  const clauses = [];
  const values = [];
  if (filters.date) {
    clauses.push("a.data_agenda = ?");
    values.push(filters.date);
  }
  if (filters.storeCode) {
    clauses.push("l.codigo = ? COLLATE NOCASE");
    values.push(filters.storeCode);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  // A linha adicional permite descobrir se há próxima página sem COUNT(*).
  const result = await db.prepare(
    `WITH selected AS (
       SELECT a.id, a.data_agenda AS sorted_date, l.codigo AS sorted_code
       FROM agendas a JOIN lojas l ON l.id = a.loja_id
       ${where}
       ORDER BY a.data_agenda DESC, l.codigo ASC, a.id ASC
       LIMIT ? OFFSET ?
     )
     SELECT
       a.${AGENDA_COLUMNS.replaceAll(", ", ", a.")},
       l.codigo AS store_code,
       l.nome AS store_name,
       concluidor.nome AS concluido_por_nome,
       digitador.nome AS digitado_por_nome,
       SUM(CASE WHEN ag.ativo = 1 THEN 1 ELSE 0 END) AS total,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'aguardando' THEN 1 ELSE 0 END) AS aguardando,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'recebido' THEN 1 ELSE 0 END) AS recebido,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'nao_chegou' THEN 1 ELSE 0 END) AS nao_chegou,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'recusado' THEN 1 ELSE 0 END) AS recusado,
       SUM(CASE WHEN ag.ativo = 1 AND ag.origem = 'manual' THEN 1 ELSE 0 END) AS sem_agenda
     FROM selected p
     CROSS JOIN agendas a ON a.id = p.id
     JOIN lojas l ON l.id = a.loja_id
     LEFT JOIN usuarios concluidor ON concluidor.id = a.concluido_por
     LEFT JOIN usuarios digitador ON digitador.id = a.digitado_por
     LEFT JOIN agendamentos ag ON ag.agenda_id = a.id
     GROUP BY a.id, l.codigo, l.nome, concluidor.nome, digitador.nome
     ORDER BY p.sorted_date DESC, p.sorted_code ASC, a.id ASC`
  ).bind(...values, limit + 1, offset).all<AgendaSummaryRow>();
  const rows = result.results ?? [];
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

async function listAppointmentsByAgenda(db: D1Database, agendaId: string, activeOnly = true) {
  const query = activeOnly ? `SELECT ${APPOINTMENT_COLUMNS} FROM agendamentos WHERE agenda_id = ? AND ativo = 1 ORDER BY horario_inicio ASC, protocolo ASC` : `SELECT ${APPOINTMENT_COLUMNS} FROM agendamentos WHERE agenda_id = ? ORDER BY horario_inicio ASC, protocolo ASC`;
  const result = await db.prepare(query).bind(agendaId).all<AppointmentRow>();
  return result.results ?? [];
}
async function findAppointmentById(db: D1Database, id: string) {
  return db.prepare(
    `SELECT ${APPOINTMENT_COLUMNS} FROM agendamentos WHERE id = ? LIMIT 1`
  ).bind(id).first<AppointmentRow>();
}
async function listAppointmentHistory(db: D1Database, appointmentId: string) {
  const result = await db.prepare(
    `SELECT id, agendamento_id, usuario_id, usuario_nome, status_anterior, status_novo, observacao, alterado_em
       FROM (
         SELECT h.id, h.agendamento_id, h.usuario_id, u.nome AS usuario_nome,
                h.status_anterior, h.status_novo, h.observacao, h.alterado_em
         FROM historico_status h
         LEFT JOIN usuarios u ON u.id = h.usuario_id
         WHERE h.agendamento_id = ?
         UNION ALL
         SELECT a.id, a.agendamento_id, NULL AS usuario_id, 'Sistema' AS usuario_nome,
                'aguardando' AS status_anterior, 'nao_chegou' AS status_novo,
                'Não compareceu' AS observacao, a.criado_em AS alterado_em
         FROM auditoria a
         WHERE a.agendamento_id = ? AND a.acao = 'nao_compareceu_automaticamente'
       )
       ORDER BY alterado_em ASC, id ASC`
  ).bind(appointmentId, appointmentId).all<AppointmentHistoryRow>();
  return result.results ?? [];
}
async function findStoreAgendaByDate(db: D1Database, storeId: string, date: string) {
  return db.prepare(
    `SELECT a.${AGENDA_COLUMNS.replaceAll(", ", ", a.")},
              l.codigo AS store_code,
              l.nome AS store_name,
              concluidor.nome AS concluido_por_nome,
              digitador.nome AS digitado_por_nome
       FROM agendas a
       JOIN lojas l ON l.id = a.loja_id
       LEFT JOIN usuarios concluidor ON concluidor.id = a.concluido_por
       LEFT JOIN usuarios digitador ON digitador.id = a.digitado_por
       WHERE a.loja_id = ? AND a.data_agenda = ?
       LIMIT 1`
  ).bind(storeId, date).first<AgendaDetailRow>();
}
async function listStoreAgendas(db: D1Database, storeId: string) {
  const result = await db.prepare(
    `SELECT
         a.${AGENDA_COLUMNS.replaceAll(", ", ", a.")},
         l.codigo AS store_code,
         l.nome AS store_name,
         concluidor.nome AS concluido_por_nome,
         SUM(CASE WHEN ag.ativo = 1 THEN 1 ELSE 0 END) AS total,
         SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'aguardando' THEN 1 ELSE 0 END) AS aguardando,
         SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'recebido' THEN 1 ELSE 0 END) AS recebido,
         SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'nao_chegou' THEN 1 ELSE 0 END) AS nao_chegou,
         SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'recusado' THEN 1 ELSE 0 END) AS recusado,
         SUM(CASE WHEN ag.ativo = 1 AND ag.origem = 'manual' THEN 1 ELSE 0 END) AS sem_agenda
       FROM agendas a
       JOIN lojas l ON l.id = a.loja_id
       LEFT JOIN usuarios concluidor ON concluidor.id = a.concluido_por
       LEFT JOIN agendamentos ag ON ag.agenda_id = a.id
       WHERE a.loja_id = ?
       GROUP BY a.id, l.codigo, l.nome, concluidor.nome
       ORDER BY a.data_agenda DESC`
  ).bind(storeId).all<AgendaSummaryRow>();
  return result.results ?? [];
}
/** Consulta opt-in de histórico de uma loja, com IDs limitados antes dos totais. */
async function listStoreAgendasPage(db: D1Database, storeId: string, limit = 20, offset = 0) {
  const result = await db.prepare(
    `WITH selected AS (
       SELECT id, data_agenda FROM agendas
       WHERE loja_id = ?
       ORDER BY data_agenda DESC, id ASC
       LIMIT ? OFFSET ?
     )
     SELECT
       a.${AGENDA_COLUMNS.replaceAll(", ", ", a.")},
       l.codigo AS store_code,
       l.nome AS store_name,
       concluidor.nome AS concluido_por_nome,
       SUM(CASE WHEN ag.ativo = 1 THEN 1 ELSE 0 END) AS total,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'aguardando' THEN 1 ELSE 0 END) AS aguardando,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'recebido' THEN 1 ELSE 0 END) AS recebido,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'nao_chegou' THEN 1 ELSE 0 END) AS nao_chegou,
       SUM(CASE WHEN ag.ativo = 1 AND ag.status = 'recusado' THEN 1 ELSE 0 END) AS recusado,
       SUM(CASE WHEN ag.ativo = 1 AND ag.origem = 'manual' THEN 1 ELSE 0 END) AS sem_agenda
     FROM selected p
     CROSS JOIN agendas a ON a.id = p.id
     JOIN lojas l ON l.id = a.loja_id
     LEFT JOIN usuarios concluidor ON concluidor.id = a.concluido_por
     LEFT JOIN agendamentos ag ON ag.agenda_id = a.id
     WHERE a.loja_id = ?
     GROUP BY a.id, l.codigo, l.nome, concluidor.nome
     ORDER BY p.data_agenda DESC, a.id ASC`
  ).bind(storeId, limit + 1, offset, storeId).all<AgendaSummaryRow>();
  const rows = result.results ?? [];
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

async function findAppointmentForStore(db: D1Database, appointmentId: string, storeId: string) {
  const prefixedColumns = APPOINTMENT_COLUMNS.split(", ").map((column) => `ag.${column}`).join(", ");
  return db.prepare(
    `SELECT ${prefixedColumns}
       FROM agendamentos ag
       JOIN agendas a ON a.id = ag.agenda_id
       WHERE ag.id = ? AND a.loja_id = ? AND ag.ativo = 1
       LIMIT 1`
  ).bind(appointmentId, storeId).first<AppointmentRow>();
}
async function listAgendaHistory(db: D1Database, agendaId: string) {
  const result = await db.prepare(
    `SELECT id, agenda_id, usuario_id, usuario_nome, acao, detalhes, alterado_em
       FROM (
         SELECT
           h.id,
           h.agenda_id,
           h.usuario_id,
           u.nome AS usuario_nome,
           h.acao,
           h.detalhes,
           h.alterado_em
         FROM historico_agenda h
         LEFT JOIN usuarios u ON u.id = h.usuario_id
         WHERE h.agenda_id = ?

         UNION ALL

         SELECT
           a.id,
           a.agenda_id,
           a.usuario_id,
           u.nome AS usuario_nome,
           'concluido_automaticamente' AS acao,
           a.detalhes,
           a.criado_em AS alterado_em
         FROM auditoria a
         LEFT JOIN usuarios u ON u.id = a.usuario_id
         WHERE a.agenda_id = ?
           AND a.entidade = 'agenda'
           AND a.acao = 'dia_concluido_automaticamente'
       )
       ORDER BY alterado_em ASC, id ASC`
  ).bind(agendaId, agendaId).all<AgendaHistoryRow>();
  return result.results ?? [];
}
export { findStoreByCode, findAgendaByStoreDate, findAgendaById, listAdminAgendas, listAdminAgendasPage, listAppointmentsByAgenda, findAppointmentById, listAppointmentHistory, findStoreAgendaByDate, listStoreAgendas, listStoreAgendasPage, findAppointmentForStore, listAgendaHistory };
