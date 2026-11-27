// Smoke do servidor de homologação LOCAL. Não usa deploy ou credencial remota.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { mockStatePath } from "./mock-state.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const env={...process.env,WRANGLER_SEND_METRICS:"false"};
const native=process.argv.includes("--node");
const state=native?join(mockStatePath(root),"node"):mockStatePath(root);
const base="http://127.0.0.1:8787";
const logs=join(root,".tmp",native?"local-mock-node-smoke.log":"local-mock-smoke.log");
mkdirSync(join(root,".tmp"),{recursive:true});
// Credenciais efêmeras, produzidas pelo próprio smoke. Não transmitir dados lidos de arquivos.
// A criação exclusiva garante que o teste nunca sobrescreva uma conta local existente.
mkdirSync(state,{recursive:true});
const password=randomBytes(18).toString("base64url");
writeFileSync(join(state,"credentials.json"),JSON.stringify({password,sessionSecret:randomBytes(48).toString("hex")}),{flag:"wx",mode:0o600});
let output="";
const child=spawn(process.execPath,[join(root,"scripts",native?"dev-mock-node.mjs":"dev-mock.mjs")],{cwd:root,env,stdio:["ignore","pipe","pipe"],windowsHide:true});
let exited=false;
const done=new Promise((resolve,reject)=>{
  child.once("error",reject);
  child.once("exit",(code,signal)=>{exited=true;resolve({code,signal});});
});
for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{output+=String(chunk);});
try {
  let ready=false;
  for(let attempt=0;attempt<150&&!exited;attempt++){
    try {
      const res=await fetch(base+"/api/health",{signal:AbortSignal.timeout(1000)});
      if(res.ok&&(await res.json()).database==="ok"){ready=true;break;}
    }catch{}
    await delay(1000);
  }
  assert.ok(ready,"Servidor e D1 local não ficaram prontos.");
  async function login(loginName){
    const res=await fetch(base+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify({login:loginName,senha:password})});
    assert.equal(res.status,200,"Login local: "+loginName);
    const user=await res.json();
    const cookie=res.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    return {user,cookie};
  }
  const admin=await login("admin.mock");
  assert.equal(admin.user.papel,"admin");
  const viewer=await login("gerente.mock");
  assert.equal(viewer.user.papel,"visualizador");
  const conf=await login("conferente01.mock");
  assert.equal(conf.user.lojaCodigo,"F901");
  const own=await fetch(base+"/api/store/today",{headers:{Cookie:conf.cookie}});
  assert.equal(own.status,200);
  const data=await own.json();
  assert.equal(data.appointments.length,6);
  assert.equal((await fetch(base+"/api/admin/users",{headers:{Cookie:conf.cookie}})).status,403);
  assert.equal((await fetch(base+"/api/admin/users",{headers:{Cookie:viewer.cookie}})).status,403);
  assert.equal((await fetch(base+"/api/admin/users",{headers:{Cookie:admin.cookie}})).status,200);
  const html=await fetch(base+"/login");
  assert.equal(html.status,200);
  const token=(await html.text()).match(/name="agenda-local-token" content="([a-f0-9]{64})"/)?.[1];
  const quickList=await fetch(base+"/api/local-mock/accounts",{headers:token?{"X-Agenda-Local-Token":token}:{}});
  if(native){
    assert.ok(token);
    assert.equal((await fetch(base+"/api/local-mock/accounts")).status,403);
    assert.equal(quickList.status,200);
    const list=await quickList.json();
    assert.equal(list.accounts.length,6);
    assert.ok(list.accounts.every(a=>Object.keys(a).sort().join(",")==="label,login"));
    const fast=(login,origin=base)=>fetch(base+"/api/local-mock/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,"X-Agenda-Local-Token":token},body:JSON.stringify({login})});
    assert.equal((await fast("admin.mock","https://example.invalid")).status,403);
    assert.equal((await fast("unknown.mock")).status,400);
    const digitador=await fast("digitador.mock");
    assert.equal(digitador.status,200);
    const digitadorUser=await digitador.json();
    assert.equal(digitadorUser.perfil,"digitador");
    const digitadorCookie=digitador.headers.get("set-cookie")?.split(";")[0];
    assert.equal((await fetch(base+"/api/admin/agendas",{headers:{Cookie:digitadorCookie}})).status,200);
    assert.equal((await fetch(base+"/api/admin/users",{headers:{Cookie:digitadorCookie}})).status,403);
    for(const [name,role] of [["admin.mock","admin"],["gerente.mock","visualizador"],["conferente01.mock","conferente"]]){
      const response=await fast(name);
      assert.equal(response.status,200);
      assert.equal((await response.json()).papel,role);
      const cookie=response.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      const me=await fetch(base+"/api/auth/me",{headers:{Cookie:cookie}});
      assert.equal(me.status,200);
      assert.equal((await me.json()).papel,role);
    }
  }else{
    assert.equal(token,undefined);
    assert.equal(quickList.status,404);
    assert.equal((await fetch(base+"/api/local-mock/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify({login:"admin.mock"})})).status,404);
  }
  console.log("Smoke local: D1, login, isolamento, acesso rápido e SPA verificados.");
} finally {
  if(!exited)child.kill();
  await Promise.race([done,delay(3000)]);
  // Não gravar a senha fictícia impressa durante a inicialização.
  writeFileSync(logs,output.replace(/^.*Senha inicial comum:.*$/gm,"[senha local omitida]"),"utf8");
  if(!exited)process.exitCode=1;
}
