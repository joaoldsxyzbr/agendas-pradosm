import { ImportAgendaBatchInput } from "../agenda.ts";

// Erros de importacao com contexto. O schema zod em shared/agenda.ts e a fonte
// unica dos limites aceitos pelo servidor: a previa do React e a resposta 400 do
// Worker usam este modulo para nomear protocolo, loja e campo do problema,
// em vez de um "Dados do lote de agendas invalidos" sem pista do registro.
export type ImportBatchIssue = {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
};

const FIELD_LABELS: Record<string, string> = {
  protocol: "Protocolo",
  startTime: "Horário",
  endTime: "Horário",
  supplier: "Fornecedor",
  items: "Itens",
  volumes: "Volumes",
  pallets: "Paletes",
  cargaBatida: "Carga batida",
  type: "Tipo",
  nfe: "N° NFe",
  orders: "Pedidos",
  csvFields: "Campos do CSV",
  storeCode: "Loja",
  date: "Data",
  originalFileName: "Nome do arquivo",
  appointments: "Agendamentos"
};

const fieldLabel = (key: PropertyKey | undefined): string => {
  if (typeof key !== "string" || !key) return "";
  return FIELD_LABELS[key] ?? key;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const displayDate = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "data não identificada";
  const [year = "", month = "", day = ""] = value.split("-");
  return `${day}/${month}/${year}`;
};

function agendaAt(payload: unknown, agendaIndex: PropertyKey | undefined): Record<string, unknown> {
  if (typeof agendaIndex !== "number") return {};
  const agendas = asRecord(payload).agendas;
  if (!Array.isArray(agendas)) return {};
  return asRecord(agendas[agendaIndex]);
}

function agendaContext(agenda: Record<string, unknown>): string {
  const storeCode = typeof agenda.storeCode === "string" && agenda.storeCode
    ? agenda.storeCode
    : "loja não identificada";
  return `${storeCode}, ${displayDate(agenda.date)}`;
}

function appointmentContext(
  payload: unknown,
  agendaIndex: PropertyKey | undefined,
  appointmentIndex: PropertyKey | undefined
): { agenda: string; protocol: string } {
  const agenda = agendaAt(payload, agendaIndex);
  let protocol = "sem protocolo";
  if (typeof appointmentIndex === "number" && Array.isArray(agenda.appointments)) {
    const appointment = asRecord(agenda.appointments[appointmentIndex]);
    if (typeof appointment.protocol === "string" && appointment.protocol) {
      protocol = appointment.protocol;
    }
  }
  return { agenda: agendaContext(agenda), protocol };
}

// Formata issues do schema do lote em mensagens prontas para exibicao:
// "REGISTRO_INVALIDO:<protocolo> (<loja>, <data>, <campo>) <mensagem>".
export function formatImportBatchIssues(
  issues: ReadonlyArray<ImportBatchIssue>,
  payload: unknown,
  maxIssues = 20
): string[] {
  const labels: string[] = [];
  for (const issue of issues.slice(0, maxIssues)) {
    const [agendasKey, agendaIndex, thirdKey, appointmentIndex, ...fieldPath] = issue.path;
    if (agendasKey === "agendas" && thirdKey === "appointments" && typeof appointmentIndex === "number") {
      const context = appointmentContext(payload, agendaIndex, appointmentIndex);
      const fields = fieldPath.map((key) => fieldLabel(key)).filter(Boolean).join(" ");
      labels.push(`REGISTRO_INVALIDO:${context.protocol} (${context.agenda}${fields ? `, ${fields}` : ""}) ${issue.message}`);
      continue;
    }
    if (agendasKey === "agendas" && typeof agendaIndex === "number") {
      const context = agendaContext(agendaAt(payload, agendaIndex));
      const field = fieldLabel(thirdKey);
      labels.push(`AGENDA_INVALIDA:${context}${field ? ` (${field})` : ""} ${issue.message}`);
      continue;
    }
    labels.push(`LOTE_INVALIDO:${issue.message}`);
  }
  if (issues.length > maxIssues) {
    labels.push(`LOTE_INVALIDO:${issues.length - maxIssues} outros problemas não listados.`);
  }
  return [...new Set(labels)];
}

// Executa o mesmo schema do endpoint /api/admin/agendas/import/bulk sobre o
// payload que seria enviado e devolve os erros formatados para a previa.
export function validateImportBatchPayload(payload: unknown): string[] {
  const parsed = ImportAgendaBatchInput.safeParse(payload);
  if (parsed.success) return [];
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path,
    message: String(issue.message)
  }));
  return formatImportBatchIssues(issues, payload);
}
