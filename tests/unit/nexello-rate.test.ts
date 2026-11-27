import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { reserveNexelloRequest } from "../../worker/repositories/nexello-rate.ts";

test("reservation is atomic, global, and expires without a network call", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(readFileSync(new URL("../../migrations-v2/0003_nexello_rate.sql",import.meta.url),"utf8"));
    const db = { prepare(sql: string) { return { async run() {
      const result = sqlite.prepare(sql).run();
      return { success:true, meta:{ changes:Number(result.changes) } };
    }}; }} as unknown as D1Database;
    assert.deepEqual(await Promise.all([reserveNexelloRequest(db),reserveNexelloRequest(db)]),[true,false]);
    sqlite.exec("UPDATE nexello_limite_consulta SET proxima_consulta_em=unixepoch('now')-1");
    assert.equal(await reserveNexelloRequest(db),true);
    assert.equal(await reserveNexelloRequest(db),false);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM nexello_limite_consulta").get()?.n,1);
  } finally { sqlite.close(); }
});

test("reservation fails closed on database error", async () => {
  const db={prepare(){return {async run(){return {success:false,meta:{changes:0}}}}}} as unknown as D1Database;
  await assert.rejects(reserveNexelloRequest(db),/NEXELLO_RESERVA_FALHOU/);
});
