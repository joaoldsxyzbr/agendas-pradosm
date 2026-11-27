import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const name of ["react", "react-dom", "react-router", "vite", "vitest", "typescript"]) {
  assert.equal(pkg.dependencies?.[name], undefined, name + " não pode entrar no pacote do Worker");
  assert.equal(pkg.devDependencies?.[name], undefined, name + " não pode entrar no pacote do Worker");
}
const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split("\n");
for (const file of files.filter(file => /\.(tsx?|jsx)$/.test(file))) {
  assert.match(file, /^(?:apps\/web|worker|shared|tests|scripts)\//, "TypeScript fora das pastas do produto: " + file);
}
const modern = JSON.parse(readFileSync("apps/web/package.json", "utf8"));
for (const name of ["react", "react-dom", "react-router"]) assert.ok(modern.dependencies[name], name);
for (const name of ["vite", "typescript", "@tailwindcss/vite"]) assert.ok(modern.devDependencies[name], name);
const configs = ["wrangler.jsonc", "wrangler.preview.jsonc", "wrangler.preview-migrations.jsonc", "wrangler.preview-agendas-migrations.jsonc"];
for (const file of configs) {
  const config = JSON.parse(readFileSync(file, "utf8").replace(/^\/\/[^\n]*\n/, ""));
  assert.match(config.name, /^agendas-pradosm-v2(?:-|$)/, file);
  assert.ok(!config.triggers?.crons?.length, file + ": cron não autorizado");
  assert.equal(config.previews, undefined, file + ": binding legado de preview");
  assert.equal(config.d1_databases?.length, 1, file);
  assert.equal(config.d1_databases[0].database_name, "agendas-pradosm-v2-unconfigured", file);
  assert.equal(config.d1_databases[0].database_id, "00000000-0000-4000-8000-000000000002", file);
}
for (const name of ["deploy", "deploy:cloudflare", "deploy:preview", "db:migrate:preview", "db:migrate:preview:agendas"]) {
  assert.equal(pkg.scripts[name], "node scripts/block-v2-remote.mjs", name + ": operação remota bloqueada");
}
console.log("Isolamento React/Worker e configuração de preview preservados.");
