import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openLocalDatabase } from "../../scripts/local-sqlite.mjs";
import { prepareVerifiedReview,confirmPreparedReview,cancelPreparedReview,pruneExpiredNexelloReviews,type VerifiedNewBatch } from "../../worker/repositories/nexello-persistence.ts";
const now=new Date("2026-11-27T15:00:00Z");
const actor={id:"u",sessionVersion:1};
const base:Omit<VerifiedNewBatch,"reviewId"|"expectedAgenda">={storeId:"l",externalCode:"F01",date:"2026-11-27",
  entries:[{protocol:"123456",startTime:"08:00",endTime:"09:00",supplier:"Fictício",type:"Pedido",nfe:[],orders:["001"],externalState:"confirmed",evidence:"revisao_admin",evidenceHash:"a".repeat(64)}]};
function fixture(){
  const local=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  local.seed(`
    INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('l','F01','Loja fictícia','t','t');
    INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('u','Admin','admin','hash','admin','t','t'),('v','Outro','outro','hash','admin','t','t');
    INSERT INTO nexello_destinos(filial_externa,loja_id,criado_por,criado_em) VALUES('F01','l','u','t');
  `);
  return local;
}
async function total(db:D1Database,table:"agendamentos"|"sincronizacoes_nexello"|"auditoria"|"nexello_revisoes_pendentes"|"nexello_evidencias"){
  return (await db.prepare("SELECT COUNT(*) AS n FROM "+table).first<{n:number}>())?.n;
}
test("prepared confirmation commits exactly once and preserves existing local fields",async()=>{
  const f=fixture();
  try{
    const draft=await prepareVerifiedReview(f.DB,actor,base,now);
    assert.equal(await total(f.DB,"agendamentos"),0);
    assert.equal(await total(f.DB,"nexello_revisoes_pendentes"),1);
    assert.deepEqual(await confirmPreparedReview(f.DB,actor,draft.reviewId,draft.hash,now),{reviewId:draft.reviewId,replayed:false});
    assert.deepEqual(await confirmPreparedReview(f.DB,actor,draft.reviewId,draft.hash,now),{reviewId:draft.reviewId,replayed:true});
    assert.equal(await total(f.DB,"nexello_revisoes_pendentes"),0);
    assert.equal(await total(f.DB,"agendamentos"),1);assert.equal(await total(f.DB,"auditoria"),1);
    const row=await f.DB.prepare("SELECT status,itens,volumes,paletes,carga_batida FROM agendamentos").first();
    assert.deepEqual(row,{status:"aguardando",itens:null,volumes:null,paletes:null,carga_batida:null});
    const evidence=await f.DB.prepare("SELECT fonte,hash_evidencia,hash_registro FROM nexello_evidencias").first();
    assert.equal(evidence.fonte,"revisao_admin");assert.equal(evidence.hash_evidencia,"a".repeat(64));
    assert.match(evidence.hash_registro,/^[0-9a-f]{64}$/);
    await assert.rejects(f.DB.prepare("UPDATE nexello_evidencias SET hash_evidencia=?").bind("b".repeat(64)).run(),/NEXELLO_EVIDENCIA_IMUTAVEL/);
    await assert.rejects(f.DB.prepare("DELETE FROM nexello_evidencias").run(),/NEXELLO_EVIDENCIA_IMUTAVEL/);
    await f.DB.prepare("UPDATE agendamentos SET status='recebido',observacao='preservar',itens=9").run();
    const next=await prepareVerifiedReview(f.DB,actor,{...base,entries:base.entries.map(r=>({...r,protocol:"123457"}))},now);
    await confirmPreparedReview(f.DB,actor,next.reviewId,next.hash,now);
    assert.equal((await f.DB.prepare("SELECT itens FROM agendamentos WHERE protocolo='123456'").first()).itens,9);
    assert.equal((await f.DB.prepare("SELECT status FROM agendamentos WHERE protocolo='123456'").first()).status,"recebido");
    assert.equal(await total(f.DB,"nexello_evidencias"),2);
  }finally{f.close();}
});
test("draft is bound to author, session, hash, expiry and cancellation",async()=>{
  const f=fixture();
  try{
    const d=await prepareVerifiedReview(f.DB,actor,base,now);
    await assert.rejects(confirmPreparedReview(f.DB,{id:"v",sessionVersion:1},d.reviewId,d.hash,now));
    await assert.rejects(confirmPreparedReview(f.DB,actor,d.reviewId,"b".repeat(64),now));
    await assert.rejects(confirmPreparedReview(f.DB,actor,d.reviewId,d.hash,new Date(now.getTime()+600000)));
    await assert.rejects(f.DB.prepare("UPDATE nexello_revisoes_pendentes SET conteudo='{}'").run(),/NEXELLO_REVISAO_IMUTAVEL/);
    assert.equal(await cancelPreparedReview(f.DB,{id:"v",sessionVersion:1},d.reviewId),false);
    assert.equal(await cancelPreparedReview(f.DB,actor,d.reviewId),true);
    await assert.rejects(confirmPreparedReview(f.DB,actor,d.reviewId,d.hash,now));
    const expired=await prepareVerifiedReview(f.DB,actor,base,now);
    await pruneExpiredNexelloReviews(f.DB,new Date(now.getTime()+600000));
    await assert.rejects(confirmPreparedReview(f.DB,actor,expired.reviewId,expired.hash,now));
    assert.equal(await total(f.DB,"agendamentos"),0);
  }finally{f.close();}
});
test("stale versions, duplicates and unsupported states cannot partially write",async()=>{
  const f=fixture();
  try{
    const entry=base.entries[0]!;
    await assert.rejects(prepareVerifiedReview(f.DB,actor,{...base,entries:[{...entry,externalState:"unknown"}]} as unknown as typeof base,now));
    await assert.rejects(prepareVerifiedReview(f.DB,actor,{...base,externalCode:"F02"},now));
    await assert.rejects(prepareVerifiedReview(f.DB,actor,{...base,entries:[entry,entry]},now));
    const first=await prepareVerifiedReview(f.DB,actor,base,now);
    const stale=await prepareVerifiedReview(f.DB,actor,{...base,entries:[{...entry,protocol:"123457"}]},now);
    await confirmPreparedReview(f.DB,actor,first.reviewId,first.hash,now);
    await assert.rejects(confirmPreparedReview(f.DB,actor,stale.reviewId,stale.hash,now));
    const conflict=await prepareVerifiedReview(f.DB,actor,{...base,entries:[{...entry,protocol:"999999"},entry]},now);
    await assert.rejects(confirmPreparedReview(f.DB,actor,conflict.reviewId,conflict.hash,now));
    assert.equal(await total(f.DB,"agendamentos"),1);
    assert.equal(await total(f.DB,"sincronizacoes_nexello"),1);
    assert.equal(await total(f.DB,"auditoria"),1);
    assert.equal(await total(f.DB,"nexello_evidencias"),1);
  }finally{f.close();}
});
