import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const CONTRACT_MIGRATION_BASELINE = 12;
export const CONTRACT_APPROVALS_FILE = "contract-approvals.json";

const DESTRUCTIVE_PATTERNS = [
  { label: "DROP", pattern: /\bDROP\s+(?:TABLE|INDEX|TRIGGER|VIEW)\b/i },
  { label: "DELETE FROM", pattern: /\bDELETE\s+FROM\b/i },
  { label: "ALTER TABLE DROP", pattern: /\bALTER\s+TABLE\b[\s\S]*?\bDROP\b/i },
  { label: "ALTER TABLE RENAME", pattern: /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\b/i },
];

function stripSqlComments(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");
}

export function destructiveOperation(sql: string) {
  const normalized = stripSqlComments(sql);
  return DESTRUCTIVE_PATTERNS.find(({ pattern }) => pattern.test(normalized))?.label ?? null;
}

export function migrationNumber(fileName: string) {
  const match = /^(\d+)_.*\.sql$/i.exec(fileName);
  return match ? Number(match[1]) : null;
}

export function migrationDigest(sql: string) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export function isValidContractApproval(approval: unknown, migration: { fileName: string; sql: string; operation: string | null }) {
  if (!approval || typeof approval !== "object") return false;
  if (!("approvedAt" in approval) || !("fileName" in approval) || !("sha256" in approval) || !("operation" in approval) || !("issue" in approval) || !("approvedBy" in approval) || !("reason" in approval)) return false;
  const approvedAt = typeof approval.approvedAt === "string" ? Date.parse(approval.approvedAt) : Number.NaN;
  return (
    approval.fileName === migration.fileName &&
    approval.sha256 === migrationDigest(migration.sql) &&
    approval.operation === migration.operation &&
    typeof approval.issue === "string" &&
    /^#\d+$/.test(approval.issue) &&
    typeof approval.approvedBy === "string" &&
    approval.approvedBy.trim().length >= 2 &&
    Number.isFinite(approvedAt) &&
    typeof approval.reason === "string" &&
    approval.reason.trim().length >= 20
  );
}

export function findUnsafeMigrations(migrationsDir: string) {
  return readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .map((fileName) => ({
      fileName,
      number: migrationNumber(fileName),
      sql: readFileSync(join(migrationsDir, fileName), "utf8"),
    }))
    .filter(({ number }) => number !== null && number > CONTRACT_MIGRATION_BASELINE)
    .map((migration) => ({
      ...migration,
      operation: destructiveOperation(migration.sql),
    }))
    .filter(({ operation }) => operation !== null);
}

export function loadContractApprovals(migrationsDir: string): unknown[] {
  const approvalPath = join(migrationsDir, CONTRACT_APPROVALS_FILE);
  if (!existsSync(approvalPath)) return [];

  const parsed: unknown = JSON.parse(readFileSync(approvalPath, "utf8"));
  return parsed && typeof parsed === "object" && "approvals" in parsed && Array.isArray(parsed.approvals) ? parsed.approvals : [];
}

export function findUnapprovedUnsafeMigrations(migrationsDir: string) {
  const approvals = loadContractApprovals(migrationsDir);

  return findUnsafeMigrations(migrationsDir).filter(
    (migration) =>
      !approvals.some((approval) =>
        isValidContractApproval(approval, migration),
      ),
  );
}

function isMainModule() {
  const current = fileURLToPath(import.meta.url);
  if (!process.argv[1]) return false;
  const entry = process.argv[1].startsWith("/") ? process.argv[1] : resolve(process.cwd(), process.argv[1]);
  return entry === current || entry.endsWith("check-migration-safety.mjs");
}

if (isMainModule()) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const migrationsDir = join(root, "migrations");
  const unsafe = findUnapprovedUnsafeMigrations(migrationsDir);

  if (unsafe.length > 0) {
    console.error(
      "Deploy bloqueado: migration destrutiva nova sem aprovação contract válida.",
    );
    for (const migration of unsafe) {
      console.error(
        `- ${migration.fileName}: ${migration.operation}; sha256=${migrationDigest(migration.sql)}`,
      );
    }
    console.error(
      "Para uma etapa contract previamente aprovada, registre no migrations/contract-approvals.json o arquivo, operação, SHA-256 exato, issue, responsável, data e justificativa. Qualquer alteração posterior no SQL invalida a aprovação.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      "Gate de migrations: nenhuma migration destrutiva não aprovada detectada.",
    );
  }
}
