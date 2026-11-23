import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findUserById, updateUser } from "../../worker/repositories/users.ts";
import {
  changeAgendaDayStatus,
  changeAppointmentExchanges,
  changeAppointmentStatus,
  createManualAppointment,
  findAgendaById,
  findAppointmentById,
  importAgendaBatchAtomic,
  replaceAgendaImport,
  softDeleteManualAppointment,
  updateManualAppointmentSupplier
} from "../../worker/repositories/agendas.ts";

// Reproduz o SQL real e a semântica transacional de D1.batch sem tocar D1 remoto.
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync("migrations").filter(n => /^\\d{4}_.*\\.sql$/.test(n)).sort()) {
    sqlite.exec(readFileSync(join("migrations", name), "utf8"));
  }
  const now = "2026-11-23T12:00:00.000Z";
  sqlite.prepare("INSERT INTO lojas (id,codigo,nome,criado_em,atualizado_em) VALUES (?,?,?,?,?)")
    .run("store1", "F01", "Loja sintética", now, now);
  const insertUser = sqlite.prepare(
    "INSERT INTO usuarios (id,loja_id,nome,login,senha_hash,papel,ativo,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,1,?,?)"
  );
  insertUser.run("adm", null, "Admin", "adm", "hash-ficticio-admin", "admin", now, now);
  insertUser.run("conf1", "store1", "Conferente", "conf1", "hash-ficticio-inicial", "conferente", now, now);
  const insertAgenda = sqlite.prepare(
    "INSERT INTO agendas (id,loja_id,data_agenda,arquivo_original,criado_por,status_dia,criado_em,atualizado_em) VALUES (?,?,?,?,?,'aberto',?,?)"
  );
  insertAgenda.run("agenda1", "store1", "2026-11-23", "original.csv", "adm", now, now);
  insertAgenda.run("agenda2", "store1", "2026-11-24", "original2.csv", "adm", now, now);
  sqlite.prepare(
    "INSERT INTO agendamentos (id,agenda_id,protocolo,horario_inicio,horario_fim,fornecedor,status,origem,ativo,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,'aguardando','importado',1,?,?)"
  ).run("appt1", "agenda1", "123456", "08:00", "09:00", "Fornecedor sintético", now, now);
  const db = {
    prepare(query) {
      const stmt = sqlite.prepare(query);
      let params = [];
      const bound = {
        bind(...values) { params = values; return bound; },
        async first() { return stmt.get(...params) ?? null; },
        async all() { return { results: stmt.all(...params) }; },
        async run() {
          const result = stmt.run(...params);
          return { success: true, meta: { changes: Number(result.changes) } };
        }
      };
      return bound;
    },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  const user = () => sqlite.prepare("SELECT * FROM usuarios WHERE id = 'conf1'").get();
  const agenda = id => sqlite.prepare("SELECT * FROM agendas WHERE id = ?").get(id);
  const appointment = id => sqlite.prepare("SELECT * FROM agendamentos WHERE id = ?").get(id);
  const auditCount = action => sqlite.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao = ?").get(action).n;
  return { db, sqlite, user, agenda, appointment, auditCount };
}

const conflict = error => error?.code === "CONFLITO_ESTADO";

function input(fileName, date = "2026-11-23", items = 2) {
  return {
    storeCode: "F01",
    date,
    originalFileName: fileName,
    replace: true,
    appointments: [{
      protocol: "123456",
      startTime: "08:00",
      endTime: "09:00",
      supplier: "Fornecedor sintético",
      items, volumes: 1, pallets: 1, cargaBatida: null,
      type: "Pedido", nfe: [], orders: []
    }]
  };
}

// Simula o instante em que uma chamada leu uma versão antiga antes de
// outra importação concluir; o SQL real deve rejeitar e reverter o batch.
function withStaleImportVersion(db, agendaId, staleVersion) {
  return {
    ...db,
    prepare(query) {
      if (!query.startsWith("SELECT versao_importacao FROM agendas")) return db.prepare(query);
      let selectedId;
      return {
        bind(id) { selectedId = id; return this; },
        async first() {
          if (selectedId === agendaId) return { versao_importacao: staleVersion };
          return db.prepare(query).bind(selectedId).first();
        }
      };
    }
  };
}

describe("Guardas integradas de concorrência", () => {
  it("não restaura hash antigo nem versão de sessão após edição concorrente", async () => {
    const f = fixture();
    try {
      const stale = await findUserById(f.db, "conf1");
      await updateUser(f.db, stale, { senha: "SenhaSinteticaNova2026!" }, "adm");
      const version = f.user().session_version;
      const hash = f.user().senha_hash;
      assert.equal(version, 2);
      assert.notEqual(hash, stale.senha_hash);
      await assert.rejects(updateUser(f.db, stale, { nome: "Nome obsoleto" }, "adm"), conflict);
      assert.equal(f.user().session_version, version);
      assert.equal(f.user().senha_hash, hash);
      assert.equal(f.user().nome, "Conferente");
      assert.equal(f.auditCount("usuario_atualizado"), 1);
    } finally { f.sqlite.close(); }
  });

  it("evita perda de alteração nominal mesmo sem incremento de sessão", async () => {
    const f = fixture();
    try {
      const stale = await findUserById(f.db, "conf1");
      await updateUser(f.db, stale, { nome: "Nome aprovado" }, "adm");
      await assert.rejects(updateUser(f.db, stale, { nome: "Nome concorrente" }, "adm"), conflict);
      assert.equal(f.user().nome, "Nome aprovado");
      assert.equal(f.user().session_version, 1);
      assert.equal(f.auditCount("usuario_atualizado"), 1);
    } finally { f.sqlite.close(); }
  });

  it("impede conferente de modificar status e trocas após fechamento, preservando ajuste admin", async () => {
    const f = fixture();
    try {
      await f.db.prepare("UPDATE agendamentos SET status = 'recebido' WHERE id = 'appt1'").run();
      const stale = await findAppointmentById(f.db, "appt1");
      await changeAgendaDayStatus(f.db, await findAgendaById(f.db, "agenda1"), "conf1", "concluido");
      await assert.rejects(
        changeAppointmentStatus(f.db, stale, "conf1", "recusado", undefined, null, true), conflict
      );
      await assert.rejects(
        changeAppointmentExchanges(f.db, stale, "conf1", true, null, true), conflict
      );
      assert.equal(f.appointment("appt1").status, "recebido");
      assert.equal(f.appointment("appt1").trocas, 0);
      await changeAppointmentStatus(
        f.db, await findAppointmentById(f.db, "appt1"), "adm", "recusado", "Ajuste administrativo.", null
      );
      assert.equal(f.appointment("appt1").status, "recusado");
      assert.equal(f.auditCount("status_alterado"), 1);
    } finally { f.sqlite.close(); }
  });

  it("impede criação, edição e exclusão de fornecedores manuais após fechamento", async () => {
    const f = fixture();
    try {
      const agenda = await findAgendaById(f.db, "agenda1");
      const manual = await createManualAppointment(f.db, agenda, "conf1", "Fornecedor manual", "09:00", null, true);
      await changeAgendaDayStatus(f.db, agenda, "conf1", "concluido");
      await assert.rejects(
        createManualAppointment(f.db, agenda, "conf1", "Fornecedor tardio", "10:00", null, true), conflict
      );
      await assert.rejects(
        updateManualAppointmentSupplier(f.db, agenda, manual, "conf1", "Novo nome", null, true), conflict
      );
      await assert.rejects(
        softDeleteManualAppointment(f.db, agenda, manual, "conf1", null, true), conflict
      );
      assert.equal(f.appointment(manual.id).ativo, 1);
      assert.equal(f.appointment(manual.id).fornecedor, "Fornecedor manual");
      assert.equal(f.auditCount("fornecedor_manual_criado"), 1);
      assert.equal(f.auditCount("fornecedor_manual_editado"), 0);
      assert.equal(f.auditCount("fornecedor_manual_removido"), 0);
    } finally { f.sqlite.close(); }
  });

  it("rejeita uma substituição stale e mantém íntegros a agenda, agendamentos e auditoria", async () => {
    const f = fixture();
    try {
      const agenda = await findAgendaById(f.db, "agenda1");
      await replaceAgendaImport(f.db, agenda, "adm", input("primeira.csv", "2026-11-23", 5));
      const staleDb = withStaleImportVersion(f.db, "agenda1", 0);
      await assert.rejects(
        replaceAgendaImport(staleDb, agenda, "adm", input("obsoleta.csv", "2026-11-23", 8)),
        /ck_agenda_versao_importacao/
      );
      assert.equal(f.agenda("agenda1").versao_importacao, 1);
      assert.equal(f.agenda("agenda1").arquivo_original, "primeira.csv");
      assert.equal(f.appointment("appt1").itens, 5);
      assert.equal(f.auditCount("agenda_substituida"), 1);
    } finally { f.sqlite.close(); }
  });

  it("faz rollback de TODO o lote se uma das agendas perdeu a corrida", async () => {
    const f = fixture();
    try {
      const a1 = await findAgendaById(f.db, "agenda1");
      const a2 = await findAgendaById(f.db, "agenda2");
      await replaceAgendaImport(f.db, a2, "adm", input("agenda2-primeira.csv", "2026-11-24", 4));
      const staleDb = withStaleImportVersion(f.db, "agenda2", 0);
      await assert.rejects(
        importAgendaBatchAtomic(staleDb, "adm", [
          { storeId: "store1", existing: a1, input: input("agenda1-nova.csv") },
          { storeId: "store1", existing: a2, input: input("agenda2-stale.csv", "2026-11-24") }
        ]),
        /ck_agenda_versao_importacao/
      );
      assert.equal(f.agenda("agenda1").versao_importacao, 0);
      assert.equal(f.agenda("agenda1").arquivo_original, "original.csv");
      assert.equal(f.agenda("agenda2").versao_importacao, 1);
      assert.equal(f.agenda("agenda2").arquivo_original, "agenda2-primeira.csv");
      assert.equal(f.auditCount("agenda_substituida"), 1);
    } finally { f.sqlite.close(); }
  });
});
