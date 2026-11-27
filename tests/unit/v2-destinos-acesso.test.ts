import assert from "node:assert/strict";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {openLocalDatabase} from "../../scripts/local-sqlite.mjs";
import {listActiveConferentePresence,touchConferentePresence} from "../../worker/repositories/presence.ts";
test("database protects destination identity and Digitador restrictions",async()=>{
  const f=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try{
    f.seed(`INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('f','F01','Loja','t','t'),('g','F02','Outra','t','t');
    INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('a','Admin','admin','hash','admin','t','t'),('d','Digitador','dig','hash','visualizador','t','t');
    INSERT INTO usuario_acesso(usuario_id,perfil,escopo) VALUES('d','digitador','todas');`);
    await assert.rejects(f.DB.prepare("INSERT INTO nexello_destinos(filial_externa,loja_id,criado_por,criado_em) VALUES('F01','g','a','t')").run(),/NEXELLO_DESTINO_INVALIDO/);
    await f.DB.prepare("INSERT INTO nexello_destinos(filial_externa,loja_id,criado_por,criado_em) VALUES('F01','f','a','t')").run();
    await assert.rejects(f.DB.prepare("UPDATE lojas SET codigo='F03' WHERE id='f'").run(),/NEXELLO_LOJA_CODIGO_PROTEGIDO/);
    await f.DB.prepare("UPDATE lojas SET ativo=0 WHERE id='f'").run();
    for(const permission of ["lojas.editar","usuarios.ver","auditoria.ver","diagnosticos.ver","retencao.executar"])
      await assert.rejects(f.DB.prepare("INSERT INTO usuario_acesso_excecoes(usuario_id,permissao,efeito) VALUES('d',?,'allow')").bind(permission).run(),/DIGITADOR_PERMISSAO_RESTRITA/);
    await f.DB.prepare("INSERT INTO usuario_acesso_excecoes(usuario_id,permissao,efeito) VALUES('d','usuarios.ver','deny')").run();
    await assert.rejects(f.DB.prepare("UPDATE usuario_acesso_excecoes SET efeito='allow' WHERE usuario_id='d'").run(),/DIGITADOR_PERMISSAO_RESTRITA/);
    await touchConferentePresence(f.DB,{userId:"d",storeId:"g",interacted:true,now:"2026-11-27T15:00:00Z"});
    assert.equal((await listActiveConferentePresence(f.DB,true)).length,1);
    assert.equal((await listActiveConferentePresence(f.DB,false)).length,0);
    await f.DB.prepare("UPDATE usuario_acesso SET ativo=0 WHERE usuario_id='d'").run();
    assert.equal((await listActiveConferentePresence(f.DB,true)).length,0);
  }finally{f.close();}
});
