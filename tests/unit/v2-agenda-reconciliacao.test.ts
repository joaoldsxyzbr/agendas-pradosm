import assert from "node:assert/strict";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {openLocalDatabase} from "../../scripts/local-sqlite.mjs";
import {listAdminAgendas,listAdminAgendasPage} from "../../worker/repositories/agenda-queries.ts";
import {listDigitacaoProgressByDate} from "../../worker/services/agenda-digitacao.ts";
test("reconciled agenda queries preserve assigned-store scope before paging",async()=>{
  const f=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try {
    f.seed(`INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('l1','F01','Uma','t','t'),('l2','F02','Duas','t','t');
    INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('u','Admin','admin','hash','admin','t','t');
    INSERT INTO agendas(id,loja_id,data_agenda,arquivo_original,criado_por,criado_em,atualizado_em) VALUES('g1','l1','2026-11-27','a.csv','u','t','t'),('g2','l2','2026-11-27','b.csv','u','t','t');
    INSERT INTO agendamentos(id,agenda_id,protocolo,horario_inicio,horario_fim,fornecedor,criado_em,atualizado_em) VALUES('p1','g1','123456','08:00','09:00','Fictício','t','t'),('p2','g2','123457','08:00','09:00','Fictício','t','t');`);
    assert.deepEqual((await listAdminAgendas(f.DB,{storeIds:["l2"]})).map(r=>r.id),["g2"]);
    assert.deepEqual(await listAdminAgendas(f.DB,{storeIds:[]}),[]);
    assert.deepEqual(await listAdminAgendas(f.DB,{storeIds:["l2"],storeCode:"F01"}),[]);
    const page=await listAdminAgendasPage(f.DB,{storeIds:["l2"]},1,0);
    assert.deepEqual(page.items.map(r=>r.id),["g2"]);assert.equal(page.hasMore,false);
    assert.deepEqual((await listAdminAgendasPage(f.DB,{storeIds:[]},1,0)).items,[]);
    const progress=await listDigitacaoProgressByDate(f.DB,"2026-11-27",["l2"]);
    assert.deepEqual([...progress.keys()],["g2"]);
    assert.equal((await listDigitacaoProgressByDate(f.DB,"2026-11-27",[])).size,0);
  }finally{f.close();}
});
