// Medição exclusivamente sintética. SQLite local; não representa latência ou CPU D1.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { ImportAgendaBatchInput } from "../shared/agenda.ts";
import { importAgendaBatchAtomic, AgendaBatchQueryBudgetError, findAgendaById, type ImportEntry } from "../worker/repositories/agendas.ts";
import { sqliteD1 } from "../tests/helpers/sqlite-d1.ts";

const migrations = readdirSync("migrations").filter(n=>/^\d{4}_.*\.sql$/.test(n)).sort();
const now="2026-11-26T12:00:00.000Z";
const stores=10;
const repetitions=5;
const results=[];
for (const size of [121,350,700]) {
  const timings: {create:number;replace:number}[]=[];
  let createWrites=0, replaceWrites=0;
  let queryPlans: string[][]=[];
  for (let repeat=0;repeat<=repetitions;repeat++) {
    const db=new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      for(const file of migrations) db.exec(readFileSync(join("migrations",file),"utf8"));
      db.prepare("INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?)").run("admin","Admin sintético","sintetico","hash","admin",now,now);
      for(let i=0;i<stores;i++) db.prepare("INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES (?,?,?,?,?)").run("l"+i,String(i+1).padStart(2,"0"),"Loja "+i,now,now);
      const fixture=ImportAgendaBatchInput.parse({agendas:Array.from({length:stores},(_,i)=>({
        storeCode:String(i+1).padStart(2,"0"),date:"2026-11-26",originalFileName:"sintetico.csv",replace:false,
        appointments:Array.from({length:Math.floor(size/stores)+(i<size%stores?1:0)},(_,j)=>({
          protocol:String(100000+i*1000+j),startTime:"08:00",endTime:"09:00",supplier:"Fornecedor sintético "+j,
          items:1,volumes:1,pallets:null,cargaBatida:null,type:"Nota fiscal",nfe:[],orders:[]
        }))
      }))});
      let writes=0;
      const adapter=sqliteD1(db,{beforeRun:()=>{writes++;}});
      const entries: ImportEntry[]=fixture.agendas.map((input,i)=>({storeId:"l"+i,existing:null,input}));
      const count=(table:"agendas"|"agendamentos"|"auditoria")=>Number(db.prepare("SELECT COUNT(*) AS n FROM "+table).get()?.n);
      const start=performance.now();
      const created=await importAgendaBatchAtomic(adapter,"admin",entries);
      const create=performance.now()-start;
      createWrites=writes;
      assert.equal(created.length,stores);
      assert.equal(count("agendamentos"),size);
      assert.equal(count("auditoria"),stores);
      assert.equal(createWrites,size+2*stores);
      const ids=db.prepare("SELECT id FROM agendamentos ORDER BY id").all().map(x=>x.id);
      db.prepare("UPDATE agendamentos SET status='recebido' WHERE id=?").run(String(ids[0]));
      const replace: ImportEntry[]=[];
      for(let i=0;i<created.length;i++){
        const existing=await findAgendaById(adapter,created[i].agendaId);
        assert.ok(existing);
        replace.push({storeId:"l"+i,existing,input:{...entries[i].input,replace:true}});
      }
      writes=0;
      const startReplace=performance.now();
      await importAgendaBatchAtomic(adapter,"admin",replace);
      const replaceMs=performance.now()-startReplace;
      replaceWrites=writes;
      assert.equal(replaceWrites,size+2*stores);
      assert.deepEqual(db.prepare("SELECT id FROM agendamentos ORDER BY id").all().map(x=>x.id),ids);
      assert.equal(db.prepare("SELECT status FROM agendamentos WHERE id=?").get(String(ids[0]))?.status,"recebido");
      assert.equal(count("auditoria"),2*stores);
      assert.equal(count("agendas"),stores);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
      // Substituição disjunta exige inserir novos + inativar anteriores; acima do orçamento deve rejeitar antes de gravar.
      if(size===700) {
        const disjoint=replace.map(e=>({...e,input:{...e.input,appointments:e.input.appointments.map(x=>({...x,protocol:String(Number(x.protocol)+900000)}))}}));
        writes=0;
        await assert.rejects(importAgendaBatchAtomic(adapter,"admin",disjoint),AgendaBatchQueryBudgetError);
        assert.equal(writes,0);
        assert.equal(count("agendamentos"),size);
        assert.equal(count("auditoria"),2*stores);
      }
      queryPlans=[
        db.prepare("EXPLAIN QUERY PLAN SELECT versao_importacao FROM agendas WHERE id=?").all(created[0].agendaId).map(x=>String(x.detail)),
        db.prepare("EXPLAIN QUERY PLAN SELECT * FROM agendamentos WHERE agenda_id=?").all(created[0].agendaId).map(x=>String(x.detail))
      ];
      if(repeat>0)timings.push({create,replace:replaceMs});
    } finally {db.close();}
  }
  const stats=(values:number[])=>({median_ms:Number([...values].sort((a,b)=>a-b)[Math.floor(values.length/2)].toFixed(2)),max_ms:Number(Math.max(...values).toFixed(2))});
  results.push({appointments:size,stores,repetitions,create:{...stats(timings.map(x=>x.create)),statements:createWrites},replace:{...stats(timings.map(x=>x.replace)),statements:replaceWrites},read_plans:queryPlans});
}
console.log(JSON.stringify({engine:"SQLite local sintético; NÃO D1 remoto",results},null,2));
