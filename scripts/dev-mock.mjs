// Inicialização exclusivamente local. Nenhuma opção arbitrária de Wrangler é aceita.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMockSql, MOCK_ACCOUNTS, mockImportCsv } from "./mock-data.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const state = join(root, ".wrangler", "mock-state");
const config = join(root, "wrangler.local.jsonc");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--seed-only")) throw Error("Use npm run dev:mock ou npm run mock:seed.");
const seedOnly = args[0] === "--seed-only";

// Verifica o UUID sintético e rejeita bindings remotos antes de executar CLI.
const local = JSON.parse(readFileSync(config,"utf8").replace(/^\s*\/\/.*$/gm,""));
const db = local.d1_databases;
if (db?.length !== 1 || db[0].binding !== "DB" ||
    db[0].database_id !== "00000000-0000-4000-8000-000000000001" ||
    db[0].database_name !== "agendas-pradosm-migracao-local" ||
    db[0].remote === true || local.env || local.r2_buckets || local.kv_namespaces ||
    local.services || local.durable_objects?.bindings?.some(b => b.remote || b.script_name)) {
  throw Error("Configuração local inesperada. Inicialização bloqueada.");
}
if (!existsSync(wrangler)) throw Error("Instale as dependências com npm ci --legacy-peer-deps.");
mkdirSync(state,{recursive:true});
const credentialsFile=join(state,"credentials.json");
if (!existsSync(credentialsFile)) {
  writeFileSync(credentialsFile,JSON.stringify({
    password:randomBytes(18).toString("base64url"),
    sessionSecret:randomBytes(48).toString("hex"),
  },null,2)+"\n",{flag:"wx",mode:0o600});
}
const {password,sessionSecret}=JSON.parse(readFileSync(credentialsFile,"utf8"));
if(typeof password!=="string" || !/^[A-Za-z0-9_-]{24}$/.test(password) ||
   typeof sessionSecret!=="string" || !/^[a-f0-9]{96}$/.test(sessionSecret)) throw Error("Credenciais locais inválidas; preserve o diretório ou recrie um ambiente limpo.");
const env={...process.env,WRANGLER_SEND_METRICS:"false"};
function run(cliArgs) {
  const result=spawnSync(process.execPath,[wrangler,...cliArgs],{cwd:root,env,stdio:"inherit"});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error("Wrangler local terminou sem sucesso.");
}
const localFlags=["--local","--config",config,"--persist-to",state];
run(["d1","migrations","apply","DB",...localFlags]);
const sqlFile=join(state,"seed-"+randomBytes(8).toString("hex")+".sql");
try {
  writeFileSync(sqlFile,await buildMockSql(password),{flag:"wx",mode:0o600});
  run(["d1","execute","DB",...localFlags,"--file",sqlFile]);
} finally {
  if (existsSync(sqlFile)) unlinkSync(sqlFile);
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
  run(["dev",...localFlags,"--ip","127.0.0.1","--port","8787","--var","SESSION_SECRET:"+sessionSecret]);
}
