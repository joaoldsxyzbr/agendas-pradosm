export interface ReportSelection {
  start: string;
  end: string;
  storeCodes: readonly string[];
}

// O escopo efetivo vem da sessão, nunca dos filtros enviados pelo cliente.
// undefined representa acesso global; [] representa nenhum destino autorizado.
export function storeFilter({ start, end, storeCodes }: ReportSelection, storeIds?: readonly string[]) {
  const codes = [...new Set(storeCodes.map(code => code.toLocaleUpperCase("pt-BR")))];
  const where = ["a.data_agenda BETWEEN ? AND ?"];
  if (codes.length === 1) where.push("AND l.codigo = ? COLLATE NOCASE");
  else if (codes.length > 1) where.push("AND l.codigo COLLATE NOCASE IN (" + codes.map(() => "?").join(",") + ")");
  if (storeIds !== undefined) where.push("AND a.loja_id IN (SELECT value FROM json_each(?))");
  return { where: where.join(" "), args: [start, end, ...codes, ...(storeIds === undefined ? [] : [JSON.stringify(storeIds)])], codes };
}

export const OCCURRENCE_TYPES = ["todos", "nao_compareceu", "nao_recebido", "recusado"] as const;
export type OccurrenceType = typeof OCCURRENCE_TYPES[number];

// Os mesmos predicados alimentam resumo, ranking e detalhamento.
export const absence = "((ag.status = 'aguardando' AND a.status_dia = 'concluido') OR (ag.status = 'nao_chegou' AND ag.observacao = 'Não compareceu'))";
export const notReceived = "(ag.status = 'nao_chegou' AND COALESCE(ag.observacao, '') <> 'Não compareceu')";
export const refused = "(ag.status = 'recusado')";
const conditions: Record<OccurrenceType, string> = {
  todos: `(${absence} OR ${notReceived} OR ${refused})`,
  nao_compareceu: absence,
  nao_recebido: notReceived,
  recusado: refused,
};
export function occurrenceCondition(type: OccurrenceType): string {
  return conditions[type];
}

// Substring literal. Não interpretar % / _ / barra como padrões LIKE.
export function occurrenceSearch(q?: string) {
  return q ? {
    clause: " AND (instr(lower(ag.fornecedor), lower(?)) > 0 OR instr(lower(ag.protocolo), lower(?)) > 0)",
    args: [q, q],
  } : { clause: "", args: [] };
}
