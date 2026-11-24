import assert from "node:assert/strict";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {openLocalDatabase} from "../../scripts/local-sqlite.mjs";
import {buildMockSql,mockId} from "../../scripts/mock-data.mjs";
import {app} from "../../worker/app.ts";
import {businessDate} from "../../shared/time.ts";

test("controle de acesso real: criação, escopo, ações, sessão revogada, auditoria",async()=>{
  const local=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations/",import.meta.url)));
  try{
    const password="teste-local-integracao-123";
    await local.seed(await buildMockSql(password,new Date(),{access:true}));
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
    const old=await login("agendador.mock");
    assert.equal(old.user.perfil,"agendador");
    assert.equal((await request("/api/admin/users","GET",old.cookie)).status,403);
    const schedulerId=old.user.id;
    const s1=mockId("store:1"),s2=mockId("store:2"),s3=mockId("store:3");
    const g1=mockId("agenda:"+s1+":"+businessDate()),g3=mockId("agenda:"+s3+":"+businessDate());
    const p1=mockId("appointment:"+g1+":2"),p3=mockId("appointment:"+g3+":2");
    const access=await request("/api/admin/users/"+schedulerId+"/access","GET",admin.cookie);
    assert.equal(access.status,200);
    const config=await access.json();
    const edit={profile:"agendador",scope:{mode:"assigned",storeIds:[s1,s2]},overrides:[{permission:"recebimento.editar",effect:"deny"}]};
    const changed=await request("/api/admin/users/"+schedulerId+"/access","PUT",admin.cookie,{version:config.sessionVersion,access:edit});
    assert.equal(changed.status,200,await changed.clone().text());
    assert.equal((await request("/api/auth/me","GET",old.cookie)).status,401);
    const physical=await local.DB.prepare("SELECT ativo FROM usuarios WHERE id=?").bind(schedulerId).first();
    assert.equal(physical.ativo,0);
    const legacyEnv={...env,ACCESS_MODE:"off"};
    assert.equal((await app.request(origin+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({login:"agendador.mock",senha:password})},legacyEnv)).status,401);
    const current=await login("agendador.mock");
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
    assert.deepEqual((await report.json()).rows.map(row=>row.storeCode).sort(),["F901","F902"]);
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
    assert.equal((await request("/api/admin/users/"+schedulerId+"/access","PUT",current.cookie,{version:config.sessionVersion+1,access:edit})).status,403);
    assert.equal((await request("/api/admin/users/"+admin.user.id+"/access","PUT",admin.cookie,{version:1,access:edit})).status,409);
    const audit=await local.DB.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao='usuario_acesso_atualizado' AND usuario_id=? AND entidade_id=?").bind(admin.user.id,schedulerId).first();
    assert.equal(audit.n,1);
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
