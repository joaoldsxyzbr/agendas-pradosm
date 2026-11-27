import assert from "node:assert/strict";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {openLocalDatabase} from "../../scripts/local-sqlite.mjs";
import {findStoreById,updateStore,softDeleteStore} from "../../worker/repositories/stores.ts";
import {listAudit} from "../../worker/repositories/audit.ts";

test("concurrent store editing, deletion and audit remain consistent",async()=>{
  const f=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  const id="10000000-0000-4000-8000-000000000001";
  try{
    f.seed(`INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('${id}','F01','Inicial','t','t');
      INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('a','Admin','admin','hash','admin','t','t'),('d','Digitador','dig','hash','visualizador','t','t');
      INSERT INTO usuario_acesso(usuario_id,perfil,escopo) VALUES('d','digitador','vinculadas');`);
    const before=await findStoreById(f.DB,id);assert.ok(before);
    const changed=await updateStore(f.DB,before,{id,nome:"Alterada"},"a");
    await assert.rejects(updateStore(f.DB,before,{id,ativo:false},"a"),/LOJA_CONFLITO_ESTADO/);
    await assert.rejects(softDeleteStore(f.DB,before,"a"),/LOJA_CONFLITO_ESTADO/);
    assert.equal((await findStoreById(f.DB,id))?.nome,"Alterada");
    assert.equal((await listAudit(f.DB,{entityId:id})).length,1);
    await f.DB.prepare("INSERT INTO usuario_acesso_lojas(usuario_id,loja_id) VALUES('d',?)").bind(id).run();
    await assert.rejects(softDeleteStore(f.DB,changed,"a"),/LOJA_POSSUI_USUARIOS/);
    await f.DB.prepare("DELETE FROM usuario_acesso_lojas WHERE usuario_id='d'").run();
    assert.equal(await softDeleteStore(f.DB,changed,"a"),true);
    await assert.rejects(f.DB.prepare("INSERT INTO usuario_acesso_lojas(usuario_id,loja_id) VALUES('d',?)").bind(id).run(),/LOJA_NAO_ENCONTRADA/);
    await assert.rejects(f.DB.prepare("INSERT INTO usuarios(id,loja_id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('c',?,'Conferente','conf','hash','conferente','t','t')").bind(id).run(),/LOJA_NAO_ENCONTRADA/);
    assert.equal((await listAudit(f.DB,{entityId:id})).length,2);
  }finally{f.close();}
});

test("audit includes the final millisecond of a UTC day",async()=>{
  const f=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try{
    f.seed("INSERT INTO auditoria(id,acao,entidade,entidade_id,criado_em) VALUES('a','x','sistema','a','2026-11-27T23:59:59.999Z'),('b','x','sistema','b','2026-11-28T00:00:00.000Z')");
    assert.deepEqual((await listAudit(f.DB,{date:"2026-11-27"})).map(row=>row.id),["a"]);
    await assert.rejects(listAudit(f.DB,{date:"2026-02-30"}),/AUDITORIA_DATA_INVALIDA/);
  }finally{f.close();}
});
