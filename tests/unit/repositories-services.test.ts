import { recordingD1 } from "../helpers/recording-d1.ts";
import { testEnv } from "../helpers/sqlite-d1.ts";
import type { UserRow } from "../../worker/repositories/users.ts";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listAudit, parseAuditJson } from "../../worker/repositories/audit.ts";
import { listStores, findActiveStoreById, hasStoreUsers } from "../../worker/repositories/stores.ts";
import { listUsers, findUserByLogin, updateUser, upgradeUserPasswordHash } from "../../worker/repositories/users.ts";
import { closePastOpenAgendas } from "../../worker/services/agenda-maintenance.ts";
import { publishAgendaChanged, revokeRealtimeUser } from "../../worker/services/realtime.ts";

function fakeDb(results: unknown[] = []) {
  return recordingD1({ all: () => results, first: () => results[0] ?? null,
    batch(statements) { assert.ok(statements.length >= 2); return 1; }
  });
}

describe("Migração de repositórios e serviços JS", () => {
  it("auditoria mantém filtros e limite de consulta", async () => {
    const db = fakeDb([{ id: "a" }]);
    const rows = await listAudit(db, { entity: "agenda", agendaId: "a", limit: 999 });
    assert.deepEqual(rows, [{ id: "a" }]);
    assert.match(db.calls[0].sql, /ORDER BY a\.criado_em DESC/);
    assert.deepEqual(db.calls[0].values, ["agenda", "a", 500]);
    assert.deepEqual(parseAuditJson('{"acao":"status"}'), { acao: "status" });
    assert.equal(parseAuditJson("{quebrado"), null);
  });
  it("lojas e conferentes usam as mesmas consultas parametrizadas", async () => {
    const db = fakeDb([{ id: "l1", codigo: "01" }]);
    assert.equal((await listStores(db)).length, 1);
    assert.match(db.calls[0].sql, /tem_conferente_ativo|CASE WHEN EXISTS/);
    assert.equal((await findActiveStoreById(db, "l1"))?.id, "l1");
    assert.deepEqual(db.calls[1].values, ["l1"]);
    assert.equal(await hasStoreUsers(db, "l1"), true);
  });
  it("usuários preservam papel, versão de sessão e filtro de login", async () => {
    const db = fakeDb([{ id: "u", papel: "conferente" }]);
    assert.equal((await listUsers(db)).length, 1);
    assert.match(db.calls[0].sql, /session_version/);
    assert.equal((await findUserByLogin(db, "Usuario"))?.id, "u");
    assert.deepEqual(db.calls[1].values, ["Usuario"]);
    assert.match(db.calls[1].sql, /COLLATE NOCASE/);
  });
  it("invalida sessões quando mudam papel, loja, login, senha ou situação", async () => {
    const current: UserRow = {
      id: "u", loja_id: "loja-1", nome: "Pessoa", login: "conta",
      senha_hash: "hash-ficticio", papel: "conferente", ativo: 1, session_version: 5, excluido_em: null
    };
    const cases: [Parameters<typeof updateUser>[2], number][] = [
      [{ papel: "admin" }, 6],
      [{ lojaId: "loja-2" }, 6],
      [{ login: "outra-conta" }, 6],
      [{ ativo: false }, 6],
      [{ nome: "Novo nome" }, 5],
      [{ login: "conta", papel: "conferente", lojaId: "loja-1", ativo: true }, 5]
    ];
    for (const [change, expectedVersion] of cases) {
      const db = fakeDb([{ ...current, session_version: expectedVersion }]);
      await updateUser(db, current, change, "admin");
      assert.equal(db.calls[0].values[6], expectedVersion, JSON.stringify(change));
      assert.match(db.calls[0].sql, /session_version = \?/);
      assert.match(db.calls[1].sql, /INSERT INTO auditoria/);
    }
    const route = (await import("node:fs")).readFileSync(
      new URL("../../worker/routes/admin-users.ts", import.meta.url), "utf8"
    );
    assert.match(route, /user\.session_version !== current\.session_version/);
    assert.match(route, /revokeRealtimeUser\(c\.env, current\.id, "terminate"\)/);
    assert.doesNotMatch(route, /revokeRealtimeUser\(c\.env, current\.id, "refresh"\)/);
  });
  it("upgrade de hash não sobrescreve senha trocada simultaneamente", async () => {
    const db = fakeDb();
    const updated = await upgradeUserPasswordHash(db, "user1", "hash-antigo", "hash-novo");
    assert.equal(updated, true);
    assert.match(db.calls[0].sql, /WHERE id = \? AND senha_hash = \? AND excluido_em IS NULL/);
    assert.equal(db.calls[0].values[0], "hash-novo");
    assert.equal(db.calls[0].values[2], "user1");
    assert.equal(db.calls[0].values[3], "hash-antigo");
    const stale = recordingD1({ changes(sql, values) {
      assert.match(sql, /senha_hash = \\?/);
      assert.equal(values[3], "hash-antigo");
      return 0;
    } });
    assert.equal(await upgradeUserPasswordHash(stale, "user1", "hash-antigo", "hash-novo"), false);
  });
  it("fechamento diário preserva SQL de auditoria e regra de reabertura", async () => {
    const db = fakeDb([{ id: "agenda-antiga" }]);
    await closePastOpenAgendas(db, new Date("2026-10-18T15:00:00Z"));
    assert.equal(db.calls.length, 5);
    assert.match(db.calls[0].sql, /SELECT 1 FROM agendas/);
    assert.match(db.calls[1].sql, /nao_compareceu_automaticamente/);
    assert.match(db.calls[2].sql, /UPDATE agendamentos/);
    assert.match(db.calls[3].sql, /INSERT INTO auditoria/);
    assert.match(db.calls[4].sql, /UPDATE agendas/);
    for (const call of db.calls) {
      assert.match(call.sql, /reaberto/);
      assert.ok(call.values.includes("2026-10-18"));
    }
  });
  it("tempo real desligado não dispara requisição ao Durable Object", async () => {
    const env = testEnv(fakeDb(), "segredo-sintetico");
    assert.equal(await publishAgendaChanged(env, { agendaId: "a", storeId: "loja1", date: "2026-11-03", reason: "status" }), false);
    assert.equal(await revokeRealtimeUser(env, "u1"), false);
  });
});