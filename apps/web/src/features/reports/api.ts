import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { getStores } from "@/features/receiving/api";
import { occurrencesSchema, reportParams, reportSchema, type ReportFilters, type OccurrenceType } from "./model";

export { getStores };
export async function getReport(filters: Pick<ReportFilters, "start" | "end" | "stores">) {
  return reportSchema.parse(await apiFetch<unknown>("/api/admin/reports?" + reportParams(filters)));
}
export async function getOccurrences(filters: ReportFilters, offset: number, query: string, type: OccurrenceType = "todos") {
  const params = reportParams(filters);
  params.set("limit", "50");
  params.set("offset", String(offset));
  if (query) params.set("q", query);
  if (type !== "todos") params.set("type", type);
  return occurrencesSchema.parse(await apiFetch<unknown>("/api/admin/reports/occurrences?" + params));
}
export const storeFilterSchema = z.array(z.object({ codigo: z.string(), nome: z.string(), ativo: z.boolean() }));
