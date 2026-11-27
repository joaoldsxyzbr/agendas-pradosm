import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openLocalDatabase } from "../../scripts/local-sqlite.mjs";
import { prepareVerifiedReview,confirmPreparedReview,cancelPreparedReview,pruneExpiredNexelloReviews,type VerifiedNewBatch } from "../../worker/repositories/nexello-persistence.ts";
const now=new Date("2026-11-27T15:00:00Z");
const actor={id:"u",sessionVersion:1,sessionKey:"sid:10000000-0000-4000-8000-000000000001"};
const otherSession={...actor,sessionKey:"sid:10000000-0000-4000-8000-000000000002"};
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
    assert.deepEqual({...row},{status:"aguardando",itens:null,volumes:null,paletes:null,carga_batida:null});
    const evidence=await f.DB.prepare("SELECT fonte,hash_evidencia,hash_registro FROM nexello_evidencias").first<{fonte:string;hash_evidencia:string;hash_registro:string}>();
    assert.ok(evidence);
    assert.equal(evidence.fonte,"revisao_admin");assert.equal(evidence.hash_evidencia,"a".repeat(64));
    assert.match(evidence.hash_registro,/^[0-9a-f]{64}$/);
    await assert.rejects(f.DB.prepare("UPDATE nexello_evidencias SET hash_evidencia=?").bind("b".repeat(64)).run(),/NEXELLO_EVIDENCIA_IMUTAVEL/);
    await assert.rejects(f.DB.prepare("DELETE FROM nexello_evidencias").run(),/NEXELLO_EVIDENCIA_IMUTAVEL/);
    await f.DB.prepare("UPDATE agendamentos SET status='recebido',observacao='preservar',itens=9").run();
    const next=await prepareVerifiedReview(f.DB,actor,{...base,entries:base.entries.map(r=>({...r,protocol:"123457"}))},now);
    await confirmPreparedReview(f.DB,actor,next.reviewId,next.hash,now);
    assert.equal((await f.DB.prepare("SELECT itens FROM agendamentos WHERE protocolo='123456'").first<{itens:number|null}>())?.itens,9);
    assert.equal((await f.DB.prepare("SELECT status FROM agendamentos WHERE protocolo='123456'").first<{status:string}>())?.status,"recebido");
    assert.equal(await total(f.DB,"nexello_evidencias"),2);
  }finally{f.close();}
});
test("draft is bound to author, session, hash, expiry and cancellation",async()=>{
  const f=fixture();
  try{
    const d=await prepareVerifiedReview(f.DB,actor,base,now);
    await assert.rejects(confirmPreparedReview(f.DB,{...otherSession,id:"v"},d.reviewId,d.hash,now));
    await assert.rejects(confirmPreparedReview(f.DB,actor,d.reviewId,"b".repeat(64),now));
    await assert.rejects(confirmPreparedReview(f.DB,otherSession,d.reviewId,d.hash,now));
    assert.equal(await cancelPreparedReview(f.DB,otherSession,d.reviewId),false);
    await assert.rejects(confirmPreparedReview(f.DB,actor,d.reviewId,d.hash,new Date(now.getTime()+600000)));
    await assert.rejects(f.DB.prepare("UPDATE nexello_revisoes_pendentes SET conteudo='{}'").run(),/NEXELLO_REVISAO_IMUTAVEL/);
    assert.equal(await cancelPreparedReview(f.DB,{...otherSession,id:"v"},d.reviewId),false);
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
    await assert.rejects(prepareVerifiedReview(f.DB,actor,{...base,entries:[{...entry,protocol:"999999"},entry]},now),/NEXELLO_PROTOCOLO_EXISTENTE/);
    const conflict=await prepareVerifiedReview(f.DB,actor,{...base,entries:[{...entry,protocol:"999998"},{...entry,protocol:"999999"}]},now);
    await f.DB.prepare("INSERT INTO agendamentos(id,agenda_id,protocolo,horario_inicio,horario_fim,fornecedor,criado_em,atualizado_em) SELECT 'manual-race',id,'999999','08:00','09:00','Fictício','t','t' FROM agendas LIMIT 1").run();
    await assert.rejects(confirmPreparedReview(f.DB,actor,conflict.reviewId,conflict.hash,now));
    assert.equal(await total(f.DB,"agendamentos"),2);
    assert.equal(await total(f.DB,"sincronizacoes_nexello"),1);
    assert.equal(await total(f.DB,"auditoria"),1);
    assert.equal(await total(f.DB,"nexello_evidencias"),1);
  }finally{f.close();}
});

test("bounded drafts, expiration and session revocation",async()=>{
  const f=fixture();
  try{
    for(let i=0;i<10;i++)await prepareVerifiedReview(f.DB,actor,base,now);
    await assert.rejects(prepareVerifiedReview(f.DB,actor,base,now),/NEXELLO_REVISAO_LIMITE/);
    const later=new Date(now.getTime()+600001);
    const draft=await prepareVerifiedReview(f.DB,actor,base,later);
    assert.equal(await total(f.DB,"nexello_revisoes_pendentes"),1);
    await f.DB.prepare("UPDATE usuarios SET session_version=2 WHERE id='u'").run();
    await assert.rejects(confirmPreparedReview(f.DB,actor,draft.reviewId,draft.hash,later));
    await assert.rejects(confirmPreparedReview(f.DB,{...actor,sessionVersion:2},draft.reviewId,draft.hash,later));
    assert.equal(await total(f.DB,"agendamentos"),0);
  }finally{f.close();}
});

test("individual logout blocks confirmation even between validation and atomic batch",async()=>{
  const f=fixture();
  try{
    const d=await prepareVerifiedReview(f.DB,actor,base,now);
    const db={...f.DB,async batch(statements:D1PreparedStatement[]){
      await f.DB.prepare("INSERT INTO sessoes_revogadas(session_key,expira_em) VALUES(?,?)")
        .bind(actor.sessionKey,Math.floor(now.getTime()/1000)+3600).run();
      return f.DB.batch(statements);
    }};
    await assert.rejects(confirmPreparedReview(db,actor,d.reviewId,d.hash,now));
    assert.equal(await total(f.DB,"agendamentos"),0);
    assert.equal(await total(f.DB,"sincronizacoes_nexello"),0);
    assert.equal(await total(f.DB,"nexello_revisoes_pendentes"),1);
    await assert.rejects(prepareVerifiedReview(f.DB,actor,base,now));
    await assert.rejects(confirmPreparedReview(f.DB,otherSession,d.reviewId,d.hash,now));
    const replacement=await prepareVerifiedReview(f.DB,otherSession,base,now);
    await confirmPreparedReview(f.DB,otherSession,replacement.reviewId,replacement.hash,now);
    assert.equal(await total(f.DB,"agendamentos"),1);
  }finally{f.close();}
});

test("digitization at agenda or supplier level blocks preparation and concurrent confirmation",async()=>{
  for(const kind of ["agenda","supplier"] as const){
    const f=fixture();
    try{
      const initial=await prepareVerifiedReview(f.DB,actor,base,now);
      await confirmPreparedReview(f.DB,actor,initial.reviewId,initial.hash,now);
      const next={...base,entries:base.entries.map(r=>({...r,protocol:"123457"}))};
      const draft=await prepareVerifiedReview(f.DB,actor,next,now);
      if(kind==="agenda")await f.DB.prepare("UPDATE agendas SET digitado_em=?,digitado_por='u'").bind(now.toISOString()).run();
      else await f.DB.prepare("INSERT INTO agenda_digitacao_fornecedor(agenda_id,fornecedor_chave,fornecedor_nome,dados_hash,digitado_em,digitado_por) SELECT id,'fornecedor','Fictício','hash',?,'u' FROM agendas").bind(now.toISOString()).run();
      await assert.rejects(prepareVerifiedReview(f.DB,actor,next,now),/NEXELLO_DIGITACAO_PROTEGIDA/);
      await assert.rejects(confirmPreparedReview(f.DB,actor,draft.reviewId,draft.hash,now));
      assert.equal(await total(f.DB,"agendamentos"),1);
      assert.equal(await total(f.DB,"sincronizacoes_nexello"),1);
      assert.equal(await total(f.DB,"nexello_evidencias"),1);
      assert.equal(await total(f.DB,"auditoria"),1);
      assert.equal(await total(f.DB,"nexello_revisoes_pendentes"),1);
      const agenda=await f.DB.prepare("SELECT versao_importacao,digitado_em,digitado_por FROM agendas").first<{versao_importacao:number;digitado_em:string|null;digitado_por:string|null}>();
      assert.equal(agenda?.versao_importacao,1);
      if(kind==="agenda"){
        assert.equal(agenda?.digitado_em,now.toISOString());assert.equal(agenda?.digitado_por,"u");
      }else{
        const check=await f.DB.prepare("SELECT digitado_em,digitado_por FROM agenda_digitacao_fornecedor").first<{digitado_em:string;digitado_por:string}>();
        assert.equal(check?.digitado_em,now.toISOString());assert.equal(check?.digitado_por,"u");
      }
    }finally{f.close();}
  }
});
