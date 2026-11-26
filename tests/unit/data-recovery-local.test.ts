import { it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteD1, testEnv } from "../helpers/sqlite-d1.ts";
import { app } from "../../worker/app.ts";
import { importAgendaBatchAtomic, findAppointmentById, changeAppointmentStatus } from "../../worker/repositories/agendas.ts";
import { listAvisos } from "../../worker/repositories/avisos.ts";

// Exercício de snapshot e recuperação somente no SQLite temporário. Não
// representa execução do Time Travel remoto nem usa credenciais reais.
it("recupera snapshot sintético com schema, auditoria, histórico e isolamento íntegros", async () => {
  const dir=mkdtempSync(join(tmpdir(),"agendas-recuperacao-"));
  const source=new DatabaseSync(join(dir,"original.sqlite"));
  let restored: DatabaseSync | undefined;
  try {
    source.exec("PRAGMA foreign_keys=ON");
    for(const name of readdirSync("migrations").filter(n=>/^\d{4}_.*\.sql$/.test(n)).sort())
      source.exec(readFileSync(join("migrations",name),"utf8"));
    const now="2026-11-26T12:00:00.000Z";
    for(const [id,code] of [["l1","01"],["l2","02"]]) source.prepare("INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES (?,?,?,?,?)").run(id,code,"Loja "+code,now,now);
    for(const [id,loja,papel] of [["adm",null,"admin"],["c1","l1","conferente"],["c2","l2","conferente"]] as const)
      source.prepare("INSERT INTO usuarios(id,loja_id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?)").run(id,loja,id,id,"hash-ficticio",papel,now,now);
    const db=sqliteD1(source);
    const [created]=await importAgendaBatchAtomic(db,"adm",[{storeId:"l1",existing:null,input:{
      storeCode:"01",date:"2026-11-26",originalFileName:"fixture.csv",replace:false,appointments:[{protocol:"123456",startTime:"08:00",endTime:"09:00",supplier:"Fornecedor sintético",items:1,volumes:2,pallets:null,cargaBatida:null,type:"Nota fiscal",nfe:[],orders:[]}]
    }}]);
    const row=source.prepare("SELECT id FROM agendamentos WHERE agenda_id=?").get(created.agendaId);
    assert.ok(row && typeof row.id==="string");
    const appointment=await findAppointmentById(db,row.id);
    assert.ok(appointment);
    await changeAppointmentStatus(db,appointment,"c1","recebido");
    source.prepare("INSERT INTO avisos(id,tipo,titulo,mensagem,criado_por,criado_em) VALUES ('av','aviso','Sintético','Preservar','adm',?)").run(now);
    source.prepare("INSERT INTO avisos_lojas(aviso_id,loja,loja_id) VALUES ('av','01','l1')").run();
    const tables=["agendas","agendamentos","historico_status","historico_agenda","auditoria","avisos","avisos_lojas","usuarios","lojas"];
    const snapshotRows=(db:DatabaseSync)=>tables.map(table=>({table,rows:db.prepare("SELECT * FROM "+table+" ORDER BY rowid").all()}));
    const before=snapshotRows(source);
    const file=join(dir,"snapshot.sqlite");
    source.prepare("VACUUM INTO ?").run(file);
    // Simula uma alteração posterior legítima, sem apagar o original.
    source.prepare("UPDATE agendamentos SET fornecedor='Alteração posterior' WHERE id=?").run(row.id);
    assert.notDeepEqual(snapshotRows(source),before);
    restored=new DatabaseSync(file,{readOnly:true});
    assert.deepEqual(snapshotRows(restored),before);
    assert.equal(restored.prepare("PRAGMA integrity_check").get()?.integrity_check,"ok");
    assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(),[]);
    const restoredDb=sqliteD1(restored);
    assert.equal((await findAppointmentById(restoredDb,row.id))?.status,"recebido");
    assert.deepEqual((await listAvisos(restoredDb,"c1","l1",false)).avisos.map(a=>a.id),["av"]);
    assert.deepEqual((await listAvisos(restoredDb,"c2","l2",false)).avisos,[]);
    const response=await app.request("http://localhost/api/health",{},testEnv(restoredDb,"somente-fixture"));
    assert.equal(response.status,200);
  } finally { restored?.close(); source.close(); rmSync(dir,{recursive:true,force:true}); }
});
