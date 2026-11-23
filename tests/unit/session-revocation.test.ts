import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../../worker/app.ts";
import { createSessionToken, sessionKey, verifySessionToken } from "../../worker/lib/session.ts";
import { pruneRevokedSessions } from "../../worker/repositories/users.ts";

const SECRET = "segredo-somente-teste-local-revogacao-2026";

function fixture(withAdmin = true) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync("migrations").filter(n => /^\d+_.*\.sql$/.test(n)).sort()) {
    sqlite.exec(readFileSync(join("migrations", name), "utf8"));
  }
  if (withAdmin) {
    sqlite.prepare("INSERT INTO usuarios (id,nome,login,senha_hash,papel,ativo,criado_em,atualizado_em) VALUES ('adm','Admin sintético','adm','hash-teste','admin',1,?,?)")
      .run("2026-11-23T12:00:00.000Z", "2026-11-23T12:00:00.000Z");
  }
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      let params = [];
      const bound = {
        bind(...values) { params = values; return bound; },
        async first() { return stmt.get(...params) ?? null; },
        async all() { return { results: stmt.all(...params) }; },
        async run() {
          const result = stmt.run(...params);
          return { meta: { changes: Number(result.changes) } };
        }
      };
      return bound;
    }
  };
  const env = { DB: db, SESSION_SECRET: SECRET, REALTIME_MODE: "off" };
  const call = (token, path, method = "GET") => app.request("http://localhost" + path, {
    method,
    headers: {
      Cookie: "agenda_session=" + token,
      Origin: "http://localhost"
    }
  }, env);
  const count = () => sqlite.prepare("SELECT COUNT(*) AS n FROM sessoes_revogadas").get().n;
  return { sqlite, db, call, count };
}

async function legacyToken(userId) {
  const json = JSON.stringify({ userId, sessionVersion: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
  const payload = Buffer.from(json).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return payload + "." + Buffer.from(signature).toString("base64url");
}

describe("Revogação individual de sessões com D1 sintético", () => {
  it("logout invalida apenas a sessão atual e preserva a outra sessão do mesmo usuário", async () => {
    const f = fixture();
    try {
      const a = await createSessionToken("adm", 1, SECRET);
      const b = await createSessionToken("adm", 1, SECRET);
      assert.equal((await f.call(a, "/api/auth/me")).status, 200);
      assert.equal((await f.call(b, "/api/auth/me")).status, 200);
      const payloadA = await verifySessionToken(a, SECRET);
      assert.ok(payloadA?.sessionId);
      const refreshA = await createSessionToken("adm", 1, SECRET, Date.now(), payloadA.sessionId);
      assert.equal((await verifySessionToken(refreshA, SECRET)).sessionId, payloadA.sessionId);
      const logout = await f.call(a, "/api/auth/logout", "POST");
      assert.equal(logout.status, 204);
      assert.equal(f.count(), 1);
      assert.equal((await f.call(a, "/api/auth/me")).status, 401);
      assert.equal((await f.call(refreshA, "/api/auth/me")).status, 401,
        "Token renovado com a mesma identidade também deve ser revogado");
      assert.equal((await f.call(b, "/api/auth/me")).status, 200);
    } finally { f.sqlite.close(); }
  });

  it("cookies antigos sem sessionId continuam válidos até logout e são revogados pelo hash", async () => {
    const f = fixture();
    try {
      const old = await legacyToken("adm");
      const payload = await verifySessionToken(old, SECRET);
      assert.equal(payload?.sessionId, null);
      assert.match(await sessionKey(old, payload), /^legacy:[a-f0-9]{64}$/);
      assert.equal((await f.call(old, "/api/auth/me")).status, 200);
      assert.equal((await f.call(old, "/api/auth/logout", "POST")).status, 204);
      assert.equal((await f.call(old, "/api/auth/me")).status, 401);
    } finally { f.sqlite.close(); }
  });

  it("remoção de revogações expiradas não remove sessões ainda relevantes", async () => {
    const f = fixture();
    try {
      const now = Math.floor(Date.now() / 1000);
      f.sqlite.prepare("INSERT INTO sessoes_revogadas VALUES ('expired', ?)").run(now - 10);
      f.sqlite.prepare("INSERT INTO sessoes_revogadas VALUES ('future', ?)").run(now + 3600);
      await pruneRevokedSessions(f.db, now);
      assert.equal(f.count(), 1);
      assert.equal(f.sqlite.prepare("SELECT session_key FROM sessoes_revogadas").get().session_key, "future");
    } finally { f.sqlite.close(); }
  });

  it("bootstrap público é limitado pelo rate limiter existente e falha fechado", async () => {
    const f = fixture(false);
    try {
      const data = JSON.stringify({ nome: "Usuário sintético", login: "admin", senha: "SenhaSintetica2026!" });
      const request = (limiter) => app.request("http://localhost/api/auth/bootstrap-register", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: data
      }, { DB: f.db, SESSION_SECRET: SECRET, LOGIN_RATE_LIMITER: limiter });
      assert.equal((await request(undefined)).status, 503);
      assert.equal((await request({ limit: async () => ({ success: false }) })).status, 429);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM usuarios").get().n, 0);
    } finally { f.sqlite.close(); }
  });
});
