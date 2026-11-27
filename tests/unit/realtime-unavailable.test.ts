import { it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { DatabaseSync } from "node:sqlite";
import type { AppEnv } from "../../worker/env.ts";
import { realtimeRoutes } from "../../worker/routes/realtime.ts";
import { sqliteD1, testEnv } from "../helpers/sqlite-d1.ts";

it("hub indisponível devolve 503 controlado e mantém a consulta HTTP",async()=>{
  const sqlite=new DatabaseSync(":memory:");
  try {
    const app=new Hono<AppEnv>();
    const env=testEnv(sqliteD1(sqlite),"fixture-local");
    env.REALTIME_MODE="on";
    app.use("*",async(c,next)=>{
      c.set("authUser",{id:"adm",nome:"Fixture",papel:"admin",lojaId:null,lojaCodigo:null,lojaNome:null});
      c.set("sessionExpiresAt",Date.now()+60_000);
      await next();
    });
    app.route("/api/realtime",realtimeRoutes);
    app.get("/api/http-fallback",async c=>c.json(await c.env.DB.prepare("SELECT 1 AS ok").first()));
    const headers={Origin:"https://local.invalid",Upgrade:"websocket"};
    const response=await app.request("https://local.invalid/api/realtime", {headers},env);
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:"REALTIME_INDISPONIVEL",message:"Tempo real temporariamente indisponível."});
    const fallback=await app.request("https://local.invalid/api/http-fallback",{},env);
    assert.equal(fallback.status,200);
    assert.deepEqual(await fallback.json(),{ok:1});
  } finally {sqlite.close();}
});
