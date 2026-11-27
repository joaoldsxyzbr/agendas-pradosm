import assert from "node:assert/strict";
import {test} from "node:test";
import {resolvePermissions} from "../../shared/permissions.ts";
import {routePolicy,permitsAction,permitsResolvedScope,permitsImportReplacement,permitsDayStatus} from "../../worker/middleware/access-policy.ts";
import {decodeAccess,findEffectiveAccess,saveAccessConfiguration} from "../../worker/repositories/access.ts";
import {openLocalDatabase} from "../../scripts/local-sqlite.mjs";
import {fileURLToPath} from "node:url";
import {buildMockSql,mockId} from "../../scripts/mock-data.mjs";

test("digitador pode operar recebimento e importação, mas não administrar usuários",()=>{
  const p=resolvePermissions("digitador")!;
  assert.ok(permitsAction(routePolicy("PATCH","/api/admin/appointments/123/status"),p));
  assert.ok(permitsAction(routePolicy("DELETE","/api/admin/appointments/123/manual"),p));
  assert.ok(!permitsAction(routePolicy("GET","/api/admin/users"),p));
  assert.ok(permitsImportReplacement(p,false));
  assert.ok(permitsImportReplacement(p,true));
  assert.ok(permitsDayStatus(p,"aberto"));
});
test("nega métodos desconhecidos, rotas não inventariadas e caminhos ambíguos",()=>{
  for(const path of ["/api/admin/unknown","/api/admin/agendas/%2F","/api/admin//agendas","/api/admin/agendas/..","/api/admin/agendas?x=1"])
    assert.equal(routePolicy("GET",path),null);
  assert.equal(routePolicy("PUT","/api/admin/users"),null);
});
test("escopo exige todas as lojas reais; não autoriza filtros ainda não integrados",()=>{
  const scope={mode:"assigned",storeIds:["s1","s2"]} as const;
  const policy=routePolicy("POST","/api/admin/agendas/import/bulk");
  assert.ok(permitsResolvedScope(policy,scope,["s1","s2"]));
  assert.ok(!permitsResolvedScope(policy,scope,["s1","s3"]));
  assert.ok(!permitsResolvedScope(policy,scope,[]));
  assert.ok(!permitsResolvedScope(routePolicy("GET","/api/admin/reports"),scope,["s1"]));
  assert.ok(!permitsResolvedScope(routePolicy("GET","/api/admin/users"),scope,["s1"]));
});
test("resolve perfil, vínculos e exceções reais em um snapshot SQLite",async()=>{
  const local=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try{
    local.seed(await buildMockSql("teste-local-123456"));
    const a=mockId("user:admin.mock"),v=mockId("user:gerente.mock"),c=mockId("user:conferente01.mock"),s1=mockId("store:1"),s2=mockId("store:2");
    assert.equal((await findEffectiveAccess(local.DB,a))?.profile,"admin");
    assert.deepEqual((await findEffectiveAccess(local.DB,c))?.scope,{mode:"assigned",storeIds:[s1]});
    assert.equal(await findEffectiveAccess(local.DB,"ausente"),null);
    await local.DB.prepare("INSERT INTO usuario_acesso(usuario_id,perfil,escopo) VALUES (?,?,?)").bind(v,"digitador","vinculadas").run();
    await local.DB.prepare("INSERT INTO usuario_acesso_lojas(usuario_id,loja_id) VALUES (?,?)").bind(v,s1).run();
    await local.DB.prepare("INSERT INTO usuario_acesso_lojas(usuario_id,loja_id) VALUES (?,?)").bind(v,s2).run();
    await local.DB.prepare("INSERT INTO usuario_acesso_excecoes(usuario_id,permissao,efeito) VALUES (?,?,?)").bind(v,"agendas.editar","deny").run();
    const access=await findEffectiveAccess(local.DB,v);
    assert.equal(access?.profile,"digitador");
    assert.equal(access?.customized,true);
    assert.deepEqual(access?.scope,{mode:"assigned",storeIds:[s1,s2].sort()});
    assert.ok(!access?.permissions.has("agendas.editar"));
    await local.DB.prepare("INSERT INTO usuario_acesso_excecoes(usuario_id,permissao,efeito) VALUES (?,?,?)").bind(v,"inexistente","allow").run();
    assert.equal(await findEffectiveAccess(local.DB,v),null);
  }finally{local.close()}
});
test("configuração inválida falha fechada",()=>{
  const row={papel:"visualizador",loja_id:null,session_version:1,perfil:"digitador",escopo:"todas",lojas:'["s1"]',excecoes:"[]"};
  assert.equal(decodeAccess(row),null);
  assert.equal(decodeAccess({...row,escopo:"vinculadas",excecoes:"not-json"}),null);
});

test("grava acesso e auditoria em batch, invalida sessão e reverte erro de loja ou autoridade",async()=>{
  const local=openLocalDatabase(":memory:",fileURLToPath(new URL("../../migrations-v2/",import.meta.url)));
  try{
    local.seed(await buildMockSql("teste-local-123456"));
    const admin=mockId("user:admin.mock"),v=mockId("user:gerente.mock"),s1=mockId("store:1"),s2=mockId("store:2");
    const actor={id:admin,sessionVersion:1};
    const input={profile:"digitador",scope:{mode:"assigned",storeIds:[s1,s2]},overrides:[{permission:"agendas.editar",effect:"deny"}]} as const;
    const result=await saveAccessConfiguration(local.DB,actor,v,1,input);
    assert.equal(result.sessionVersion,2);
    assert.equal(result.profile,"digitador");
    assert.ok(!result.permissions.has("agendas.editar"));
    const events=await local.DB.prepare("SELECT usuario_id,antes,depois FROM auditoria WHERE entidade_id=? AND acao='usuario_acesso_atualizado'").bind(v).all();
    assert.equal(events.results.length,1);
    assert.equal(events.results[0].usuario_id,admin);
    assert.equal(JSON.parse(events.results[0].antes).profile,"visualizador");
    assert.equal(JSON.parse(events.results[0].depois).profile,"digitador");
    await assert.rejects(saveAccessConfiguration(local.DB,actor,v,1,input));
    await assert.rejects(saveAccessConfiguration(local.DB,actor,v,2,{...input,scope:{mode:"assigned",storeIds:["inexistente"]}}));
    await assert.rejects(saveAccessConfiguration(local.DB,{id:v,sessionVersion:2},admin,1,input));
    await assert.rejects(saveAccessConfiguration(local.DB,actor,admin,1,input));
    assert.equal((await findEffectiveAccess(local.DB,v))?.sessionVersion,2);
    assert.deepEqual((await findEffectiveAccess(local.DB,v))?.scope,result.scope);
    assert.equal((await local.DB.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE entidade_id=? AND acao='usuario_acesso_atualizado'").bind(v).first()).n,1);
    await assert.rejects(local.DB.prepare("INSERT INTO usuario_acesso(usuario_id,perfil,escopo) VALUES (?,?,?)").bind(admin,"digitador","todas").run(),/ULTIMO_ADMIN_INTEGRAL/);
  }finally{local.close()}
});
