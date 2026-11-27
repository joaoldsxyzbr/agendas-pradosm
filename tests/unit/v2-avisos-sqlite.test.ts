import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openLocalDatabase } from "../../scripts/local-sqlite.mjs";
import { noticeScope, noticeScopeArgs, noticeVisibilitySql, canUseNotice, type NoticeScope } from "../../worker/services/notice-scope.ts";
import type { AuthUser } from "../../shared/auth.ts";

const base:AuthUser={id:"u",nome:"Fictício",papel:"visualizador",lojaId:null,lojaCodigo:null,lojaNome:null};
const avisosMigration=readFileSync(new URL("../../docs/plans/sql/0011_avisos_canal.sql",import.meta.url),"utf8");
test("real SQLite notice destinations remain isolated across store renames",async()=>{
  const f=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try {
    f.seed(`INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('l1','F01','Uma','t','t'),('l2','F02','Duas','t','t');
      INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('u','Admin','admin','hash','admin','t','t'),('u2','Leitor','leitor','hash','visualizador','t','t');
      INSERT INTO avisos(id,tipo,titulo,mensagem,criado_por,criado_em) VALUES('global','aviso','Global','Texto','u','t'),('first','aviso','Primeira','Texto','u','t'),('second','aviso','Segunda','Texto','u','t'),('unresolved','aviso','Legado','Texto','u','t');
      INSERT INTO avisos(id,tipo,titulo,mensagem,criado_por,criado_em,expira_em,inativo_em,urgente,autor) VALUES('event','evento','Importação concluída','Evento legado','u','t','expira','inativo',1,'Sistema');
      INSERT INTO avisos_lojas(aviso_id,loja) VALUES('first','F01'),('second','F02'),('unresolved','F99');
      INSERT INTO avisos_lidos(aviso_id,usuario_id,lido_em) VALUES('first','u','t');`);
    f.seed(avisosMigration);
    const visible=async(scope:NoticeScope)=>{
      const filter=noticeVisibilitySql(scope);
      const rows=await f.DB.prepare("SELECT a.id FROM avisos a"+(filter?" WHERE ("+filter+")":"")+" ORDER BY a.id").bind(...noticeScopeArgs(scope)).all();
      return rows.results.map((r:{id:string})=>r.id);
    };
    assert.deepEqual(await visible(null),["event","first","global","second","unresolved"]);
    assert.deepEqual(await visible([]),["event","global"]);
    assert.deepEqual(await visible(["l1"]),["event","first","global"]);
    assert.deepEqual(await visible(["l2"]),["event","global","second"]);
    assert.deepEqual(await visible(["l1","l2"]),["event","first","global","second"]);
    const legacyEvent=await f.DB.prepare("SELECT tipo,titulo,mensagem,expira_em,inativo_em,urgente,autor FROM avisos WHERE id='event'").first<{tipo:string;titulo:string;mensagem:string;expira_em:string;inativo_em:string;urgente:number;autor:string}>();
    assert.deepEqual({...legacyEvent},{tipo:"evento",titulo:"Importação concluída",mensagem:"Evento legado",expira_em:"expira",inativo_em:"inativo",urgente:1,autor:"Sistema"});
    f.seed("INSERT INTO avisos(id,tipo,titulo,mensagem,criado_por,criado_em) VALUES('chat','chat',NULL,'Mensagem','u','t'); INSERT INTO avisos_reacoes(aviso_id,usuario_id,emoji,atualizado_em) VALUES('chat','u','👍','t'); INSERT INTO avisos_lojas(aviso_id,loja) VALUES('chat','F02');");
    assert.equal((await f.DB.prepare("SELECT tipo FROM avisos WHERE id='chat'").first<{tipo:string}>())?.tipo,"chat");
    assert.throws(()=>f.seed("INSERT INTO avisos(id,tipo,titulo,mensagem,criado_por,criado_em) VALUES('missing-title','aviso',NULL,'Aviso sem título','u','t')"),/CHECK constraint/);
    assert.throws(()=>f.seed("INSERT INTO avisos(id,tipo,titulo,mensagem,criado_por,criado_em) VALUES('missing-event-title','evento',NULL,'Evento sem título','u','t')"),/CHECK constraint/);
    assert.throws(()=>f.seed("INSERT INTO avisos(id,tipo,titulo,mensagem,criado_por,criado_em) VALUES('chat-title','chat','Título','Mensagem','u','t')"),/CHECK constraint/);
    assert.equal((await f.DB.prepare("SELECT loja_id FROM avisos_lojas WHERE aviso_id='chat'").first<{loja_id:string}>())?.loja_id,"l2");
    assert.equal((await f.DB.prepare("SELECT emoji FROM avisos_reacoes WHERE aviso_id='chat'").first<{emoji:string}>())?.emoji,"👍");
    assert.throws(()=>f.seed("INSERT INTO avisos_reacoes(aviso_id,usuario_id,emoji,atualizado_em) VALUES('chat','u2','🤔','t')"),/CHECK constraint/);
    f.seed("UPDATE lojas SET codigo='F03' WHERE id='l1'; INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('l3','F01','Nova','t','t');");
    assert.deepEqual(await visible(["l1"]),["event","first","global"]);
    assert.deepEqual(await visible(["l3"]),["event","global"]);
    const countStatement=f.DB.prepare("SELECT COUNT(*) AS total FROM avisos_lidos");
    assert.equal((await countStatement.first<{total:number}>())?.total,1);
    assert.equal(await countStatement.first<number>("total"),1);
    await assert.rejects(countStatement.first("inexistente"));
    assert.deepEqual((await f.DB.prepare("PRAGMA foreign_key_check").all()).results,[]);
  } finally {f.close();}
});
test("proposed notice migration rolls back its rebuild when a later statement fails",async()=>{
  const f=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try {
    f.seed("INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('u','Admin','admin','hash','admin','t','t'); INSERT INTO avisos(id,tipo,titulo,mensagem,criado_por,criado_em) VALUES('legacy','aviso','Legado','Texto','u','t'); CREATE TABLE migration_blocker(id TEXT); CREATE INDEX idx_avisos_criado_id ON migration_blocker(id);");
    assert.throws(()=>f.seed(avisosMigration),/already exists/);
    assert.equal((await f.DB.prepare("SELECT titulo FROM avisos WHERE id='legacy'").first<{titulo:string}>())?.titulo,"Legado");
    assert.equal((await f.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='avisos_v2_novo'").first()),null);
    assert.equal((await f.DB.prepare("SELECT tbl_name FROM sqlite_master WHERE type='index' AND name='idx_avisos_criado_id'").first<{tbl_name:string}>())?.tbl_name,"migration_blocker");
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
