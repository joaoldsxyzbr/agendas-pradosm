import { recordingD1, agendaFixture } from "../helpers/recording-d1.ts";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setAgendaDigitado } from "../../worker/repositories/agendas.ts";

const baseAgenda = agendaFixture();

function fakeDb(agenda = { ...baseAgenda }) {
  let current = agenda;
  const flags = { failChanges: false };
  const db = recordingD1({
    first(sql) {
      if (sql.includes("FROM agendas a")) return { ...current };
      throw Error("Consulta não esperada: " + sql);
    },
    batch(rows) {
      if (flags.failChanges) return 0;
      const update = rows[0];
      if (update.sql.includes("digitado_em IS NOT NULL")) current = { ...current, digitado_em: null, digitado_por: null };
      else if (update.sql.includes("digitado_em IS NULL")) {
        assert.ok(typeof update.params[0] === "string" && typeof update.params[1] === "string");
        current = { ...current, digitado_em: update.params[0], digitado_por: update.params[1] };
      }
      return 1;
    }
  });
  return Object.assign(db, { flags });
}

describe("Marcação de agenda digitada para o conferente", () => {
  it("não faz operações D1 quando a marcação não muda", async () => {
    const db = fakeDb({ ...baseAgenda, digitado_em: "2026-11-03T10:00:00.000Z", digitado_por: "adm" });
    const result = await setAgendaDigitado(db, { ...baseAgenda, digitado_em: "2026-11-03T10:00:00.000Z" }, "adm", true);
    assert.ok(result);
    assert.equal(result.digitado_em, "2026-11-03T10:00:00.000Z");
    assert.equal(db.batches.length, 0);
  });

  it("marca digitada com guarda concorrente e auditoria em um único batch", async () => {
    const db = fakeDb();
    const result = await setAgendaDigitado(db, { ...baseAgenda }, "admin1", true);
    assert.ok(result);
    assert.equal(result.digitado_em, db.batches[0][0].params[0]);
    assert.equal(result.digitado_por, "admin1");
    assert.equal(db.batches.length, 1);
    assert.equal(db.batches[0].length, 2);
    const update = db.statements.find(s => s.sql.startsWith("UPDATE agendas"));
    assert.ok(update);
    assert.equal(update.sql,
      "UPDATE agendas SET digitado_em = ?, digitado_por = ?, atualizado_em = ? WHERE id = ? AND digitado_em IS NULL");
    assert.equal(update.params[1], "admin1");
    assert.equal(update.params[3], "agenda1");
    const audit = db.statements.find(s => s.sql.includes("INSERT INTO auditoria"));
    assert.ok(audit);
    assert.equal(audit.params[2], "agenda_digitada_para_conferente");
    assert.ok(audit.sql.includes("WHERE changes() = 1"));
  });

  it("remove a marcação com guarda e auditoria próprias", async () => {
    const db = fakeDb({ ...baseAgenda, digitado_em: "2026-11-03T10:00:00.000Z", digitado_por: "admin1" });
    const result = await setAgendaDigitado(
      db,
      { ...baseAgenda, digitado_em: "2026-11-03T10:00:00.000Z", digitado_por: "admin1" },
      "admin1",
      false
    );
    assert.ok(result);
    assert.equal(result.digitado_em, null);
    assert.equal(result.digitado_por, null);
    const update = db.statements.find(s => s.sql.startsWith("UPDATE agendas"));
    assert.ok(update);
    assert.equal(update.sql,
      "UPDATE agendas SET digitado_em = NULL, digitado_por = NULL, atualizado_em = ? WHERE id = ? AND digitado_em IS NOT NULL");
    const audit = db.statements.find(s => s.sql.includes("INSERT INTO auditoria"));
    assert.ok(audit);
    assert.equal(audit.params[2], "agenda_digitacao_removida");
  });

  it("conflito concorrente falha sem registrar auditoria fictícia", async () => {
    const db = fakeDb();
    db.flags.failChanges = true;
    await assert.rejects(
      setAgendaDigitado(db, { ...baseAgenda }, "admin1", true),
      error => error instanceof Error && error.message.includes("alterado por outra operação")
    );
    assert.equal(db.batches.length, 1);
  });
});
