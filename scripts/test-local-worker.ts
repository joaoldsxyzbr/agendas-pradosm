// Smoke HTTP contra o runtime real do Wrangler, exclusivamente local.
// Não usa credenciais, D1 remoto, preview, nem o estado local do desenvolvedor.
import assert from "node:assert/strict";
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { z } from "zod";
import type { ChildProcess } from "node:child_process";
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
import { avisoSchema, avisosResponseSchema, leitoresAvisoSchema } from "../shared/avisos.ts";

const localConfigSchema = z.object({
  compatibility_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  compatibility_flags: z.array(z.string()).optional(),
  assets: z.record(z.string(), z.unknown()),
  d1_databases: z.array(z.object({
    database_id: z.literal("00000000-0000-4000-8000-000000000001"),
    binding: z.literal("DB"),
    database_name: z.string(),
    remote: z.undefined().optional(),
  }).passthrough()).length(1),
  ratelimits: z.unknown(),
  durable_objects: z.unknown(),
  migrations: z.unknown(),
});
type SmokeEvent = { type: string };
declare global {
  interface Window {
    __smokeRealtime: { events: SmokeEvent[]; closeCode: number | null; socket: WebSocket };
  }
}
const healthSchema = z.object({ database: z.string() });
const identitySchema = z.object({ id: z.string() });
const todaySchema = z.object({ agenda: z.object({ id: z.string() }), appointments: z.array(z.object({ id: z.string(), status: z.string() })) });
const readSchema = z.object({ jaLido: z.boolean() });
const fkSchema = z.array(z.object({ success: z.boolean(), results: z.array(z.unknown()) }));

const root = resolve(import.meta.dirname, "..");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const config = localConfigSchema.parse(JSON.parse((await readFile(join(root, "wrangler.local.jsonc"), "utf8")).replace(/^\s*\/\/.*$/gm, "")));
const temp = await mkdtemp(join(tmpdir(), "agendas-smoke-"));
const configPath = join(temp, "wrangler.json");
const persist = join(temp, "state");
const migrations = join(temp, "migrations");
const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(CLOUDFLARE_|CF_|WRANGLER_)/i.test(key)));
Object.assign(env, { CI: "true", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", CLOUDFLARE_INCLUDE_PROCESS_ENV: "false" });
const secret = randomUUID() + randomUUID();
const password = "Sintetica-" + randomUUID();
const now = new Date().toISOString();
const today = businessDate();
const ids = Object.fromEntries(["admin","viewer","conf1","conf2","store1","store2","agenda","appointment"].map(key => [key, randomUUID()]));
let worker: ChildProcess | undefined;
let browser: Browser | undefined;
let logs = "";
const command = (...args: string[]) => {
  assert.ok(!args.includes("--remote"), "Operação remota proibida no smoke");
  if (args[0] === "d1") assert.ok(args.includes("--local"), "D1 exige --local");
  const result = spawnSync(process.execPath, [wrangler, ...args, "--config", configPath], {
    cwd: root, env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) throw Error("Wrangler local falhou: " + args.slice(0, 3).join(" ") + "\n" + [result.stdout, result.stderr, result.error].filter(Boolean).join("\n").replaceAll(secret,"[redigido]").replaceAll(password,"[redigido]"));
  return result.stdout;
};
const sql = (value: unknown) => "'" + String(value).replaceAll("'", "''") + "'";
const values = (...items: unknown[]) => items.map(value => value === null ? "NULL" : sql(value)).join(",");
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
    compatibility_flags: config.compatibility_flags,
    main: join(root, "worker/index.ts"),
    assets: { ...config.assets, directory: join(root, "dist") },
    d1_databases: [{ ...config.d1_databases[0], migrations_dir: migrations }],
    ratelimits: config.ratelimits,
    durable_objects: config.durable_objects,
    migrations: config.migrations,
    vars: { REALTIME_MODE: "on", SESSION_SECRET: secret }
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
  // A compilação com os tipos oficiais é feita antes dos testes unitários,
  // no check-worker.ts. Aqui validamos os bindings da fixture e o runtime real.
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
  const fk = fkSchema.parse(JSON.parse(command("d1", "execute", "DB", "--local", "--persist-to", persist, "--command", "PRAGMA foreign_key_check", "--json")));
  assert.ok(fk.length > 0 && fk.every(result => result.success && result.results.length === 0), "Fixture com chaves estrangeiras inválidas");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok()));
  const base = "http://127.0.0.1:" + port;
  worker = spawn(process.execPath, [wrangler, "dev", "--local", "--config", configPath, "--persist-to", persist, "--ip", "127.0.0.1", "--port", String(port)], {
    cwd: root, env, stdio: ["ignore","pipe","pipe"], detached: process.platform !== "win32"
  });
  worker.on("error", error => { logs += String(error); });
  for (const pipe of [worker.stdout,worker.stderr]) pipe?.on("data", (chunk: Buffer) => { logs = (logs + chunk).slice(-12000); });
  const cookies = new Map<string, string>();
  async function request(path: string, { user, method = "GET", body, origin = base, status = 200 }: { user?: string; method?: string; body?: unknown; origin?: string; status?: number } = {}) {
    const headers = new Headers({ Origin: origin });
    const cookie = user ? cookies.get(user) : undefined;
    if (cookie) headers.set("Cookie", cookie);
    if (body !== undefined) headers.set("Content-Type","application/json");
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: "manual" });
    assert.equal(res.status, status, method + " " + path);
    return res;
  }
  let ready = false;
  for (let n=0;n<120;n++) {
    if (worker.exitCode !== null) break;
    try { const res = await fetch(base + "/api/health",{signal:AbortSignal.timeout(1500)}); if(res.ok && healthSchema.parse(await res.json()).database === "ok"){ready=true;break;} } catch {}
    await delay(500);
  }
  assert.ok(ready, "Worker local não ficou pronto");
  await request("/api/auth/me",{status:401});
  await request("/api/admin/avisos",{method:"POST",body:{titulo:"Sem sessão",mensagem:"Não publicar"},status:401});
  for (const user of ["admin","viewer","conf1","conf2"]) {
    const res = await request("/api/auth/login",{method:"POST",body:{login:user,senha:password}});
    const cookie = res.headers.get("set-cookie");
    assert.ok(cookie && cookie.includes("HttpOnly") && /SameSite=Strict/i.test(cookie));
    cookies.set(user,cookie.split(";")[0]);
    assert.equal(identitySchema.parse(await (await request("/api/auth/me",{user})).json()).id,ids[user]);
  }
  // Browser real, com sessões independentes: nenhum mock de API ou WebSocket.
  browser = await chromium.launch({ headless: true });
  const activeBrowser = browser;
  const peers = new Map<string, {context: BrowserContext; page: Page}>();
  function peer(user: string) {
    const found = peers.get(user);
    assert.ok(found, "Peer sintético ausente: " + user);
    return found;
  }
  async function connectPeer(user: string) {
    const context = await activeBrowser.newContext();
    const cookie = cookies.get(user);
    assert.ok(cookie, "Cookie sintético ausente");
    const split = cookie.indexOf("=");
    await context.addCookies([{ name: cookie.slice(0,split), value: cookie.slice(split+1), url: base, httpOnly: true, sameSite: "Strict" }]);
    const page = await context.newPage();
    await page.goto(base + "/api/health");
    await page.evaluate(() => {
      const events: SmokeEvent[] = [];
      const state: Window["__smokeRealtime"] = { events, closeCode: null, socket: new WebSocket(location.origin.replace(/^http/, "ws") + "/api/realtime") };
      window.__smokeRealtime = state;
      state.socket.onmessage = event => {
        if (event.data === "pong") { events.push({ type: "pong" }); return; }
        try {
          const raw: unknown = JSON.parse(event.data);
          if (raw && typeof raw === "object" && "type" in raw && typeof raw.type === "string") events.push({type:raw.type});
        } catch { /* ignore protocolo inválido */ }
      };
      state.socket.onclose = event => { state.closeCode = event.code; };
    });
    await page.waitForFunction(() => window.__smokeRealtime.events.some(e => e.type === "realtime.ready"), null, { timeout: 15_000 });
    peers.set(user,{context,page});
  }
  async function waitEvent(user: string,type: string) {
    await peer(user).page.waitForFunction(type => window.__smokeRealtime.events.some(e=>e.type===type),type,{timeout:10_000});
  }
  async function pingBarrier(user: string) {
    const page=peer(user).page;
    await page.evaluate(() => {
      const state=window.__smokeRealtime;
      for (let i=state.events.length-1;i>=0;i--) if(state.events[i].type==="pong") state.events.splice(i,1);
    });
    await page.evaluate(() => {
      const state=window.__smokeRealtime;
      state.socket.send("ping");
    });
    await waitEvent(user,"pong");
  }
  for (const user of ["admin","viewer","conf1","conf2"]) await connectPeer(user);
  await peer("conf1").page.evaluate(() => window.__smokeRealtime.socket.send(JSON.stringify({version:1,type:"presence.set",status:"online"})));
  await waitEvent("admin","presence.changed");
  await pingBarrier("conf1");
  const agenda = todaySchema.parse(await (await request("/api/store/today",{user:"conf1"})).json());
  assert.equal(agenda.agenda.id,ids.agenda);
  assert.equal(agenda.appointments[0].id,ids.appointment);
  const path = "/api/store/appointments/" + ids.appointment;
  await request(path,{user:"conf2",status:404});
  await request(path+"/status",{user:"viewer",method:"PATCH",body:{status:"recebido"},status:403});
  await request(path+"/status",{user:"conf1",method:"PATCH",origin:"https://cross-site.invalid",body:{status:"recebido"},status:403});
  await request(path+"/status",{user:"conf1",method:"PATCH",body:{status:"recebido"}});
  assert.equal(todaySchema.parse(await (await request("/api/store/today",{user:"conf1"})).json()).appointments[0].status,"recebido");
  await waitEvent("admin","agenda.changed");
  await waitEvent("viewer","agenda.changed");
  await request("/api/admin/avisos",{user:"viewer",method:"POST",body:{titulo:"Sem permissão",mensagem:"Não publicar"},status:403});
  await request("/api/admin/avisos",{user:"conf1",method:"POST",body:{titulo:"Sem permissão",mensagem:"Não publicar"},status:403});
  // A requisição excede o limite antes de chegar ao parser JSON/importação.
  const oversized = await fetch(base + "/api/admin/agendas/import/bulk", {
    method:"POST",headers:{Origin:base,"Content-Type":"application/json",Cookie:cookies.get("admin") ?? ""},
    body:JSON.stringify({padding:"x".repeat(1024*1024)}),signal:AbortSignal.timeout(10_000)
  });
  assert.equal(oversized.status,413);
  assert.equal(z.object({error:z.string()}).parse(await oversized.json()).error,"REQUISICAO_MUITO_GRANDE");
  const aviso = avisoSchema.parse(await (await request("/api/admin/avisos",{user:"admin",method:"POST",body:{titulo:"Aviso sintético",mensagem:"Integração local",lojas:["01"]},status:201})).json());
  await waitEvent("admin","avisos.changed");
  await waitEvent("conf1","avisos.changed");
  for (const user of ["viewer","conf2"]) {
    await pingBarrier(user);
    assert.equal(await peer(user).page.evaluate(() => window.__smokeRealtime.events.some(e=>e.type==="avisos.changed")), false, "Evento direcionado vazou para "+user);
  }
  const list = async (user: string) => avisosResponseSchema.parse(await (await request("/api/avisos",{user})).json());
  assert.ok((await list("conf1")).avisos.some(item=>item.id===aviso.id));
  assert.ok(!(await list("conf2")).avisos.some(item=>item.id===aviso.id));
  await request("/api/avisos",{user:"viewer",status:403});
  await request("/api/avisos/"+aviso.id+"/reacao",{user:"conf2",method:"PUT",body:{emoji:"👍"},status:404});
  await request("/api/avisos/"+aviso.id+"/reacao",{user:"conf1",method:"PUT",body:{emoji:"👍"}});
  const mark = "/api/avisos/"+aviso.id+"/lido";
  assert.equal(readSchema.parse(await (await request(mark,{user:"conf1",method:"POST"})).json()).jaLido,false);
  assert.equal(readSchema.parse(await (await request(mark,{user:"conf1",method:"POST"})).json()).jaLido,true);
  const readers = leitoresAvisoSchema.parse(await (await request("/api/admin/avisos/"+aviso.id+"/leitores",{user:"admin"})).json());
  assert.ok(readers.vistos.some(item=>item.id===ids.conf1));
  assert.equal(readers.faltantes.length,0);
  await request("/api/auth/logout",{user:"conf1",method:"POST",status:204});
  await request("/api/auth/me",{user:"conf1",status:401});
  await peer("conf1").page.waitForFunction(() => window.__smokeRealtime.closeCode === 4003, null, {timeout:10_000});
  // Conteúdo persistido deve aparecer como texto, nunca como HTML ativo.
  const literal = '<b data-smoke-html="sentinel">MARCADOR LOCAL</b>';
  const titulo = "Teste sintético de conteúdo literal";
  await request("/api/admin/avisos",{user:"admin",method:"POST",body:{titulo,mensagem:literal},status:201});
  const adminPage = peer("admin").page;
  await adminPage.goto(base + "/admin/avisos");
  const article = adminPage.getByRole("article",{name:titulo});
  await expect(article).toContainText(literal,{timeout:15_000});
  await expect(adminPage.locator("[data-smoke-html=sentinel]")).toHaveCount(0);
  for (const connected of peers.values()) await connected.context.close();
  const ui = await browser.newContext();
  const page = await ui.newPage();
  await page.goto(base + "/login");
  await page.getByRole("textbox", {name:"Login"}).fill("viewer");
  await page.locator('input[name="senha"]').fill(password);
  await page.getByRole("button",{name:"Entrar",exact:true}).click();
  await expect(page).toHaveURL(/\/admin$/, {timeout:15_000});
  await expect(page.getByRole("heading",{name:"Recebimento",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"Avisos"})).toHaveCount(0);
  await page.getByRole("button",{name:"Sair"}).click();
  await expect(page).toHaveURL(/\/login$/, {timeout:15_000});
  await ui.close();
  console.log("Smoke local aprovado: migrations, HTTP, D1, Chromium sem mocks, WebSocket, isolamento, presença, avisos e revogação.");
} catch (error) {
  // A saída só contém fixture sintética, mas evita divulgar o segredo efêmero.
  console.error(logs.replaceAll(secret,"[redigido]").replaceAll(password,"[redigido]"));
  throw error;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (worker?.pid && worker.exitCode === null) {
    const exited = once(worker,"exit").catch(()=>{});
    try { if(process.platform !== "win32") process.kill(-worker.pid,"SIGTERM"); else worker.kill(); } catch {}
    await Promise.race([exited,delay(5000)]);
    try { if(process.platform !== "win32") process.kill(-worker.pid,"SIGKILL"); else if(worker.exitCode===null) worker.kill("SIGKILL"); } catch {}
  }
  await rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
