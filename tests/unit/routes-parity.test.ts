import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const load = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function routePatterns(source: string): string[] {
  // `[^"']*` também casa o caminho raiz "/" — contratos anteriores ignoravam
  // esses endpoints por exigirem um caractere após a barra.
  return [...source.matchAll(/\b(?:get|post|patch|put|delete)\(\s*["'](\/[^"']*)["']/g)].map(hit => hit[0]);
}
describe("Superfície de rotas da main preservada", () => {
  for (const path of ["admin-audit", "admin-stores", "admin-users", "presence", "realtime", "avisos"]) {
    it(path + " possui os mesmos endpoints da main", () => {
      const root = "../../worker/routes/" + path;
      const expected=JSON.parse(load("./legacy-route-contracts.json")).routes[path];
      const extended=path==="admin-users"?['get("/:id/access"','put("/:id/access"',...expected]:expected;
      assert.deepEqual(routePatterns(load(root + ".ts")),extended);
    });
  }
  it("middleware mantém autenticação e permissões por papel", () => {
    const src = load("../../worker/middleware/auth.ts");
    for (const token of ["requireAuth", "requireAdmin", "restrictDashboardViewer", "SESSION_MAX_AGE"]) assert.ok(src.includes(token), token);
  });
  it("Durable Object mantém os eventos, publicação e revogação", () => {
    const src = load("../../worker/realtime/RealtimeHub.ts");
    for (const token of ["presence.set","presence.changed","agenda.changed","/internal/publish","/internal/revoke"]) assert.ok(src.includes(token), token);
  });
});
