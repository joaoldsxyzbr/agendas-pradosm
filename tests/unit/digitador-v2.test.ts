import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openLocalDatabase } from "../../scripts/local-sqlite.mjs";
import { buildMockSql, mockId } from "../../scripts/mock-data.mjs";
import { app } from "../../worker/app.ts";
import { businessDate } from "../../shared/time.ts";

test("Digitador V2: acesso operacional, bloqueio de administração, sessão e Nexello", async () => {
  const local = openLocalDatabase(":memory:", fileURLToPath(new URL("../../migrations-v2/", import.meta.url)));
  try {
    const password = "senha-ficticia-digitador-123";
    local.seed(await buildMockSql(password, new Date(), { access: true, v2: true }));
    const env = {
      DB: local.DB, SESSION_SECRET: "segredo-sintetico-digitador-v2-sem-producao-123456789",
      REALTIME_MODE: "off", ACCESS_MODE: "on", LOGIN_RATE_LIMITER: { async limit() { return { success: true }; } },
    };
    const origin = "http://localhost";
    async function request(path: string, method = "GET", cookie = "", body?: unknown) {
      const headers = new Headers({ Origin: origin });
      if (cookie) headers.set("Cookie", cookie);
      if (body !== undefined) headers.set("Content-Type", "application/json");
      return app.request(origin + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    }
    async function login(loginName: string) {
      const response = await request("/api/auth/login", "POST", "", { login: loginName, senha: password });
      assert.equal(response.status, 200, loginName);
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      return { cookie, user: await response.json() };
    }
    const admin = await login("admin.mock");
    const digitador = await login("digitador.mock");
    const viewer = await login("gerente.mock");
    assert.equal(digitador.user.perfil, "digitador");
    assert.deepEqual(digitador.user.escopo, { mode: "all" });
    const day = businessDate();
    for (const path of ["/api/admin/agendas", "/api/admin/stores", "/api/admin/reports?start="+day+"&end="+day, "/api/admin/nexello/config"])
      assert.equal((await request(path, "GET", digitador.cookie)).status, 200, path);
    assert.equal((await request("/api/admin/nexello/config", "GET", admin.cookie)).status, 200);
    assert.equal((await request("/api/admin/nexello/config", "GET", viewer.cookie)).status, 403);
    assert.equal((await request("/api/admin/nexello/pages/1", "POST", digitador.cookie)).status, 503);
    const store = mockId("store:1");
    for (const [method,path] of [
      ["GET","/api/admin/users"], ["POST","/api/admin/users"], ["PATCH","/api/admin/users"],
      ["GET","/api/admin/users/"+admin.user.id+"/access"], ["PUT","/api/admin/users/"+admin.user.id+"/access"],
      ["GET","/api/admin/audit"], ["GET","/api/admin/diagnostics"],
      ["GET","/api/admin/retention/status"], ["POST","/api/admin/retention/run"],
      ["POST","/api/admin/stores"], ["PATCH","/api/admin/stores"], ["DELETE","/api/admin/stores/"+store],
    ] as const) assert.equal((await request(path,method,digitador.cookie)).status,403,method+" "+path);
    const cfg = await request("/api/admin/users/"+digitador.user.id+"/access","GET",admin.cookie);
    assert.equal(cfg.status,200);
    const version = (await cfg.json()).sessionVersion;
    const invalid = await request("/api/admin/users/"+digitador.user.id+"/access","PUT",admin.cookie,{
      version,access:{profile:"digitador",scope:{mode:"all"},overrides:[{permission:"usuarios.ver",effect:"allow"}]}
    });
    assert.equal(invalid.status,400);
    const restricted = await request("/api/admin/users/"+digitador.user.id+"/access","PUT",admin.cookie,{
      version,access:{profile:"digitador",scope:{mode:"assigned",storeIds:[store]},overrides:[]}
    });
    assert.equal(restricted.status,200);
    assert.equal((await request("/api/auth/me","GET",digitador.cookie)).status,401);
    const scoped=await login("digitador.mock");
    assert.equal((await request("/api/admin/nexello/config","GET",scoped.cookie)).status,403);
  } finally { local.close(); }
});
