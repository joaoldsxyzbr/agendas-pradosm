import { recordingD1, agendaFixture, appointmentFixture } from "../helpers/recording-d1.ts";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { changeAppointmentStatus } from "../../worker/repositories/agendas.ts";

const baseAppointment = appointmentFixture();

function fakeDb() {
  return recordingD1({ first(sql) {
    if (sql.includes("FROM agendas a")) return agendaFixture({store_code: "01"});
    if (sql.includes("FROM agendamentos WHERE id = ?")) return {...baseAppointment, status: "recebido"};
    throw Error("Consulta não esperada: " + sql);
  } });
}

describe("Regras de status com observação e histórico", () => {
  it("não faz operações D1 quando status não muda", async () => {
    const db = fakeDb();
    const result = await changeAppointmentStatus(db, baseAppointment, "admin1", "aguardando");
    assert.equal(result, baseAppointment);
    assert.equal(db.statements.length, 0);
  });

  it("grava status, histórico e auditoria em um único batch", async () => {
    const db = fakeDb();
    const result = await changeAppointmentStatus(db, baseAppointment, "admin1", "recebido");
    assert.ok(result);
    assert.equal(result.status, "recebido");
    assert.equal(db.batches.length, 1);
    assert.equal(db.batches[0].length, 3);
    const statusUpdate = db.statements.find(s => s.sql.startsWith("UPDATE agendamentos"));
    assert.ok(statusUpdate);
    assert.equal(statusUpdate.sql, "UPDATE agendamentos SET status = ?, observacao = ?, atualizado_em = ? WHERE id = ? AND status = ? AND observacao IS ? AND ativo = 1");
    assert.deepEqual(statusUpdate.params.slice(-2), ["aguardando", null]);
    assert.ok(statusUpdate);
    assert.equal(statusUpdate.params[1], null);
    assert.ok(statusUpdate);
    assert.equal(statusUpdate.params[0], "recebido");
    const history = db.statements.find(s => s.sql.includes("INSERT INTO historico_status"));
    assert.ok(history);
    const audit = db.statements.find(s => s.sql.includes("INSERT INTO auditoria"));
    assert.ok(audit);
    assert.match(audit.sql, /WHERE changes\(\) = 1/);
    assert.match(history.sql, /EXISTS \(SELECT 1 FROM auditoria/);
    assert.equal(JSON.stringify(db.statements).includes("observacao"), true);
  });
  it("bloqueia não recebido sem motivo e não altera o banco", async () => {
    const db = fakeDb();
    await assert.rejects(
      changeAppointmentStatus(db, baseAppointment, "conf1", "nao_chegou"),
      /Motivo obrigatório/
    );
    assert.equal(db.batches.length, 0);
  });
  it("salva o motivo em status, histórico e auditoria", async () => {
    const db = fakeDb();
    await changeAppointmentStatus(db, baseAppointment, "conf1", "nao_chegou", undefined, "Sem pedido");
    const statusUpdate = db.statements.find(s => s.sql.startsWith("UPDATE agendamentos"));
    const history = db.statements.find(s => s.sql.includes("INSERT INTO historico_status"));
    assert.ok(statusUpdate);
    assert.equal(statusUpdate.params[1], "Sem pedido");
    assert.ok(history);
    assert.equal(history.params[5], "Sem pedido");
    assert.equal(db.batches.length, 1);
  });
  it("limpa a observação atual sem perder o histórico anterior", async () => {
    const db = fakeDb();
    await changeAppointmentStatus(db, { ...baseAppointment, status: "nao_chegou", observacao: "Sem pedido" },
      "conf1", "recebido");
    const statusUpdate = db.statements.find(s => s.sql.startsWith("UPDATE agendamentos"));
    const history = db.statements.find(s => s.sql.includes("INSERT INTO historico_status"));
    assert.ok(statusUpdate);
    assert.equal(statusUpdate.params[1], null);
    assert.ok(history);
    assert.equal(history.params[3], "nao_chegou");
    assert.ok(history);
    assert.equal(history.params[4], "recebido");
  });
});