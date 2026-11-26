import type { z } from "zod";
import type { ImportAgendaInput } from "../../shared/agenda.ts";
type ImportInput = z.infer<typeof ImportAgendaInput>;
type ImportedAppointment = ImportInput["appointments"][number];
import type { AppointmentStatus, DayStatus, AgendaRow, AppointmentRow } from "./agenda-queries.ts";
export type { AppointmentStatus, DayStatus, AgendaRow, AgendaDetailRow, AgendaSummaryRow, AppointmentRow } from "./agenda-queries.ts";
import { findStoreByCode, findAgendaByStoreDate, findAgendaById, listAdminAgendas, listAdminAgendasPage, listAppointmentsByAgenda, findAppointmentById, listAppointmentHistory, findStoreAgendaByDate, listStoreAgendas, listStoreAgendasPage, findAppointmentForStore, listAgendaHistory } from "./agenda-queries.ts";
export interface ImportEntry { existing: AgendaRow | null; input: ImportInput; storeId: string; }
import { auditStatement } from "./audit.ts";
function appointmentInsert(db: D1Database, agendaId: string, appointment: ImportedAppointment, now: string) {
  return db.prepare(
    "INSERT INTO agendamentos (id, agenda_id, protocolo, horario_inicio, horario_fim, fornecedor, itens, volumes, paletes, carga_batida, tipo, nfe, pedidos, status, origem, ativo, criado_em, atualizado_em, csv_campos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando', 'importado', 1, ?, ?, ?)"
  ).bind(
    crypto.randomUUID(),
    agendaId,
    appointment.protocol,
    appointment.startTime,
    appointment.endTime,
    appointment.supplier,
    appointment.items,
    appointment.volumes,
    appointment.pallets,
    appointment.cargaBatida,
    appointment.type,
    JSON.stringify(appointment.nfe),
    JSON.stringify(appointment.orders),
    now,
    now,
    appointment.csvFields ? JSON.stringify(appointment.csvFields) : null
  );
}
async function createAgendaImport(db: D1Database, storeId: string, createdBy: string, input: ImportInput, _storeName: string | null = null) {
  const agendaId = crypto.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const statements = [
    db.prepare(
      "INSERT INTO agendas (id, loja_id, data_agenda, arquivo_original, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      agendaId,
      storeId,
      input.date,
      input.originalFileName,
      createdBy,
      now,
      now
    )
  ];
  for (const appointment of input.appointments) {
    statements.push(appointmentInsert(db, agendaId, appointment, now));
  }
  statements.push(
    auditStatement(db, {
      userId: createdBy,
      action: "agenda_importada",
      entity: "agenda",
      entityId: agendaId,
      storeId,
      agendaId,
      after: {
        date: input.date,
        originalFileName: input.originalFileName,
        appointmentCount: input.appointments.length
      },
      details: "Agenda importada.",
      createdAt: now
    })
  );
  await db.batch(statements);
  return agendaId;
}
// Fonte única da substituição de agenda importada: o SQL e o bind do
// agendamento vivem aqui — única e lote não podem divergir (classe do
// incidente 500 de 06/11). Retorna os agendamentos importados existentes
// para o log de auditoria do chamador.
// A versão de importação é lida antes dos agendamentos. Se uma substituição
// concorrente gravar primeiro, a constraint da migration 0024 aborta TODO
// o db.batch, incluindo inserções, inativações e auditoria.
async function readAgendaImportVersion(db: D1Database, agendaId: string) {
  const row = await db.prepare("SELECT versao_importacao FROM agendas WHERE id = ?").bind(agendaId).first<{ versao_importacao: number }>();
  if (!row) throw Object.assign(new Error("Agenda alterada durante a importação."), { code: "CONFLITO_ESTADO" });
  return Number(row.versao_importacao);
}
function appendAgendaReplaceStatements(db: D1Database, statements: D1PreparedStatement[], agendaId: string, expectedVersion: number, existingAppointments: AppointmentRow[], input: ImportInput, now: string) {
  const importedExisting = existingAppointments.filter(
    (appointment) => appointment.origem !== "manual"
  );
  const byProtocol = new Map<string, AppointmentRow>(
    importedExisting.map((appointment) => [appointment.protocolo, appointment])
  );
  const incomingProtocols = new Set(
    input.appointments.map((appointment) => appointment.protocol)
  );
  statements.push(
    db.prepare(
      "UPDATE agendas SET arquivo_original = ?, atualizado_em = ?, versao_importacao = " +
      "CASE WHEN versao_importacao = ? THEN versao_importacao + 1 ELSE -1 END WHERE id = ?"
    ).bind(input.originalFileName, now, expectedVersion, agendaId)
  );
  for (const appointment of input.appointments) {
    const current = byProtocol.get(appointment.protocol);
    if (current) {
      statements.push(
        db.prepare(
          "UPDATE agendamentos SET horario_inicio = ?, horario_fim = ?, fornecedor = ?, itens = ?, volumes = ?, paletes = ?, carga_batida = ?, tipo = ?, nfe = ?, pedidos = ?, csv_campos = ?, ativo = 1, atualizado_em = ? WHERE id = ?"
        ).bind(
          appointment.startTime,
          appointment.endTime,
          appointment.supplier,
          appointment.items,
          appointment.volumes,
          appointment.pallets,
          appointment.cargaBatida,
          appointment.type,
          JSON.stringify(appointment.nfe),
          JSON.stringify(appointment.orders),
          appointment.csvFields ? JSON.stringify(appointment.csvFields) : null,
          now,
          current.id
        )
      );
    } else {
      statements.push(appointmentInsert(db, agendaId, appointment, now));
    }
  }
  for (const appointment of importedExisting) {
    if (!incomingProtocols.has(appointment.protocolo) && appointment.ativo === 1) {
      statements.push(
        db.prepare(
          "UPDATE agendamentos SET ativo = 0, atualizado_em = ? WHERE id = ?"
        ).bind(now, appointment.id)
      );
    }
  }
  return importedExisting;
}
async function replaceAgendaImport(db: D1Database, agenda: AgendaRow, userId: string, input: ImportInput) {
  const expectedVersion = await readAgendaImportVersion(db, agenda.id);
  const existing = await listAppointmentsByAgenda(db, agenda.id, false);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const statements: D1PreparedStatement[] = [];
  const importedExisting = appendAgendaReplaceStatements(db, statements, agenda.id, expectedVersion, existing, input, now);
  statements.push(
    auditStatement(db, {
      userId,
      action: "agenda_substituida",
      entity: "agenda",
      entityId: agenda.id,
      storeId: agenda.loja_id,
      agendaId: agenda.id,
      before: {
        originalFileName: agenda.arquivo_original,
        importedAppointmentCount: importedExisting.filter((item) => item.ativo === 1).length
      },
      after: {
        originalFileName: input.originalFileName,
        importedAppointmentCount: input.appointments.length
      },
      details: "Importa\xE7\xE3o da agenda substitu\xEDda.",
      createdAt: now
    })
  );
  await db.batch(statements);
}
class AgendaBatchQueryBudgetError extends Error {
  constructor(statementCount: number) {
    super(
      `O lote exige ${statementCount} opera\xE7\xF5es de banco e excede o limite seguro.`
    );
    this.name = "AgendaBatchQueryBudgetError";
  }
}
const MAX_BATCH_WRITE_STATEMENTS = 800;
async function importAgendaBatchAtomic(db: D1Database, userId: string, entries: ImportEntry[]) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const statements: D1PreparedStatement[] = [];
  const results = [];
  for (const entry of entries) {
    const { existing, input, storeId } = entry;
    if (!existing) {
      const agendaId = crypto.randomUUID();
      statements.push(
        db.prepare(
          "INSERT INTO agendas (id, loja_id, data_agenda, arquivo_original, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          agendaId,
          storeId,
          input.date,
          input.originalFileName,
          userId,
          now,
          now
        )
      );
      for (const appointment of input.appointments) {
        statements.push(appointmentInsert(db, agendaId, appointment, now));
      }
      statements.push(
        auditStatement(db, {
          userId,
          action: "agenda_importada",
          entity: "agenda",
          entityId: agendaId,
          storeId,
          agendaId,
          after: {
            date: input.date,
            originalFileName: input.originalFileName,
            appointmentCount: input.appointments.length,
            batchImport: true
          },
          details: "Agenda importada em lote.",
          createdAt: now
        })
      );
      results.push({
        agendaId,
        storeCode: input.storeCode,
        date: input.date,
        replaced: false,
        appointmentCount: input.appointments.length
      });
      continue;
    }
    const expectedVersion = await readAgendaImportVersion(db, existing.id);
    const existingAppointments = await listAppointmentsByAgenda(
      db,
      existing.id,
      false
    );
    const importedExisting = appendAgendaReplaceStatements(db, statements, existing.id, expectedVersion, existingAppointments, input, now);
    statements.push(
      auditStatement(db, {
        userId,
        action: "agenda_substituida",
        entity: "agenda",
        entityId: existing.id,
        storeId,
        agendaId: existing.id,
        before: {
          originalFileName: existing.arquivo_original,
          importedAppointmentCount: importedExisting.filter(
            (item) => item.ativo === 1
          ).length
        },
        after: {
          originalFileName: input.originalFileName,
          importedAppointmentCount: input.appointments.length,
          batchImport: true
        },
        details: "Importa\xE7\xE3o da agenda substitu\xEDda em lote.",
        createdAt: now
      })
    );
    results.push({
      agendaId: existing.id,
      storeCode: input.storeCode,
      date: input.date,
      replaced: true,
      appointmentCount: input.appointments.length
    });
  }
  if (statements.length === 0) {
    throw new Error("Lote de importa\xE7\xE3o sem opera\xE7\xF5es.");
  }
  if (statements.length > MAX_BATCH_WRITE_STATEMENTS) {
    throw new AgendaBatchQueryBudgetError(statements.length);
  }
  await db.batch(statements);
  return results;
}
async function createManualAppointment(db: D1Database, agenda: AgendaRow, userId: string, supplier: string, businessHour: string, adminAdjustmentDetails: string | null | undefined, requireOpenDay = false) {
  const id = crypto.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const auditId = crypto.randomUUID();
  const statements = [
    db.prepare(
      "INSERT INTO agendamentos (id, agenda_id, protocolo, horario_inicio, horario_fim, fornecedor, itens, volumes, paletes, carga_batida, tipo, nfe, pedidos, status, origem, ativo, criado_em, atualizado_em) " +
      (requireOpenDay
        ? "SELECT ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'Sem agenda', '[]', '[]', 'aguardando', 'manual', 1, ?, ? WHERE EXISTS (SELECT 1 FROM agendas WHERE id = ? AND status_dia = 'aberto')"
        : "VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'Sem agenda', '[]', '[]', 'aguardando', 'manual', 1, ?, ?)")
    ).bind(
      id,
      agenda.id,
      `manual:${id}`,
      businessHour,
      businessHour,
      supplier,
      now,
      now,
      ...(requireOpenDay ? [agenda.id] : [])
    ),
    auditStatement(db, {
      onlyIfPreviousWrite: true,
      userId,
      id: auditId,
      action: "fornecedor_manual_criado",
      entity: "agendamento",
      entityId: id,
      storeId: agenda.loja_id,
      agendaId: agenda.id,
      appointmentId: id,
      after: { supplier, status: "aguardando", origin: "manual", ativo: true },
      details: "Fornecedor sem agenda criado.",
      createdAt: now
    })
  ];
  const adjustment = agendaAdminAdjustmentStatement(
    db,
    agenda,
    userId,
    adminAdjustmentDetails,
    now,
    auditId
  );
  if (adjustment) statements.push(adjustment);
  const result = await db.batch(statements);
  assertMutationApplied(result);
  const appointment = await findAppointmentById(db, id);
  if (!appointment) throw new Error("Fornecedor manual n\xE3o p\xF4de ser relido.");
  return appointment;
}
async function updateManualAppointmentSupplier(db: D1Database, agenda: AgendaRow, appointment: AppointmentRow, userId: string, supplier: string, adminAdjustmentDetails: string | null | undefined, requireOpenDay = false) {
  if (appointment.origem !== "manual" || appointment.ativo !== 1) {
    throw new Error("Agendamento manual inv\xE1lido.");
  }
  if (appointment.fornecedor === supplier) return appointment;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const auditId = crypto.randomUUID();
  const statements = [
    db.prepare(
      "UPDATE agendamentos SET fornecedor = ?, atualizado_em = ? WHERE id = ? AND origem = 'manual' AND ativo = 1 AND fornecedor = ?" +
      (requireOpenDay ? " AND EXISTS (SELECT 1 FROM agendas WHERE id = agendamentos.agenda_id AND status_dia = 'aberto')" : "")
    ).bind(supplier, now, appointment.id, appointment.fornecedor),
    auditStatement(db, {
      userId,
      id: auditId,
      action: "fornecedor_manual_editado",
      onlyIfPreviousWrite: true,
      entity: "agendamento",
      entityId: appointment.id,
      storeId: agenda.loja_id,
      agendaId: agenda.id,
      appointmentId: appointment.id,
      before: { supplier: appointment.fornecedor },
      after: { supplier },
      details: "Nome do fornecedor sem agenda alterado.",
      createdAt: now
    })
  ];
  const adjustment = agendaAdminAdjustmentStatement(
    db,
    agenda,
    userId,
    adminAdjustmentDetails,
    now,
    auditId
  );
  if (adjustment) statements.push(adjustment);
  const result = await db.batch(statements);
  assertMutationApplied(result);
  const updated = await findAppointmentById(db, appointment.id);
  if (!updated) throw new Error("Fornecedor manual atualizado n\xE3o p\xF4de ser relido.");
  return updated;
}
async function softDeleteManualAppointment(db: D1Database, agenda: AgendaRow, appointment: AppointmentRow, userId: string, adminAdjustmentDetails: string | null | undefined, requireOpenDay = false) {
  if (appointment.origem !== "manual" || appointment.ativo !== 1) {
    throw new Error("Agendamento manual inv\xE1lido.");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const auditId = crypto.randomUUID();
  const statements = [
    db.prepare(
      "UPDATE agendamentos SET ativo = 0, atualizado_em = ? WHERE id = ? AND origem = 'manual' AND ativo = 1" +
      (requireOpenDay ? " AND EXISTS (SELECT 1 FROM agendas WHERE id = agendamentos.agenda_id AND status_dia = 'aberto')" : "")
    ).bind(now, appointment.id),
    auditStatement(db, {
      userId,
      id: auditId,
      action: "fornecedor_manual_removido",
      onlyIfPreviousWrite: true,
      entity: "agendamento",
      entityId: appointment.id,
      storeId: agenda.loja_id,
      agendaId: agenda.id,
      appointmentId: appointment.id,
      before: { supplier: appointment.fornecedor, ativo: true },
      after: { supplier: appointment.fornecedor, ativo: false },
      details: "Fornecedor sem agenda removido logicamente.",
      createdAt: now
    })
  ];
  const adjustment = agendaAdminAdjustmentStatement(
    db,
    agenda,
    userId,
    adminAdjustmentDetails,
    now,
    auditId
  );
  if (adjustment) statements.push(adjustment);
  const result = await db.batch(statements);
  assertMutationApplied(result);
}
function agendaAdminAdjustmentStatement(db: D1Database, agenda: AgendaRow, userId: string, details: string | null | undefined, changedAt: string, guardAuditId: string | null = null) {
  if (!details || agenda.status_dia !== "concluido") return null;
  const insertion = guardAuditId
    ? "SELECT ?, ?, ?, 'ajuste_admin', ?, ? WHERE EXISTS (SELECT 1 FROM auditoria WHERE id = ?)"
    : "VALUES (?, ?, ?, 'ajuste_admin', ?, ?)";
  return db.prepare(
    "INSERT INTO historico_agenda (id, agenda_id, usuario_id, acao, detalhes, alterado_em) " + insertion
  ).bind(crypto.randomUUID(), agenda.id, userId, details, changedAt, ...(guardAuditId ? [guardAuditId] : []));
}

// O D1 retorna changes por instrução do batch. Se houve atualização
// concorrente, não registramos histórico ou auditoria fictícios.
function assertMutationApplied(results: D1Result[]) {
  if (results[0]?.meta?.changes !== 1) {
    throw Object.assign(new Error("O registro foi alterado por outra operação. Atualize a tela."), { code: "CONFLITO_ESTADO" });
  }
}

async function changeAppointmentExchanges(db: D1Database, appointment: AppointmentRow, userId: string, hasExchanges: boolean, adminAdjustmentDetails: string | null | undefined = undefined, requireOpenDay = false) {
  const exchanges = hasExchanges ? 1 : 0;
  if (appointment.trocas === exchanges) return appointment;
  const agenda = await findAgendaById(db, appointment.agenda_id);
  if (!agenda) throw new Error("Agenda do agendamento não encontrada.");
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const statements = [
    db.prepare(
      "UPDATE agendamentos SET trocas = ?, atualizado_em = ? WHERE id = ? AND trocas IS ? AND ativo = 1" +
      (requireOpenDay ? " AND EXISTS (SELECT 1 FROM agendas WHERE id = agendamentos.agenda_id AND status_dia = 'aberto')" : "")
    ).bind(exchanges, now, appointment.id, appointment.trocas ?? null),
    auditStatement(db, {
      id: auditId, onlyIfPreviousWrite: true,
      userId,
      action: "trocas_alteradas",
      entity: "agendamento",
      entityId: appointment.id,
      storeId: agenda.loja_id,
      agendaId: agenda.id,
      appointmentId: appointment.id,
      before: { hasExchanges: appointment.trocas === 1 },
      after: { hasExchanges },
      details: "Marcação de trocas alterada.",
      createdAt: now
    })
  ];
  const adjustment = agendaAdminAdjustmentStatement(
    db, agenda, userId, adminAdjustmentDetails, now, auditId
  );
  if (adjustment) statements.push(adjustment);
  const result = await db.batch(statements);
  assertMutationApplied(result);
  const updated = await findAppointmentById(db, appointment.id);
  if (!updated) throw new Error("Agendamento atualizado não pôde ser relido.");
  return updated;
}

async function changeAppointmentStatus(db: D1Database, appointment: AppointmentRow, userId: string, status: AppointmentStatus, adminAdjustmentDetails: string | null | undefined = undefined, observation: string | null | undefined = undefined, requireOpenDay = false) {
  const previousObservation = appointment.observacao ?? null;
  const nextObservation = observation === undefined
    ? (status === appointment.status ? previousObservation : null)
    : observation;
  if (status === "nao_chegou" && !nextObservation && status !== appointment.status)
    throw new Error("Motivo obrigatório para não recebido.");
  if (appointment.status === status && previousObservation === nextObservation) return appointment;
  const agenda = await findAgendaById(db, appointment.agenda_id);
  if (!agenda) throw new Error("Agenda do agendamento não encontrada.");
  const now = new Date().toISOString();
  const historyId = crypto.randomUUID(), auditId = crypto.randomUUID();
  const statusChanged = appointment.status !== status;
  const statements = [
    db.prepare(
      "UPDATE agendamentos SET status = ?, observacao = ?, atualizado_em = ? WHERE id = ? AND status = ? AND observacao IS ? AND ativo = 1" +
      (requireOpenDay ? " AND EXISTS (SELECT 1 FROM agendas WHERE id = agendamentos.agenda_id AND status_dia = 'aberto')" : "")
    ).bind(status, nextObservation, now, appointment.id, appointment.status, previousObservation),
    auditStatement(db, {
      id: auditId, onlyIfPreviousWrite: true,
      userId,
      action: statusChanged ? "status_alterado" : "observacao_alterada",
      entity: "agendamento",
      entityId: appointment.id,
      storeId: agenda.loja_id,
      agendaId: agenda.id,
      appointmentId: appointment.id,
      before: { status: appointment.status, observation: previousObservation },
      after: { status, observation: nextObservation },
      details: statusChanged ? "Status do recebimento alterado." : "Observação do recebimento alterada.",
      createdAt: now
    }),
    db.prepare(
      "INSERT INTO historico_status (id, agendamento_id, usuario_id, status_anterior, status_novo, observacao, alterado_em) " +
      "SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM auditoria WHERE id = ?)"
    ).bind(historyId, appointment.id, userId, appointment.status, status, nextObservation, now, auditId)
  ];
  const adjustment = agendaAdminAdjustmentStatement(
    db, agenda, userId, adminAdjustmentDetails, now, auditId
  );
  if (adjustment) statements.push(adjustment);
  const result = await db.batch(statements);
  assertMutationApplied(result);
  const updated = await findAppointmentById(db, appointment.id);
  if (!updated) throw new Error("Agendamento atualizado não pôde ser relido.");
  return updated;
}


// Registra a classificação do sistema antes da mudança de estado.
function nonattendanceStatements(db: D1Database, agendaSelection: string, bindArgs: string[], now: string) {
  const pending = "ag.ativo = 1 AND ag.status = 'aguardando' AND ag.agenda_id IN (" + agendaSelection + ")";
  return [
    db.prepare(
      "INSERT INTO auditoria (id, usuario_id, acao, entidade, entidade_id, loja_id, agenda_id, agendamento_id, antes, depois, detalhes, criado_em) " +
      "SELECT lower(hex(randomblob(16))), NULL, 'nao_compareceu_automaticamente', 'agendamento', ag.id, a.loja_id, " +
      "a.id, ag.id, '{\"status\":\"aguardando\"}', '{\"status\":\"nao_chegou\",\"observation\":\"Não compareceu\"}', " +
      "'Classificado automaticamente pelo sistema ao concluir a agenda.', ? " +
      "FROM agendamentos ag JOIN agendas a ON a.id = ag.agenda_id WHERE " + pending
    ).bind(now, ...bindArgs),
    db.prepare(
      "UPDATE agendamentos SET status = 'nao_chegou', observacao = 'Não compareceu', atualizado_em = ? " +
      "WHERE id IN (SELECT ag.id FROM agendamentos ag WHERE " + pending + ")"
    ).bind(now, ...bindArgs)
  ];
}

async function changeAgendaDayStatus(db: D1Database, agenda: AgendaRow, userId: string, status: DayStatus) {
  if (agenda.status_dia === status) {
    const current = await findAgendaById(db, agenda.id);
    if (!current) throw new Error("Agenda não pôde ser relida.");
    return current;
  }
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const action = status === "concluido" ? "concluido" : "reaberto";
  const update = status === "concluido"
    ? db.prepare("UPDATE agendas SET status_dia = 'concluido', concluido_em = ?, concluido_por = ?, atualizado_em = ? WHERE id = ? AND status_dia = 'aberto'").bind(now, userId, now, agenda.id)
    : db.prepare("UPDATE agendas SET status_dia = 'aberto', concluido_em = NULL, concluido_por = NULL, atualizado_em = ? WHERE id = ? AND status_dia = 'concluido'").bind(now, agenda.id);
  const statements = [
    update,
    auditStatement(db, {
      id: auditId, onlyIfPreviousWrite: true,
      userId,
      action: status === "concluido" ? "dia_concluido" : "dia_reaberto",
      entity: "agenda",
      entityId: agenda.id,
      storeId: agenda.loja_id,
      agendaId: agenda.id,
      before: { dayStatus: agenda.status_dia },
      after: { dayStatus: status },
      details: status === "concluido" ? "Dia concluído pelo conferente ou administrador." : "Dia reaberto para ajustes.",
      createdAt: now
    }),
    ...(status === "concluido"
      ? nonattendanceStatements(
          db, "SELECT id FROM agendas WHERE id = ? AND EXISTS (SELECT 1 FROM auditoria WHERE id = ?)",
          [agenda.id, auditId], now
        )
      : []),
    db.prepare(
      "INSERT INTO historico_agenda (id, agenda_id, usuario_id, acao, detalhes, alterado_em) " +
      "SELECT ?, ?, ?, ?, NULL, ? WHERE EXISTS (SELECT 1 FROM auditoria WHERE id = ?)"
    ).bind(crypto.randomUUID(), agenda.id, userId, action, now, auditId)
  ];
  const result = await db.batch(statements);
  assertMutationApplied(result);
  const updated = await findAgendaById(db, agenda.id);
  if (!updated) throw new Error("Agenda atualizada não pôde ser relida.");
  return updated;
}

// Marcação interna do administrador: a agenda já foi digitada/repassada para o conferente.
// Não altera o status do dia nem publica eventos de tempo real (invisível ao conferente).
async function setAgendaDigitado(db: D1Database, agenda: AgendaRow, userId: string, digitado: boolean) {
  const alreadyDigitado = agenda.digitado_em != null;
  if (alreadyDigitado === digitado) {
    const current = await findAgendaById(db, agenda.id);
    if (!current) throw new Error("Agenda não pôde ser relida.");
    return current;
  }
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const update = digitado
    ? db.prepare(
      "UPDATE agendas SET digitado_em = ?, digitado_por = ?, atualizado_em = ? WHERE id = ? AND digitado_em IS NULL"
    ).bind(now, userId, now, agenda.id)
    : db.prepare(
      "UPDATE agendas SET digitado_em = NULL, digitado_por = NULL, atualizado_em = ? WHERE id = ? AND digitado_em IS NOT NULL"
    ).bind(now, agenda.id);
  const statements = [
    update,
    auditStatement(db, {
      id: auditId, onlyIfPreviousWrite: true,
      userId,
      action: digitado ? "agenda_digitada_para_conferente" : "agenda_digitacao_removida",
      entity: "agenda",
      entityId: agenda.id,
      storeId: agenda.loja_id,
      agendaId: agenda.id,
      before: { digitadoEm: agenda.digitado_em ?? null, digitadoPor: agenda.digitado_por ?? null },
      after: { digitadoEm: digitado ? now : null, digitadoPor: digitado ? userId : null },
      details: digitado
        ? "Agenda marcada como digitada para o conferente."
        : "Marcação de digitação para o conferente removida.",
      createdAt: now
    })
  ];
  const result = await db.batch(statements);
  assertMutationApplied(result);
  const updated = await findAgendaById(db, agenda.id);
  if (!updated) throw new Error("Agenda atualizada não pôde ser relida.");
  return updated;
}


export {
  nonattendanceStatements,
  AgendaBatchQueryBudgetError,
  changeAgendaDayStatus,
  changeAppointmentExchanges,
  changeAppointmentStatus,
  createAgendaImport,
  createManualAppointment,
  findAgendaById,
  findAgendaByStoreDate,
  findAppointmentById,
  findAppointmentForStore,
  findStoreAgendaByDate,
  findStoreByCode,
  importAgendaBatchAtomic,
  listAdminAgendas,
  listAdminAgendasPage,
  listAgendaHistory,
  listAppointmentHistory,
  listAppointmentsByAgenda,
  listStoreAgendas,
  listStoreAgendasPage,
  replaceAgendaImport,
  setAgendaDigitado,
  softDeleteManualAppointment,
  updateManualAppointmentSupplier
};