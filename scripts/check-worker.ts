import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const web = join(root, "apps", "web");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// Descobre módulos novos automaticamente, sem manter um segundo inventário
// manual de arquivos além do próprio diretório e do tsconfig.
function sourceFiles(directory) {
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
const check = spawnSync(process.execPath, [tsc, "-p", "worker"], { cwd: root, encoding: "utf8" });
if (check.status !== 0) throw Error("TypeScript do Worker reprovado:\n" + (check.stderr || check.stdout));
const strictCheck = spawnSync(process.execPath, [tsc, "-p", "worker/tsconfig.strict.json"], { cwd: root, encoding: "utf8" });
if (strictCheck.status !== 0) throw Error("TypeScript estrito dos módulos consolidados reprovado:\n" + (strictCheck.stderr || strictCheck.stdout));
console.log("Worker e contratos em TypeScript: " + count + " módulos com imports e tipos verificados; módulos de fronteira sob strict.");
