// Inicialização exclusivamente local. Nenhuma opção arbitrária de Wrangler é aceita.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { buildMockSql, MOCK_ACCOUNTS, mockImportCsv } from "./mock-data.mjs";
import { mockStatePath } from "./mock-state.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const state = mockStatePath(root);
console.log("Node "+process.version+" | "+process.platform+" "+process.arch);
console.log("Estado local: "+state);
const config = join(root, "wrangler.local.jsonc");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !["--seed-only", "--open-browser"].includes(args[0]))) throw Error("Use npm run dev:mock ou npm run mock:seed.");
const seedOnly = args[0] === "--seed-only";
const openBrowser = args[0] === "--open-browser" && process.platform === "win32";

// Verifica o UUID sintético e rejeita bindings remotos antes de executar CLI.
const local = JSON.parse(readFileSync(config,"utf8").replace(/^\s*\/\/.*$/gm,""));
const db = local.d1_databases;
if (db?.length !== 1 || db[0].binding !== "DB" ||
    db[0].database_id !== "00000000-0000-4000-8000-000000000003" ||
    db[0].database_name !== "agendas-pradosm-v2-local" ||
    db[0].migrations_dir !== "migrations-v2" || db[0].remote === true || local.env || local.r2_buckets || local.kv_namespaces ||
    local.services || local.durable_objects?.bindings?.some(b => b.remote || b.script_name)) {
  throw Error("Configuração local inesperada. Inicialização bloqueada.");
}
if (!existsSync(wrangler)) throw Error("Instale as dependências com npm ci --legacy-peer-deps.");
mkdirSync(state,{recursive:true});
const credentialsFile=join(state,"credentials.json");
try {
  writeFileSync(credentialsFile,JSON.stringify({
    password:randomBytes(18).toString("base64url"),
    sessionSecret:randomBytes(48).toString("hex"),
  },null,2)+"\n",{flag:"wx",mode:0o600});
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
}
const {password,sessionSecret}=JSON.parse(readFileSync(credentialsFile,"utf8"));
if(typeof password!=="string" || !/^[A-Za-z0-9_-]{24}$/.test(password) ||
   typeof sessionSecret!=="string" || !/^[a-f0-9]{96}$/.test(sessionSecret)) throw Error("Credenciais locais inválidas; preserve o diretório ou recrie um ambiente limpo.");
const env={...process.env,WRANGLER_SEND_METRICS:"false"};
function run(cliArgs) {
  const result=spawnSync(process.execPath,[wrangler,...cliArgs],{cwd:root,env,stdio:"inherit"});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error("Wrangler local terminou sem sucesso na etapa "+cliArgs.slice(0,3).join(" ")+". Confira o log acima. Estado preservado em "+state);
}
const localFlags=["--local","--config",config,"--persist-to",state];
console.log("Aplicando migrations no D1 LOCAL...");
run(["d1","migrations","apply","DB",...localFlags]);
const sqlFile=join(state,"seed-"+randomBytes(8).toString("hex")+".sql");
writeFileSync(sqlFile,await buildMockSql(password,new Date(),{access:true,v2:true}),{flag:"wx",mode:0o600});
try {
  run(["d1","execute","DB",...localFlags,"--file",sqlFile]);
} finally {
  rmSync(sqlFile,{force:true});
}
const csv=join(state,"importacao-mock.csv");
writeFileSync(csv,mockImportCsv(),"utf8");
console.log("\nAmbiente LOCAL fictício — não use estas contas fora do localhost.");
for(const user of MOCK_ACCOUNTS) console.log("  "+user.login+" — "+user.name);
console.log("Senha inicial comum: "+password);
console.log("CSV de importação: "+csv);
console.log("Dados persistidos em: "+state);
console.log("Contas já editadas não têm senha/permissões restauradas pelo seed.");
if (!seedOnly) {
  console.log("Abra http://127.0.0.1:8787");
  const devArgs = ["dev",...localFlags,"--ip","127.0.0.1","--port","8787","--var","SESSION_SECRET:"+sessionSecret];
  if (!openBrowser) run(devArgs);
  else {
    // Não abrir outro servidor que já esteja usando a porta.
    const { createServer } = await import("node:net");
    const probe = createServer();
    await new Promise((resolve,reject) => {
      probe.once("error", reject);
      probe.listen(8787,"127.0.0.1",() => probe.close(resolve));
    });
    const child=spawn(process.execPath,[wrangler,...devArgs],{cwd:root,env,stdio:"inherit"});
    const finished=new Promise((resolve,reject) => {
      child.once("error",reject);
      child.once("exit",(code,signal)=>resolve({code,signal}));
    });
    const stop=()=>{ if(child.exitCode===null && child.signalCode===null) child.kill(); };
    process.once("SIGINT",stop);
    process.once("SIGTERM",stop);
    async function launchWhenReady() {
      for(let attempt=0;attempt<90 && child.exitCode===null && child.signalCode===null;attempt++){
        try {
          const response=await fetch("http://127.0.0.1:8787/api/health",{signal:AbortSignal.timeout(1500)});
          if(response.ok && (await response.json()).database==="ok"){
            const browser=spawn("explorer.exe",["http://127.0.0.1:8787"],{stdio:"ignore",windowsHide:true,detached:true});
            browser.once("error",()=>console.log("Abra http://127.0.0.1:8787 manualmente."));
            browser.unref();
            return;
          }
        }catch{}
        await delay(1000);
      }
      if(child.exitCode===null && child.signalCode===null) console.log("Abra http://127.0.0.1:8787 quando o servidor estiver pronto.");
    }
    try {
      const result=await Promise.race([finished,launchWhenReady().then(()=>finished)]);
      if(result.code!==0 && result.signal===null) throw Error("Servidor local terminou sem sucesso.");
    }finally{
      process.removeListener("SIGINT",stop);
      process.removeListener("SIGTERM",stop);
    }
  }
}
