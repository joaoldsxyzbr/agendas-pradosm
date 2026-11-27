import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { AppEnv } from "../../worker/env.ts";
import { validateMutationOrigin, limitAgendaImportBody, MAX_IMPORT_JSON_BYTES } from "../../worker/lib/http.ts";

function fixture() {
  const app = new Hono<AppEnv>();
  app.use("/api/admin/*", validateMutationOrigin);
  app.post("/api/admin/example", (c) => c.json({ ok: true }));
  return app;
}

describe("Proteção de origem das mutações", () => {
  it("rejeita Origin externo", async () => {
    const response = await fixture().request("https://agendas.example/api/admin/example", { method: "POST", headers: { Origin: "https://other.example" } });
    assert.equal(response.status, 403);
  });
  it("aceita requisição de mesma origem", async () => {
    const response = await fixture().request("https://agendas.example/api/admin/example", { method: "POST", headers: { Origin: "https://agendas.example", "Sec-Fetch-Site": "same-origin" } });
    assert.equal(response.status, 200);
  });
  it("rejeita Fetch Metadata cross-site sem Origin", async () => {
    const response = await fixture().request("https://agendas.example/api/admin/example", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } });
    assert.equal(response.status, 403);
  });
  it("aceita cliente sem Fetch Metadata e sem Origin para compatibilidade", async () => {
    const response = await fixture().request("https://agendas.example/api/admin/example", { method: "POST" });
    assert.equal(response.status, 200);
  });
});
import { app as productionApp } from "../../worker/app.ts";

describe("Login e logout protegidos contra requisições cross-site", () => {
  it("bloqueia login sem Origin quando Fetch Metadata indica outro site", async () => {
    const response = await productionApp.request("https://agendas.example/api/auth/login", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" }, body: "{}" });
    assert.equal(response.status, 403);
  });
  it("bloqueia logout vindo de outra origem", async () => {
    const response = await productionApp.request("https://agendas.example/api/auth/logout", { method: "POST", headers: { Origin: "https://outro.example" } });
    assert.equal(response.status, 403);
  });
  it("mantém respostas normais de validação para login de mesma origem", async () => {
    const response = await productionApp.request("https://agendas.example/api/auth/login", { method: "POST", headers: { Origin: "https://agendas.example", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 400);
  });
});

describe("Limite de importação antes do parser", () => {
  function importFixture() {
    const app = new Hono<AppEnv>();
    app.use("/api/admin/agendas/import", limitAgendaImportBody);
    app.post("/api/admin/agendas/import", async c => c.json({ bytes: (await c.req.raw.arrayBuffer()).byteLength }));
    return app;
  }
  it("preserva o corpo no limite e rejeita um byte a mais sem Content-Length", async () => {
    const app = importFixture();
    const path = "https://agendas.example/api/admin/agendas/import";
    const valid = await app.request(path, { method: "POST", body: "x".repeat(MAX_IMPORT_JSON_BYTES) });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { bytes: MAX_IMPORT_JSON_BYTES });
    const invalid = await app.request(path, { method: "POST", body: "x".repeat(MAX_IMPORT_JSON_BYTES + 1) });
    assert.equal(invalid.status, 413);
  });
  it("conta bytes UTF-8, não caracteres", async () => {
    const response = await importFixture().request("https://agendas.example/api/admin/agendas/import", {
      method: "POST", body: "á".repeat(MAX_IMPORT_JSON_BYTES / 2 + 1)
    });
    assert.equal(response.status, 413);
  });
});
