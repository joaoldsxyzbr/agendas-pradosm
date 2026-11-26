// Smoke HTTP contra o runtime real do Wrangler, exclusivamente local.
// Não usa credenciais, D1 remoto, preview, nem o estado local do desenvolvedor.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword } from "../worker/lib/password.ts";
import { businessDate } from "../shared/time.ts";
import { avisoSchema, avisosResponseSchema } from "../shared/avisos.ts";

const root = resolve(import.meta.dirname, "..");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const temp = await mkdtemp(join(tmpdir(), "agendas-smoke-"));
const configPath = join(temp, "wrangler.json");
const persist = join(temp, "state");
const migrations = join(temp, "migrations");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(CLOUDFLARE_|CF_|WRANGLER_)/i.test(key)));
Object.assign(env, { CI: "true", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", CLOUDFLARE_INCLUDE_PROCESS_ENV: "false" });
const config = JSON.parse((await readFile(join(root, "wrangler.local.jsonc"), "utf8")).replace(/^\s*\/\/.*$/gm, ""));
assert.equal(config.d1_databases.length, 1);
assert.equal(config.d1_databases[0].database_id, "00000000-0000-4000-8000-000000000001");
assert.equal(config.d1_databases[0].binding, "DB");
assert.equal(config.d1_databases[0].remote, undefined);
const secret = randomUUID() + randomUUID();
const password = "Sintetica-" + randomUUID();
const now = new Date().toISOString();
const today = businessDate();
const ids = Object.fromEntries(["admin","viewer","conf1","conf2","store1","store2","agenda","appointment"].map(key => [key, randomUUID()]));
let worker;
let logs = "";
const command = (...args) => {
  const result = spawnSync(process.execPath, [wrangler, ...args, "--config", configPath], {
    cwd: root, env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) throw Error("Wrangler local falhou: " + args.slice(0, 3).join(" ") + "\n" + [result.stdout, result.stderr, result.error].filter(Boolean).join("\n").replaceAll(secret,"[redigido]").replaceAll(password,"[redigido]"));
  return result.stdout;
};
const sql = value => "'" + String(value).replaceAll("'", "''") + "'";
const values = (...items) => items.map(value => value === null ? "NULL" : sql(value)).join(",");
try {
  // Banco novo e vazio: o Wrangler/D1 já executa cada migration em transação.
  // Somente a migration histórica 0029 contém BEGIN/COMMIT explícitos.
  // Copiamos todos os arquivos para o temporário e adaptamos APENAS o envelope
  // da 0029. Os testes SQLite executam o original intacto, inclusive com dados.
  // Não usar esta adaptação para migrar um banco existente (ON DELETE CASCADE).
  await mkdir(migrations);
  const names = (await readdir(join(root, "migrations"))).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
  for (const name of names) {
    let source = await readFile(join(root, "migrations", name), "utf8");
    if (name === "0029_avisos_chat.sql") {
      for (const line of ["PRAGMA foreign_keys = OFF;", "BEGIN;", "COMMIT;", "PRAGMA foreign_keys = ON;"]) {
        assert.equal(source.split(/\r?\n/).filter(value => value === line).length, 1, "Envelope histórico inesperado: " + line);
        source = source.split(/\r?\n/).filter(value => value !== line).join("\n");
      }
    }
    await writeFile(join(migrations, name), source);
  }
  // Lista positiva de campos: nenhuma configuração de serviços remotos é herdada.
  const isolated = {
    name: "agendas-smoke-local",
    compatibility_date: config.compatibility_date,
    main: join(root, "worker/index.ts"),
    assets: { ...config.assets, directory: join(root, "dist") },
    d1_databases: [{ ...config.d1_databases[0], migrations_dir: migrations }],
    ratelimits: config.ratelimits,
    durable_objects: config.durable_objects,
    migrations: config.migrations,
    vars: { REALTIME_MODE: "off", SESSION_SECRET: secret }
  };
  await mkdir(persist);
  await writeFile(configPath, JSON.stringify(isolated));
  // Geração oficial de tipos, sem registrar valores ou arquivos gerados no repositório.
  const typesPath = join(temp, "worker-configuration.d.ts");
  command("types", typesPath, "--env-interface", "GeneratedEnv", "--strict-vars", "false");
  const types = await readFile(typesPath, "utf8");
  for (const binding of ["DB", "SESSION_SECRET", "REALTIME_MODE", "REALTIME_HUB", "LOGIN_RATE_LIMITER", "ASSETS"]) {
    assert.match(types, new RegExp("\\b" + binding + "\\s*:"), "Binding ausente nos tipos oficiais: " + binding);
  }
  console.log("Wrangler: tipos oficiais gerados para os seis bindings locais.");
  // Compila a fronteira já consolidada usando tipos oficiais do runtime, sem
  // carregar os tipos manuais nem importar a implementação inteira via Env.
  const runtimePath = join(temp, "runtime.d.ts");
  command("types", runtimePath, "--include-env", "false");
  const strict = JSON.parse(await readFile(join(root, "worker/tsconfig.strict.json"), "utf8"));
  const sources = strict.include.filter(path => !path.endsWith(".d.ts")).map(path => resolve(root, "worker", path));
  const runtimeTsconfig = join(temp, "tsconfig.runtime.json");
  await writeFile(runtimeTsconfig, JSON.stringify({
    extends: join(root, "worker/tsconfig.strict.json"),
    compilerOptions: { lib: ["ES2022"], types: [] },
    include: [], files: [runtimePath, ...sources]
  }));
  const checked = spawnSync(process.execPath, [join(root,"apps/web/node_modules/typescript/bin/tsc"),"-p",runtimeTsconfig], {cwd:root,env,encoding:"utf8",timeout:60_000});
  assert.equal(checked.status, 0, "Tipos oficiais do runtime: " + (checked.stdout || checked.stderr));
  console.log("Módulos strict compilados contra tipos oficiais do runtime.");
  command("d1", "migrations", "apply", "DB", "--local", "--persist-to", persist);
  const hash = await hashPassword(password);
  const seed = [
    "INSERT INTO lojas (id,codigo,nome,criado_em,atualizado_em) VALUES (" + values(ids.store1,"01","Loja sintética 1",now,now) + ");",
    "INSERT INTO lojas (id,codigo,nome,criado_em,atualizado_em) VALUES (" + values(ids.store2,"02","Loja sintética 2",now,now) + ");",
    ...[["admin",null,"admin"],["viewer",null,"visualizador"],["conf1",ids.store1,"conferente"],["conf2",ids.store2,"conferente"]].map(([key,store,role]) =>
      "INSERT INTO usuarios (id,loja_id,nome,login,senha_hash,papel,ativo,criado_em,atualizado_em) VALUES (" + values(ids[key],store,key,key,hash,role,1,now,now) + ");"),
    "INSERT INTO agendas (id,loja_id,data_agenda,arquivo_original,criado_por,status_dia,criado_em,atualizado_em) VALUES (" + values(ids.agenda,ids.store1,today,"sintetico.csv",ids.admin,"aberto",now,now) + ");",
    "INSERT INTO agendamentos (id,agenda_id,protocolo,horario_inicio,horario_fim,fornecedor,ativo,status,origem,criado_em,atualizado_em) VALUES (" + values(ids.appointment,ids.agenda,"P001","08:00","09:00","Fornecedor sintético",1,"aguardando","importado",now,now) + ");"
  ].join("\n");
  const seedPath = join(temp, "seed.sql");
  await writeFile(seedPath, seed);
  command("d1", "execute", "DB", "--local", "--persist-to", persist, "--file", seedPath);
  const fk = JSON.parse(command("d1", "execute", "DB", "--local", "--persist-to", persist, "--command", "PRAGMA foreign_key_check", "--json"));
  assert.ok(fk.length > 0 && fk.every(result => result.success && result.results.length === 0), "Fixture com chaves estrangeiras inválidas");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((ok, fail) => server.close(error => error ? fail(error) : ok()));
  const base = "http://127.0.0.1:" + port;
  worker = spawn(process.execPath, [wrangler, "dev", "--local", "--config", configPath, "--persist-to", persist, "--ip", "127.0.0.1", "--port", String(port)], {
    cwd: root, env, stdio: ["ignore","pipe","pipe"], detached: process.platform !== "win32"
  });
  worker.on("error", error => { logs += String(error); });
  for (const pipe of [worker.stdout,worker.stderr]) pipe.on("data", chunk => { logs = (logs + chunk).slice(-12000); });
  const cookies = new Map();
  async function request(path, { user, method = "GET", body, origin = base, status = 200 } = {}) {
    const headers = new Headers({ Origin: origin });
    if (user && cookies.has(user)) headers.set("Cookie", cookies.get(user));
    if (body !== undefined) headers.set("Content-Type","application/json");
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: "manual" });
    assert.equal(res.status, status, method + " " + path);
    return res;
  }
  let ready = false;
  for (let n=0;n<120;n++) {
    if (worker.exitCode !== null) break;
    try { const res = await fetch(base + "/api/health",{signal:AbortSignal.timeout(1500)}); if(res.ok && (await res.json()).database === "ok"){ready=true;break;} } catch {}
    await delay(500);
  }
  assert.ok(ready, "Worker local não ficou pronto");
  await request("/api/auth/me",{status:401});
  for (const user of ["admin","viewer","conf1","conf2"]) {
    const res = await request("/api/auth/login",{method:"POST",body:{login:user,senha:password}});
    const cookie = res.headers.get("set-cookie");
    assert.ok(cookie?.includes("HttpOnly") && /SameSite=Strict/i.test(cookie));
    cookies.set(user,cookie.split(";")[0]);
    assert.equal((await (await request("/api/auth/me",{user})).json()).id,ids[user]);
  }
  const agenda = await (await request("/api/store/today",{user:"conf1"})).json();
  assert.equal(agenda.agenda.id,ids.agenda);
  assert.equal(agenda.appointments[0].id,ids.appointment);
  const path = "/api/store/appointments/" + ids.appointment;
  await request(path,{user:"conf2",status:404});
  await request(path+"/status",{user:"viewer",method:"PATCH",body:{status:"recebido"},status:403});
  await request(path+"/status",{user:"conf1",method:"PATCH",origin:"https://cross-site.invalid",body:{status:"recebido"},status:403});
  await request(path+"/status",{user:"conf1",method:"PATCH",body:{status:"recebido"}});
  assert.equal((await (await request("/api/store/today",{user:"conf1"})).json()).appointments[0].status,"recebido");
  const aviso = avisoSchema.parse(await (await request("/api/admin/avisos",{user:"admin",method:"POST",body:{titulo:"Aviso sintético",mensagem:"Integração local",lojas:["01"]},status:201})).json());
  const list = async user => avisosResponseSchema.parse(await (await request("/api/avisos",{user})).json());
  assert.ok((await list("conf1")).avisos.some(item=>item.id===aviso.id));
  assert.ok(!(await list("conf2")).avisos.some(item=>item.id===aviso.id));
  await request("/api/avisos",{user:"viewer",status:403});
  await request("/api/avisos/"+aviso.id+"/reacao",{user:"conf2",method:"PUT",body:{emoji:"👍"},status:404});
  await request("/api/avisos/"+aviso.id+"/reacao",{user:"conf1",method:"PUT",body:{emoji:"👍"}});
  const mark = "/api/avisos/"+aviso.id+"/lido";
  assert.equal((await (await request(mark,{user:"conf1",method:"POST"})).json()).jaLido,false);
  assert.equal((await (await request(mark,{user:"conf1",method:"POST"})).json()).jaLido,true);
  const readers = await (await request("/api/admin/avisos/"+aviso.id+"/leitores",{user:"admin"})).json();
  assert.ok(readers.vistos.some(item=>item.id===ids.conf1));
  assert.equal(readers.faltantes.length,0);
  await request("/api/auth/logout",{user:"conf1",method:"POST",status:204});
  await request("/api/auth/me",{user:"conf1",status:401});
  console.log("Smoke HTTP local aprovado: migrations, login, perfis, isolamento, recebimento, avisos, reações, leitura idempotente e revogação.");
} catch (error) {
  // A saída só contém fixture sintética, mas evita divulgar o segredo efêmero.
  console.error(logs.replaceAll(secret,"[redigido]").replaceAll(password,"[redigido]"));
  throw error;
} finally {
  if (worker?.pid && worker.exitCode === null) {
    const exited = once(worker,"exit").catch(()=>{});
    try { if(process.platform !== "win32") process.kill(-worker.pid,"SIGTERM"); else worker.kill(); } catch {}
    await Promise.race([exited,delay(5000)]);
    try { if(process.platform !== "win32") process.kill(-worker.pid,"SIGKILL"); else if(worker.exitCode===null) worker.kill("SIGKILL"); } catch {}
  }
  await rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
