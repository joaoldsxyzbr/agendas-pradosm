import assert from "node:assert/strict";
import type { AgendaDetailRow, AppointmentRow } from "../../worker/repositories/agendas.ts";

export interface RecordedStatement extends D1PreparedStatement {
  sql: string;
  params: unknown[];
  values: unknown[];
}
interface Options {
  first?: (sql: string, values: unknown[]) => unknown;
  all?: (sql: string, values: unknown[]) => unknown[];
  changes?: (sql: string, values: unknown[]) => number;
  batch?: (statements: RecordedStatement[]) => number;
  arity?: boolean;
}
export function recordingD1(options: Options = {}) {
  const calls: RecordedStatement[] = [];
  const statements: RecordedStatement[] = [];
  const batches: RecordedStatement[][] = [];
  const db: D1Database = {
    prepare(sql) {
      const statement: RecordedStatement = {
        sql, params: [], values: [],
        bind(...values: unknown[]) {
          if (options.arity) assert.equal(values.length, (sql.match(/\?/g) ?? []).length, "Bind incompatível: " + sql);
          statement.params = values;
          statement.values = values;
          if (options.arity) statements.push(statement);
          return statement;
        },
        async first<T = Record<string, unknown>>() {
          return (options.first?.(sql, statement.params) ?? null) as T | null;
        },
        async all<T = Record<string, unknown>>() {
          return { success: true, results: (options.all?.(sql, statement.params) ?? []) as T[] };
        },
        async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
          return { success: true, meta: { changes: options.changes?.(sql, statement.params) ?? 1 } };
        },
        async raw() { throw Error("raw inesperado no mock SQL"); }
      };
      calls.push(statement);
      if (!options.arity) statements.push(statement);
      return statement;
    },
    async batch<T = unknown>(operations: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const recorded = operations.map(operation => {
        const found = calls.find(call => call === operation);
        assert.ok(found, "Statement não registrado neste banco");
        return found;
      });
      batches.push(recorded);
      const changes = options.batch?.(recorded) ?? 1;
      return recorded.map(() => ({ success: true, meta: { changes } }));
    }
  };
  return Object.assign(db, { calls, statements, batches });
}
export function agendaFixture(overrides: Partial<AgendaDetailRow> = {}): AgendaDetailRow {
  return {
    id: "agenda1", loja_id: "loja1", data_agenda: "2026-11-03", arquivo_original: "fixture.csv",
    criado_por: "admin1", status_dia: "aberto", concluido_em: null, concluido_por: null,
    digitado_em: null, digitado_por: null, criado_em: "t0", atualizado_em: "t0",
    store_code: "F01", store_name: "Loja 01", concluido_por_nome: null, ...overrides
  };
}
export function appointmentFixture(overrides: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    id: "appt1", agenda_id: "agenda1", protocolo: "123456", horario_inicio: "08:00", horario_fim: "09:00",
    fornecedor: "Fornecedor sintético", itens: null, volumes: null, paletes: null, carga_batida: null,
    tipo: "Pedido", nfe: "[]", pedidos: "[]", status: "aguardando", trocas: 0, observacao: null,
    origem: "importado", ativo: 1, criado_em: "t0", atualizado_em: "t0", csv_campos: null, ...overrides
  };
}
