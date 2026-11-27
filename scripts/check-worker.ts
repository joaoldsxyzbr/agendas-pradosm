import { existsSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { z } from "zod";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const web = join(root, "apps", "web");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// Descobre módulos novos automaticamente, sem manter um segundo inventário
// manual de arquivos além do próprio diretório e do tsconfig.
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}
const listed = ["worker", "shared"].flatMap(sourceFiles).sort();
for (const entry of ["worker/app.ts", "worker/index.ts", "worker/env.ts"]) {
  if (!existsSync(join(root, entry))) throw Error("Entrada esperada ausente: " + entry);
}


// O TypeScript do projeto vive nas dependências da UI React.
if (!existsSync(join(web, "node_modules", "typescript", "package.json")) ||
    !existsSync(join(web, "package-lock.json"))) {
  const install = spawnSync(npm, ["ci"], {
    cwd: web, stdio: "inherit", shell: process.platform === "win32"
  });
  if (install.status !== 0) throw Error("Falha ao instalar dependências do apps/web (fonte do TypeScript)");
}

let count = 0;
for (const file of listed) {
  const full = join(root, file);
  if (!existsSync(full)) throw Error("Arquivo esperado ausente: " + file);
  const code = readFileSync(full, "utf8");
  for (const match of code.matchAll(/\bfrom\s+["'](\.\.?\/[^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier.endsWith(".ts")) throw Error("Import sem extensão .ts: " + file + " -> " + specifier);
    const target = resolve(dirname(full), specifier);
    if (!existsSync(target)) throw Error("Import inexistente: " + file + " -> " + specifier);
  }
  count++;
}

const tsc = join(web, "node_modules", "typescript", "bin", "tsc");
// Apenas data/flags de compatibilidade, sem bindings, assets ou credenciais.
const compatibilitySchema = z.object({ compatibility_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), compatibility_flags: z.array(z.string()).optional() });
const prod = compatibilitySchema.parse(JSON.parse(readFileSync(join(root,"wrangler.jsonc"),"utf8").replace(/^\s*\/\/.*$/gm,"")));
const local = compatibilitySchema.parse(JSON.parse(readFileSync(join(root,"wrangler.local.jsonc"),"utf8").replace(/^\s*\/\/.*$/gm,"")));
if (prod.compatibility_date !== local.compatibility_date ||
    JSON.stringify([...(prod.compatibility_flags ?? [])].sort()) !== JSON.stringify([...(local.compatibility_flags ?? [])].sort()))
  throw Error("Configuração de compatibilidade local difere da produção.");
const generated = join(root,"worker",".tmp","runtime.d.ts");
const configDir = mkdtempSync(join(tmpdir(),"agendas-types-"));
try {
  mkdirSync(dirname(generated), {recursive:true});
  rmSync(generated, {force:true});
  const config = join(configDir,"wrangler.json");
  writeFileSync(config, JSON.stringify({ name:"agendas-types-local", main:join(root,"worker","index.ts"), ...prod }));
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(CLOUDFLARE_|CF_|WRANGLER_)/i.test(key)));
  Object.assign(env,{CI:"true",WRANGLER_SEND_METRICS:"false",CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:"false",CLOUDFLARE_INCLUDE_PROCESS_ENV:"false"});
  const types = spawnSync(process.execPath, [join(root,"node_modules","wrangler","bin","wrangler.js"),"types",generated,"--include-env","false","--config",config], {cwd:root,env,encoding:"utf8",timeout:120_000});
  if (types.status !== 0 || !existsSync(generated)) throw Error("Falha ao gerar tipos oficiais do runtime:\n" + (types.stderr || types.stdout));
} finally { rmSync(configDir,{recursive:true,force:true}); }

const check = spawnSync(process.execPath, [tsc, "-p", "worker"], { cwd: root, encoding: "utf8" });
if (check.status !== 0) throw Error("TypeScript do Worker (runtime oficial) reprovado:\n" + (check.stderr || check.stdout));
const scopedStrict = spawnSync(process.execPath, [tsc, "-p", "worker/tsconfig.nexello.json"], { cwd: root, encoding: "utf8" });
if (scopedStrict.status !== 0) throw Error("TypeScript estrito V2 (índices verificados) reprovado:\n" + (scopedStrict.stderr || scopedStrict.stdout));
const nodeCheck = spawnSync(process.execPath, [tsc, "-p", "tsconfig.node.json"], { cwd: root, encoding: "utf8" });
if (nodeCheck.status !== 0) throw Error("TypeScript Node estrito reprovado:\n" + (nodeCheck.stderr || nodeCheck.stdout));
console.log("Scripts e testes consolidados sob strict.");
console.log("Worker e contratos em TypeScript: " + count + " módulos com imports e tipos verificados; todos os módulos sob strict.");
