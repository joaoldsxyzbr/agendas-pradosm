import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openLocalDatabase } from "../../scripts/local-sqlite.mjs";
import { persistVerifiedNewAppointments, type VerifiedNewBatch } from "../../worker/repositories/nexello-persistence.ts";
const now=new Date("2026-11-27T15:00:00Z");
const actor={id:"u",sessionVersion:1};
const base:VerifiedNewBatch={reviewId:"r1",storeId:"l",externalCode:"F01",date:"2026-11-27",expectedAgenda:null,
  entries:[{protocol:"123456",startTime:"08:00",endTime:"09:00",supplier:"Fictício",type:"Pedido",nfe:[],orders:["001"],externalState:"confirmed",evidence:"revisao_admin",evidenceHash:"a".repeat(64)}]};
function fixture(){
  const local=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  local.seed(`
    INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('l','F01','Loja fictícia','t','t');
    INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('u','Admin','admin','hash','admin','t','t');
    INSERT INTO nexello_destinos(filial_externa,loja_id,criado_por,criado_em) VALUES('F01','l','u','t');
  `);
  return local;
}
async function total(db:D1Database,table:"agendamentos"|"sincronizacoes_nexello"|"auditoria"){
  return (await db.prepare("SELECT COUNT(*) AS n FROM "+table).first<{n:number}>())?.n;
}
test("new confirmed records, audit and evidence commit together; replay is harmless",async()=>{
  const f=fixture();
  try{
    assert.deepEqual(await persistVerifiedNewAppointments(f.DB,actor,base,now),{reviewId:"r1",replayed:false});
    assert.deepEqual(await persistVerifiedNewAppointments(f.DB,actor,base,now),{reviewId:"r1",replayed:true});
    assert.equal(await total(f.DB,"agendamentos"),1);assert.equal(await total(f.DB,"auditoria"),1);
    const row=await f.DB.prepare("SELECT status,itens,volumes,paletes,carga_batida FROM agendamentos").first();
    assert.deepEqual(row,{status:"aguardando",itens:null,volumes:null,paletes:null,carga_batida:null});
    assert.equal((await f.DB.prepare("SELECT estado_externo FROM agendamento_nexello").first()).estado_externo,"confirmado");
    const agenda=await f.DB.prepare("SELECT id,versao_importacao FROM agendas").first();
    await f.DB.prepare("UPDATE agendamentos SET status='recebido',observacao='preservar',itens=9").run();
    const next={...base,reviewId:"r2",expectedAgenda:{id:agenda.id,version:agenda.versao_importacao},entries:base.entries.map(r=>({...r,protocol:"123457"}))};
    await persistVerifiedNewAppointments(f.DB,actor,next,now);
    assert.equal((await f.DB.prepare("SELECT itens FROM agendamentos WHERE protocolo='123456'").first()).itens,9);
    assert.equal((await f.DB.prepare("SELECT status FROM agendamentos WHERE protocolo='123456'").first()).status,"recebido");
    assert.equal(await total(f.DB,"agendamentos"),2);
    await assert.rejects(persistVerifiedNewAppointments(f.DB,actor,{...next,reviewId:"r3"},now));
    assert.equal(await total(f.DB,"sincronizacoes_nexello"),2);
  }finally{f.close();}
});
test("unknown states, missing mapping, stale versions and duplicate protocols do not write",async()=>{
  const f=fixture();
  try{
    const entry=base.entries[0]!;
    await assert.rejects(persistVerifiedNewAppointments(f.DB,actor,{...base,entries:[{...entry,externalState:"unknown"}]} as unknown as VerifiedNewBatch,now));
    await assert.rejects(persistVerifiedNewAppointments(f.DB,actor,{...base,externalCode:"F02"},now));
    await assert.rejects(persistVerifiedNewAppointments(f.DB,{...actor,sessionVersion:2},base,now));
    await assert.rejects(persistVerifiedNewAppointments(f.DB,actor,{...base,entries:[entry,entry]},now));
    assert.equal(await total(f.DB,"agendamentos"),0);
    assert.equal(await total(f.DB,"sincronizacoes_nexello"),0);
    await persistVerifiedNewAppointments(f.DB,actor,base,now);
    const agenda=await f.DB.prepare("SELECT id,versao_importacao FROM agendas").first();
    await assert.rejects(persistVerifiedNewAppointments(f.DB,actor,{...base,reviewId:"r2",expectedAgenda:{id:agenda.id,version:agenda.versao_importacao},entries:[{...entry,protocol:"999999"},entry]},now));
    assert.equal(await total(f.DB,"agendamentos"),1);assert.equal(await total(f.DB,"sincronizacoes_nexello"),1);
    assert.equal(await total(f.DB,"auditoria"),1);
  }finally{f.close();}
});
