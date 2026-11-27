import { z } from "zod";
import { AGENDA_DOCUMENT_TYPES } from "../../shared/agenda.ts";
import { normalizeStoreCode } from "../../shared/store.ts";

const SourceRow = z.object({
  protocolo: z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string()]),
  data_agenda_inicio: z.string().trim(),
  hora_agendada: z.string().trim(),
  filial_entrega: z.string().trim().min(1).max(200),
  fornecedor: z.string().trim().min(1).max(200),
  tipo: z.string().trim(),
  nfe_numeros: z.string().trim(),
  numero_pedido: z.string().trim(),
});
type DocumentType = typeof AGENDA_DOCUMENT_TYPES[number];
export interface NexelloAppointment {
  protocol: string;
  date: string;
  startTime: string;
  endTime: string;
  // Null means the source has no unambiguous store code; never guess a dock.
  storeCode: string | null;
  supplier: string;
  type: DocumentType;
  nfe: string[];
  orders: string[];
}
export const NEXELLO_UNAVAILABLE_FIELDS = ["items", "volumes", "pallets", "cargaBatida", "csvFields"] as const;

export class NexelloNormalizationError extends Error {
  constructor(readonly field: string) {
    super("Campo Nexello inválido: " + field);
    this.name = "NexelloNormalizationError";
  }
}

function dateFromSource(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) throw new NexelloNormalizationError("data_agenda_inicio");
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new NexelloNormalizationError("data_agenda_inicio");
  }
  return date.toISOString().slice(0, 10);
}

function parseRange(value: string): { startTime: string; endTime: string } {
  const match = /^((?:[01]\d|2[0-3]):[0-5]\d)\s*-\s*((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  const startTime = match?.[1], endTime = match?.[2];
  if (!startTime || !endTime || startTime >= endTime) throw new NexelloNormalizationError("hora_agendada");
  return { startTime, endTime };
}

function documents(value: string, field: string): string[] {
  if (!value || value === "-") return [];
  if (!/^\d{1,80}(?:\s*,\s*\d{1,80})*$/.test(value)) throw new NexelloNormalizationError(field);
  const result = [...new Set(value.split(",").map(part => part.trim()))];
  if (result.length > 100) throw new NexelloNormalizationError(field);
  return result;
}

/** Read-only normalization: absent quantities and raw CSV fields are intentionally
 * omitted, not converted to null. This object must not be used for a full replace. */
export function normalizeNexelloAppointment(raw: unknown): NexelloAppointment {
  const parsed = SourceRow.safeParse(raw);
  if (!parsed.success) throw new NexelloNormalizationError("registro");
  const row = parsed.data;
  const protocol = String(row.protocolo).trim();
  if (!/^\d{6,20}$/.test(protocol)) throw new NexelloNormalizationError("protocolo");
  const type = AGENDA_DOCUMENT_TYPES.find(value => value.toLowerCase() === row.tipo.toLowerCase());
  if (!type) throw new NexelloNormalizationError("tipo");
  const storeMatch = /^(F\d{1,3})\s*-\s*\S.*$/i.exec(row.filial_entrega);
  const code = storeMatch?.[1];
  return {
    protocol,
    date: dateFromSource(row.data_agenda_inicio),
    ...parseRange(row.hora_agendada),
    storeCode: code ? normalizeStoreCode(code) : null,
    supplier: row.fornecedor.replace(/\s+/g, " "),
    type,
    nfe: documents(row.nfe_numeros, "nfe_numeros"),
    orders: documents(row.numero_pedido, "numero_pedido"),
  };
}
