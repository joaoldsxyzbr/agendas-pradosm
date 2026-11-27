import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const web = join(root, "apps", "web");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const listed = [
  "worker/app.ts", "worker/index.ts", "worker/env.ts",
  "worker/lib/http.ts", "worker/lib/login-rate-limit.ts", "worker/lib/password.ts",
  "worker/lib/presence.ts", "worker/lib/session.ts", "worker/lib/time.ts",
  "worker/middleware/enforce-access.ts", "worker/services/access-session.ts", "worker/services/agenda-digitacao.ts",
  "worker/middleware/auth.ts", "worker/middleware/access-policy.ts", "worker/repositories/access.ts", "worker/realtime/RealtimeHub.ts",
  "worker/repositories/agendas.ts", "worker/repositories/audit.ts",
  "worker/repositories/nexello-destinations.ts", "worker/repositories/nexello-rate.ts", "worker/repositories/nexello-persistence.ts",
  "worker/repositories/avisos.ts",
  "worker/repositories/diagnostics.ts", "worker/repositories/presence.ts",
  "worker/repositories/stores.ts", "worker/repositories/users.ts",
  "worker/services/agenda-maintenance.ts", "worker/services/realtime.ts",
  "worker/services/retention.ts", "worker/services/nexello-report.ts",
  "worker/services/nexello-agenda.ts", "worker/services/nexello-evidence.ts", "worker/services/nexello-lifecycle.ts", "worker/services/nexello-comparison.ts",
  "worker/routes/admin-agendas.ts", "worker/routes/admin-audit.ts",
  "worker/routes/admin-retention.ts", "worker/routes/admin-reports.ts",
  "worker/routes/admin-stores.ts", "worker/routes/admin-nexello.ts",
  "worker/routes/admin-users.ts", "worker/routes/auth.ts",
  "worker/routes/avisos.ts",
  "worker/routes/diagnostics.ts", "worker/routes/presence.ts",
  "worker/routes/realtime.ts", "worker/routes/store-agendas.ts",
  "shared/agenda.ts", "shared/api.ts", "shared/auth.ts", "shared/avisos.ts", "shared/observations.ts", "shared/realtime.ts",
  "shared/store.ts", "shared/time.ts", "shared/permissions.ts", "shared/nexello-destinations.ts", "shared/nexello-preview.ts", "shared/nexello-review.ts",
  "shared/import/extractPdfText.ts", "shared/import/pdf-engine-liteparse.ts",
  "shared/import/parseAgendaBatch.ts", "shared/import/parseAgendaText.ts",
  "shared/import/readCsvText.ts", "shared/import/validateImportBatch.ts"
];

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
const strictCheck = spawnSync(process.execPath, [tsc, "-p", "worker/tsconfig.nexello.json"], { cwd: root, encoding: "utf8" });
if (strictCheck.status !== 0) throw Error("TypeScript estrito da integração reprovado:\n" + (strictCheck.stderr || strictCheck.stdout));
console.log("Worker e contratos em TypeScript: " + count + " módulos com imports e tipos verificados.");
