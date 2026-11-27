import assert from "node:assert/strict";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {openLocalDatabase} from "../../scripts/local-sqlite.mjs";
import {buildMockSql,mockId} from "../../scripts/mock-data.mjs";
import {app} from "../../worker/app.ts";
import {businessDate} from "../../shared/time.ts";

test("controle de acesso real: criação, escopo, ações, sessão revogada, auditoria",async()=>{
  const local=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try{
    const password="teste-local-integracao-123";
    await local.seed(await buildMockSql(password,new Date(),{access:true,v2:true}));
    const env={DB:local.DB,SESSION_SECRET:"segredo-sintetico-integracao-sem-producao-123456789",REALTIME_MODE:"off",ACCESS_MODE:"on",LOGIN_RATE_LIMITER:{async limit(){return {success:true}}}};
    const origin="http://localhost";
    async function request(path,method="GET",cookie="",body?,storeId?){
      const headers=new Headers({Origin:origin});
      if(cookie)headers.set("Cookie",cookie);
      if(body!==undefined)headers.set("Content-Type","application/json");
      if(storeId)headers.set("X-Agenda-Store",storeId);
      return app.request(origin+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})},env);
    }
    async function login(loginName,senha=password){
      const r=await request("/api/auth/login","POST","",{login:loginName,senha});
      assert.equal(r.status,200,loginName);
      const cookie=r.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      return {cookie,user:await r.json()};
    }
    const admin=await login("admin.mock");
    assert.equal(admin.user.acessoConfiguravel,true);
    const old=await login("digitador.mock");
    assert.equal(old.user.perfil,"digitador");
    assert.equal((await request("/api/admin/users","GET",old.cookie)).status,403);
    const digitadorId=old.user.id;
    const s1=mockId("store:1"),s2=mockId("store:2"),s3=mockId("store:3");
    const g1=mockId("agenda:"+s1+":"+businessDate()),g3=mockId("agenda:"+s3+":"+businessDate());
    const p1=mockId("appointment:"+g1+":2"),p3=mockId("appointment:"+g3+":2");
    const access=await request("/api/admin/users/"+digitadorId+"/access","GET",admin.cookie);
    assert.equal(access.status,200);
    const config=await access.json();
    const edit={profile:"digitador",scope:{mode:"assigned",storeIds:[s1,s2]},overrides:[{permission:"recebimento.editar",effect:"deny"},{permission:"recebimento.concluir",effect:"deny"},{permission:"importacao.substituir",effect:"deny"}]};
    const changed=await request("/api/admin/users/"+digitadorId+"/access","PUT",admin.cookie,{version:config.sessionVersion,access:edit});
    assert.equal(changed.status,200,await changed.clone().text());
    assert.equal((await request("/api/auth/me","GET",old.cookie)).status,401);
    const physical=await local.DB.prepare("SELECT ativo FROM usuarios WHERE id=?").bind(digitadorId).first();
    assert.equal(physical.ativo,0);
    const legacyEnv={...env,ACCESS_MODE:"off"};
    assert.equal((await app.request(origin+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({login:"digitador.mock",senha:password})},legacyEnv)).status,401);
    const current=await login("digitador.mock");
    assert.deepEqual(current.user.escopo.storeIds,[s1,s2].sort());
    assert.equal(current.user.permissoes.includes("recebimento.editar"),false);
    const list=await request("/api/admin/agendas","GET",current.cookie);
    assert.equal(list.status,200);
    const rows=await list.json();
    assert.ok(rows.length>0&&rows.every(row=>[s1,s2].includes(row.storeId)));
    const page=await request("/api/admin/agendas?limit=1&offset=0","GET",current.cookie);
    assert.equal(page.status,200);
    assert.ok((await page.json()).items.every(row=>[s1,s2].includes(row.storeId)));
    assert.equal((await request("/api/admin/agendas/"+g1,"GET",current.cookie)).status,200);
    assert.equal((await request("/api/admin/agendas/"+g3,"GET",current.cookie)).status,403);
    assert.equal((await request("/api/admin/appointments/"+p3,"GET",current.cookie)).status,403);
    assert.equal((await request("/api/admin/appointments/"+p1+"/status","PATCH",current.cookie,{status:"recebido"})).status,403);
    assert.equal((await request("/api/admin/agendas/"+g1+"/status","PATCH",current.cookie,{status:"concluido"})).status,403);
    const day=businessDate();
    const report=await request("/api/admin/reports?start="+day+"&end="+day,"GET",current.cookie);
    assert.equal(report.status,200);
    const reportData=await report.json();
    assert.deepEqual(reportData.rows.map(row=>row.storeCode).sort(),["F901","F902"]);
    assert.equal(reportData.rows.reduce((n,row)=>n+row.semAgenda,0),2);
    assert.equal(reportData.rows.reduce((n,row)=>n+row.semAgendaRecebidos,0),2);
    assert.equal(reportData.manualSupplierCount,1);
    assert.equal(reportData.semAgendaSuppliers[0].recebidos,2);
    assert.ok(reportData.rows.every(row=>row.total===row.recebido+row.naoChegou+row.naoCompareceu+row.aguardando+row.recusado));
    const occurrences=await request("/api/admin/reports/occurrences?start="+day+"&end="+day+"&type=nao_recebido","GET",current.cookie);
    assert.equal(occurrences.status,200);
    const occurrencesData=await occurrences.json();
    assert.equal(occurrencesData.total,4);
    assert.ok(occurrencesData.rows.every(row=>row.occurrenceType==="nao_recebido"&&["F901","F902"].includes(row.storeCode)));
    const forbiddenReport=await request("/api/admin/reports?start="+day+"&end="+day+"&storeCode=F903","GET",current.cookie);
    assert.deepEqual((await forbiddenReport.json()).rows,[]);
    const imported={storeCode:"F903",date:day,originalFileName:"sintetico.csv",appointments:[{protocol:"123456",startTime:"08:00",endTime:"09:00",supplier:"Teste",items:1,volumes:1,pallets:1,cargaBatida:null,type:"Pedido",nfe:[],orders:[]}]};
    assert.equal((await request("/api/admin/agendas/import","POST",current.cookie,imported)).status,403);
    assert.equal((await request("/api/admin/agendas/import/bulk","POST",current.cookie,{agendas:[{...imported,storeCode:"F901"},imported]})).status,403);
    assert.equal((await request("/api/admin/agendas/import","POST",current.cookie,{...imported,storeCode:"F901",replace:true})).status,403);
    const created=await request("/api/admin/users","POST",admin.cookie,{nome:"Conferente múltiplo",login:"multi.mock",senha:password,access:{profile:"conferente",scope:{mode:"assigned",storeIds:[s1,s2]},overrides:[{permission:"conferencia.manual.excluir",effect:"deny"}]}});
    assert.equal(created.status,201,await created.clone().text());
    const multi=await login("multi.mock");
    assert.equal(multi.user.perfil,"conferente");
    for(const id of [s1,s2]){
      const today=await request("/api/store/today","GET",multi.cookie,undefined,id);
      assert.equal(today.status,200,await today.clone().text());
      assert.equal((await today.json()).agenda.storeId,id);
    }
    assert.equal((await request("/api/store/today","GET",multi.cookie,undefined,s3)).status,403);
    assert.equal((await request("/api/store/appointments/"+p3,"GET",multi.cookie,undefined,s1)).status,403);
    const manual=mockId("appointment:"+g1+":5");
    assert.equal((await request("/api/store/appointments/"+manual+"/manual","DELETE",multi.cookie,undefined,s1)).status,403);
    assert.equal((await request("/api/admin/users/"+digitadorId+"/access","PUT",current.cookie,{version:config.sessionVersion+1,access:edit})).status,403);
    assert.equal((await request("/api/admin/users/"+admin.user.id+"/access","PUT",admin.cookie,{version:1,access:edit})).status,409);
    const audit=await local.DB.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao='usuario_acesso_atualizado' AND usuario_id=? AND entidade_id=?").bind(admin.user.id,digitadorId).first();
    assert.equal(audit.n,1);
    const denied=await local.DB.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao='acesso_negado' AND usuario_id=?").bind(digitadorId).first();
    assert.ok(denied.n>0);
    const disabled=await request("/api/admin/users","PATCH",admin.cookie,{id:multi.user.id,ativo:false});
    assert.equal(disabled.status,200,await disabled.clone().text());
    assert.equal((await disabled.json()).ativo,false);
    assert.equal((await request("/api/auth/me","GET",multi.cookie)).status,401);
    const enabled=await request("/api/admin/users","PATCH",admin.cookie,{id:multi.user.id,ativo:true});
    assert.equal(enabled.status,200,await enabled.clone().text());
    assert.equal((await enabled.json()).ativo,true);
    await login("multi.mock");
  }finally{local.close();}
});


test("relatório conta todos os fornecedores sem agenda antes do limite e separa os três tipos de ocorrência",async()=>{
  const local=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try{
    const now=new Date();
    const day=businessDate(now);
    const start=new Date(Date.parse(day+"T12:00:00Z")-6*86400000).toISOString().slice(0,10);
    const password="teste-local-relatorio-123";
    local.seed(await buildMockSql(password,now,{access:true,v2:true}));
    const env={DB:local.DB,SESSION_SECRET:"segredo-sintetico-relatorio-sem-producao-123456789",REALTIME_MODE:"off",ACCESS_MODE:"on",LOGIN_RATE_LIMITER:{async limit(){return {success:true}}}};
    const origin="http://localhost";
    // 21 registros manuais, cada qual com fornecedor diferente; um foi recusado.
    const manual=(await local.DB.prepare("SELECT id FROM agendamentos WHERE origem='manual' ORDER BY id").all()).results;
    assert.equal(manual.length,21);
    for(const [i,row] of manual.entries()){
      await local.DB.prepare("UPDATE agendamentos SET fornecedor=?,status=?,observacao=? WHERE id=?").bind("Fornecedor sintético "+i,i===0?"recusado":"recebido",i===0?"Recusa de teste":null,row.id).run();
    }
    const login=await app.request(origin+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({login:"gerente.mock",senha:password})},env);
    assert.equal(login.status,200);
    const cookie=login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    async function get(path,extra=""){
      const response=await app.request(origin+path+"?start="+start+"&end="+day+extra,{headers:{Cookie:cookie}},env);
      assert.equal(response.status,200,await response.clone().text());
      return response.json();
    }
    const report=await get("/api/admin/reports");
    assert.equal(report.manualSupplierCount,21);
    assert.equal(report.semAgendaSuppliers.length,12);
    assert.equal(report.rows.reduce((n,row)=>n+row.semAgenda,0),21);
    assert.equal(report.rows.reduce((n,row)=>n+row.semAgendaRecebidos,0),20);
    assert.equal(report.rows.reduce((n,row)=>n+row.recusado,0),1);
    assert.ok(report.suppliers.some(row=>row.recusado===1));
    for(const [type,expected] of [["recusado",1],["nao_recebido",42],["nao_compareceu",18]]){
      const data=await get("/api/admin/reports/occurrences","&type="+type);
      assert.equal(data.total,expected);
      assert.ok(data.rows.every(row=>row.occurrenceType===type));
    }
    const all=await get("/api/admin/reports/occurrences");
    assert.equal(all.total,61);
    const scoped=await get("/api/admin/reports","&storeCode=F901");
    assert.equal(scoped.manualSupplierCount,7);
    assert.equal(scoped.rows.reduce((n,row)=>n+row.semAgenda,0),7);
  }finally{local.close();}
});
