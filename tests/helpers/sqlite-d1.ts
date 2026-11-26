// Adaptador de testes, exclusivamente SQLite local. Não importa Wrangler nem usa rede.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { Env } from "../../worker/env.ts";
type Hooks = { prepare?: (sql: string) => void; afterFirst?: (sql: string) => void; beforeRun?: (sql: string) => void };
function bindValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  // SQLite exige memória própria, não um ArrayBufferLike possivelmente compartilhado.
  if (ArrayBuffer.isView(value)) return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  throw new TypeError("Parâmetro SQLite incompatível.");
}
export function sqliteD1(sqlite: DatabaseSync, hooks: Hooks = {}): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      hooks.prepare?.(sql);
      const statement = sqlite.prepare(sql);
      let values: SQLInputValue[] = [];
      const prepared: D1PreparedStatement = {
        bind(...args: unknown[]) { values = args.map(bindValue); return prepared; },
        async first<T = Record<string, unknown>>(): Promise<T | null> {
          const row = statement.get(...values);
          hooks.afterFirst?.(sql);
          // O contrato genérico do D1 deixa a projeção SQL a cargo do chamador.
          return row === undefined ? null : row as T;
        },
        async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
          return { success: true, results: statement.all(...values) as T[] };
        },
        async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
          hooks.beforeRun?.(sql);
          const result = statement.run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
        async raw() { throw Error("raw() não implementado nesta fixture."); }
      };
      return prepared;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results: D1Result<T>[] = [];
        for (const statement of statements) results.push(await statement.run<T>());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
}
// Bindings inexistentes falham explicitamente se uma rota tentar usá-los.
export function testEnv(db: D1Database, secret: string, limiter?: RateLimit): Env {
  const env: Env = {
    DB: db, SESSION_SECRET: secret, REALTIME_MODE: "off",
    REALTIME_HUB: {
      idFromName() { throw Error("Realtime não configurado nesta fixture."); },
      idFromHex() { throw Error("Realtime não configurado nesta fixture."); },
      get() { throw Error("Realtime não configurado nesta fixture."); }
    },
    ASSETS: { async fetch() { throw Error("Assets não configurados nesta fixture."); } },
    LOGIN_RATE_LIMITER: limiter ?? { async limit() { throw Error("Rate limiter não configurado nesta fixture."); } }
  };
  // Reproduz a ausência do binding em testes fail-closed, sem coerção de tipos.
  if (!limiter) Reflect.deleteProperty(env, "LOGIN_RATE_LIMITER");
  return env;
}
export function isStateConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "CONFLITO_ESTADO";
}

export function requiredRow<T>(row: Record<string, unknown> | undefined): T {
  if (!row) throw Error("Registro sintético esperado não encontrado.");
  // Projeção de fixture SQLite: mesma fronteira genérica do D1.first<T>().
  return row as T;
}
