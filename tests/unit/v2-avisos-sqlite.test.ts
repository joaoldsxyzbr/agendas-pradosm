import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openLocalDatabase } from "../../scripts/local-sqlite.mjs";
import { noticeScope, noticeScopeArgs, noticeVisibilitySql, canUseNotice, type NoticeScope } from "../../worker/services/notice-scope.ts";
import type { AuthUser } from "../../shared/auth.ts";

const base:AuthUser={id:"u",nome:"Fictício",papel:"visualizador",lojaId:null,lojaCodigo:null,lojaNome:null};
test("real SQLite notice destinations remain isolated across store renames",async()=>{
  const f=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try {
    f.seed(`INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('l1','F01','Uma','t','t'),('l2','F02','Duas','t','t');
      INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('u','Admin','admin','hash','admin','t','t');
      INSERT INTO avisos(id,tipo,titulo,mensagem,criado_por,criado_em) VALUES('global','aviso','Global','Texto','u','t'),('first','aviso','Primeira','Texto','u','t'),('second','aviso','Segunda','Texto','u','t'),('unresolved','aviso','Legado','Texto','u','t');
      INSERT INTO avisos_lojas(aviso_id,loja) VALUES('first','F01'),('second','F02'),('unresolved','F99');
      INSERT INTO avisos_lidos(aviso_id,usuario_id,lido_em) VALUES('first','u','t');`);
    f.seed(readFileSync(new URL("../../docs/plans/sql/0011_avisos_canal.sql",import.meta.url),"utf8"));
    const visible=async(scope:NoticeScope)=>{
      const filter=noticeVisibilitySql(scope);
      const rows=await f.DB.prepare("SELECT a.id FROM avisos a"+(filter?" WHERE ("+filter+")":"")+" ORDER BY a.id").bind(...noticeScopeArgs(scope)).all();
      return rows.results.map((r:{id:string})=>r.id);
    };
    assert.deepEqual(await visible(null),["first","global","second","unresolved"]);
    assert.deepEqual(await visible([]),["global"]);
    assert.deepEqual(await visible(["l1"]),["first","global"]);
    assert.deepEqual(await visible(["l2"]),["global","second"]);
    assert.deepEqual(await visible(["l1","l2"]),["first","global","second"]);
    f.seed("UPDATE lojas SET codigo='F03' WHERE id='l1'; INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('l3','F01','Nova','t','t');");
    assert.deepEqual(await visible(["l1"]),["first","global"]);
    assert.deepEqual(await visible(["l3"]),["global"]);
    assert.equal(await f.DB.prepare("SELECT COUNT(*) AS total FROM avisos_lidos").first("total"),1);
    assert.deepEqual((await f.DB.prepare("PRAGMA foreign_key_check").all()).results,[]);
  } finally {f.close();}
});
test("notice actions do not inherit physical admin privileges on custom accounts",()=>{
  const user:AuthUser={...base,papel:"admin",perfil:"digitador",permissoes:["avisos.ver","avisos.reagir"],escopo:{mode:"assigned",storeIds:["l1","l2"]},lojasDisponiveis:[{id:"l1",codigo:"F01",nome:"Uma"},{id:"l3",codigo:"F03",nome:"Outra"}]};
  assert.deepEqual(noticeScope(user),["l1"]);
  assert.deepEqual(noticeScope({...user,lojasDisponiveis:[]}),[]);
  assert.equal(canUseNotice(user,"avisos.reagir"),true);
  assert.equal(canUseNotice(user,"avisos.publicar"),false);
  assert.equal(canUseNotice(user,"avisos.leitores"),false);
  assert.equal(canUseNotice({...user,permissoes:["avisos.reagir"]},"avisos.reagir"),false);
  assert.equal(canUseNotice(base,"avisos.ver"),false);
});
