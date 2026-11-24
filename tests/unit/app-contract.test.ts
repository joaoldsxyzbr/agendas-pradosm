import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = path =>
  // Checkout no Windows usa CRLF; normaliza para comparar com os contratos em JSON (LF).
  readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
describe("Worker em JavaScript preserva a main", () => {
  it("conserva as rotas e a ordem dos middlewares", () => {
    const expected = JSON.parse(source("./legacy-route-contracts.json")).app;
    const js = source("../../worker/app.ts");
    const paths = body => [...body.matchAll(/app\.(?:get|use|route)\(\s*["']([^"']+)["']/g)].map(hit => hit[0]);
    const extended=[...expected];
    extended.splice(extended.indexOf('app.use("/api/admin/agendas"'),0,'app.use("/api/admin/*"');
    assert.deepEqual(paths(js), extended);
    assert.ok(js.indexOf('app.use("/api/admin/*", enforceAccess)')<js.indexOf('app.route("/api/admin/stores"'));
    assert.match(js,/app\.route\("\/api\/admin\/reports"/);
    for (const forbidden of ["/api/auth/demo-login", "PREVIEW_DEMO_LOGIN"]) assert.equal(js.includes(forbidden), false);
  });
  it("mantém fechamento diário agendado e o Durable Object", () => {
    const js = source("../../worker/index.ts");
    assert.match(js, /async scheduled\(/);
    assert.match(js, /controller\.scheduledTime/);
    assert.match(js, /closePastOpenAgendas\(env\.DB/);
    assert.match(js, /RealtimeHub/);
  });
});
