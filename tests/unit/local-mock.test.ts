import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { buildMockSql, mockId, MOCK_ACCOUNTS, mockImportCsv } from "../../scripts/mock-data.mjs";
import { verifyPassword } from "../../worker/lib/password.ts";
import { businessDate } from "../../shared/time.ts";
import { parseAgendaCsv } from "../../shared/import/parseAgendaBatch.ts";

const now=new Date("2026-11-24T15:00:00Z");

test("seed mock: migrations reais, perfis disponíveis, agendas da data operacional e idempotência",async()=>{
  const db=new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    for(const file of readdirSync(new URL("../../migrations-v2/",import.meta.url)).filter(n=>/^\d{4}_.*\.sql$/.test(n)).sort()){
      db.exec(readFileSync(new URL("../../migrations-v2/"+file,import.meta.url),"utf8"));
    }
    const password=randomBytes(18).toString("base64url");
    const seed=await buildMockSql(password,now,{access:true,v2:true});
    db.exec(seed);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM lojas").get()?.n ?? 0),3);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM usuario_acesso WHERE perfil='digitador' AND ativo=1").get()?.n ?? 0),1);
    const users=db.prepare("SELECT * FROM usuarios").all();
    assert.equal(users.length,MOCK_ACCOUNTS.length);
    assert.deepEqual(new Set(users.map(u=>u.papel)),new Set(["admin","visualizador","conferente"]));
    for (const u of users) assert.equal(await verifyPassword(password,u.senha_hash),true);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM agendas").get()?.n ?? 0),21);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agendas WHERE data_agenda=? AND status_dia='aberto'").get(businessDate(now)).n,3);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM agendamentos").get()?.n ?? 0),126);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM agendamentos WHERE origem='manual'").get()?.n ?? 0),21);
    assert.ok(Number(db.prepare("SELECT COUNT(*) AS n FROM historico_status").get()?.n ?? 0)>0);
    assert.ok(Number(db.prepare("SELECT COUNT(*) AS n FROM auditoria").get()?.n ?? 0)>0);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM avisos").get()?.n ?? 0),1);
    const user=mockId("user:admin.mock");
    db.prepare("UPDATE usuarios SET nome=? WHERE id=?").run("Alterado pelo teste",user);
    const first=String(db.prepare("SELECT id FROM agendamentos WHERE status='aguardando' LIMIT 1").get()?.id ?? "");
    db.prepare("UPDATE agendamentos SET status='recebido' WHERE id=?").run(first);
    const counts=["lojas","usuarios","agendas","agendamentos","historico_status","auditoria","avisos"].map(t=>Number(db.prepare("SELECT COUNT(*) AS n FROM "+t).get()?.n ?? 0));
    db.exec(await buildMockSql(password,now,{access:true,v2:true}));
    assert.deepEqual(["lojas","usuarios","agendas","agendamentos","historico_status","auditoria","avisos"].map(t=>Number(db.prepare("SELECT COUNT(*) AS n FROM "+t).get()?.n ?? 0)),counts);
    assert.equal(db.prepare("SELECT nome FROM usuarios WHERE id=?").get(user)?.nome,"Alterado pelo teste");
    assert.equal(db.prepare("SELECT status FROM agendamentos WHERE id=?").get(first)?.status,"recebido");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{db.close()}
});

test("CSV de importação fictício usa amanhã e as três lojas",()=>{
  const csv=mockImportCsv(now);
  assert.match(csv,/Dia: 25\/11\/2026/);
  const result=parseAgendaCsv(csv);
  assert.deepEqual(result.blockingErrors,[]);
  assert.equal(result.totalAppointments,3);
  assert.deepEqual(result.agendas.map(a=>a.storeCode),["F901","F902","F903"]);
});
