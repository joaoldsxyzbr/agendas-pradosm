import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openLocalDatabase } from "../../scripts/local-sqlite.mjs";
import { compareNexelloPage } from "../../worker/services/nexello-comparison.ts";
import type { NexelloPreviewPage, NexelloPreviewRow } from "../../shared/nexello-preview.ts";

const observation: NexelloPreviewRow = {
  index: 1, kind: "observed", protocol: "123456", date: "2026-11-27", storeCode: "F01",
  startTime: "08:00", endTime: "09:00", supplier: "Fictício", type: "Pedido",
  nfe: [], orders: ["001"], externalState: "unknown",
};
const page: NexelloPreviewPage = {page:1,lastPage:1,total:1,rows:[observation],readOnly:true};

test("SQLite V2: comparison protects digitized agendas without mutating local data",async()=>{
  const local=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try {
    local.seed(`
      INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('l','F01','Loja','t','t');
      INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('u','Admin','admin','hash','admin','t','t');
      INSERT INTO nexello_destinos(filial_externa,loja_id,criado_por,criado_em) VALUES('F01','l','u','t');
      INSERT INTO agendas(id,loja_id,data_agenda,arquivo_original,criado_por,criado_em,atualizado_em) VALUES('g','l','2026-11-27','ficticio.csv','u','t','t');
      INSERT INTO agendamentos(id,agenda_id,protocolo,horario_inicio,horario_fim,fornecedor,tipo,nfe,pedidos,criado_em,atualizado_em)
        VALUES('p','g','123456','08:00','09:00','Fictício','Pedido','[]','["001"]','t','t');
    `);
    async function check(expected:string){
      const row=(await compareNexelloPage(local.DB,page)).rows[0];
      assert.equal(row?.kind,"observed");
      if(row?.kind!=="observed")throw Error("Observação ausente");
      assert.equal(row.comparison,expected);
      assert.equal(row.destination,"linked");
      assert.equal(row.externalState,"unknown");
    }
    await check("same_fields");
    await local.DB.prepare("UPDATE agendas SET digitado_em='t',digitado_por='u' WHERE id='g'").run();
    await check("protected_local");
    await local.DB.prepare("UPDATE agendas SET digitado_em=NULL,digitado_por=NULL WHERE id='g'").run();
    await local.DB.prepare("INSERT INTO agenda_digitacao_fornecedor(agenda_id,fornecedor_chave,fornecedor_nome,dados_hash,digitado_em,digitado_por) VALUES('g','outro','Outro','hash','t','u')").run();
    await check("protected_local");
    await local.DB.prepare("UPDATE agenda_digitacao_fornecedor SET digitado_em=NULL,digitado_por=NULL WHERE agenda_id='g'").run();
    await check("same_fields");
    assert.deepEqual({...await local.DB.prepare("SELECT status,ativo,atualizado_em FROM agendamentos WHERE id='p'").first()},{status:"aguardando",ativo:1,atualizado_em:"t"});
    assert.equal((await local.DB.prepare("SELECT COUNT(*) AS n FROM auditoria").first())?.n,0);
    assert.deepEqual((await local.DB.prepare("PRAGMA foreign_key_check").all()).results,[]);
  } finally {local.close();}
});
