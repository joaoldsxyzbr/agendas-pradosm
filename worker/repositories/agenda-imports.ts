import type { z } from "zod";
import type { ImportAgendaInput } from "../../shared/agenda.ts";
import { listAppointmentsByAgenda, type AgendaRow, type AppointmentRow } from "./agenda-queries.ts";
import { auditStatement } from "./audit.ts";
type ImportInput = z.infer<typeof ImportAgendaInput>;
type ImportedAppointment = ImportInput["appointments"][number];
export interface ImportEntry { existing: AgendaRow | null; input: ImportInput; storeId: string; }

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

export { AgendaBatchQueryBudgetError, createAgendaImport, replaceAgendaImport, importAgendaBatchAtomic };
