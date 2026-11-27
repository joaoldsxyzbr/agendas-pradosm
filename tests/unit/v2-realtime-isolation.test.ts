import { it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { DatabaseSync } from "node:sqlite";
import type { AppEnv } from "../../worker/env.ts";
import type { AuthUser } from "../../shared/auth.ts";
import { realtimeRoutes } from "../../worker/routes/realtime.ts";
import { sqliteD1, testEnv } from "../helpers/sqlite-d1.ts";

it("realtime off and customized profiles cannot contact legacy hub", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const env = testEnv(sqliteD1(sqlite), "fixture-local");
    let calls = 0;
    env.REALTIME_HUB = {
      idFromName() { calls++; throw new Error("hub access not expected"); },
      idFromHex() { calls++; throw new Error("hub access not expected"); },
      get() { calls++; throw new Error("hub access not expected"); },
    };
    const admin: AuthUser = { id: "admin", nome: "Fixture", papel: "admin", lojaId: null, lojaCodigo: null, lojaNome: null };
    let actor = admin;
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("authUser", actor);
      c.set("sessionExpiresAt", Math.floor(Date.now() / 1000) + 60);
      await next();
    });
    app.route("/api/realtime", realtimeRoutes);
    const headers = { Origin: "https://local.invalid", Upgrade: "websocket" };
    const upgrade = () => app.request("https://local.invalid/api/realtime", { headers }, env);
    const config = () => app.request("https://local.invalid/api/realtime/config", {}, env);
    assert.equal((await upgrade()).status, 503);
    assert.deepEqual(await (await config()).json(), { mode: "off", protocolVersion: 1 });
    actor = { ...admin, perfil: "digitador", escopo: { mode: "all" } };
    env.REALTIME_MODE = "on";
    assert.equal((await upgrade()).status, 403);
    assert.deepEqual(await (await config()).json(), { mode: "off", protocolVersion: 1 });
    assert.equal(calls, 0);
  } finally { sqlite.close(); }
});
