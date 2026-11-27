import assert from "node:assert/strict";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {openLocalDatabase} from "../../scripts/local-sqlite.mjs";
import {listNexelloDestinations,linkSameCodeDestination} from "../../worker/repositories/nexello-destinations.ts";
test("only integral administrator can explicitly link active F-code destinations",async()=>{
  const local=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try{
    local.seed(`INSERT INTO lojas(id,codigo,nome,ativo,criado_em,atualizado_em) VALUES('f','F01','Fictícia',1,'t','t'),('cd','CD DOCA 01','CD',1,'t','t'),('off','F02','Inativa',0,'t','t');
      INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('a','Admin','admin','hash','admin','t','t'),('d','Digitador','dig','hash','visualizador','t','t');
      INSERT INTO usuario_acesso(usuario_id,perfil,escopo) VALUES('d','digitador','todas');`);
    const actor={id:"a",sessionVersion:1};
    await assert.rejects(linkSameCodeDestination(local.DB,{id:"d",sessionVersion:2},"f"));
    await assert.rejects(listNexelloDestinations(local.DB,{id:"d",sessionVersion:2}));
    await assert.rejects(linkSameCodeDestination(local.DB,actor,"cd"),/NEXELLO_DESTINO_INVALIDO/);
    await assert.rejects(linkSameCodeDestination(local.DB,actor,"off"),/NEXELLO_DESTINO_INVALIDO/);
    assert.deepEqual(await linkSameCodeDestination(local.DB,actor,"f"),{created:true});
    assert.deepEqual(await linkSameCodeDestination(local.DB,actor,"f"),{created:false});
    const rows=await listNexelloDestinations(local.DB,actor);
    assert.equal(rows.length,1);assert.equal(rows[0]?.externalCode,"F01");
    assert.equal((await local.DB.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao='nexello_destino_vinculado'").first()).n,1);
  }finally{local.close();}
});
