import { z } from "zod";

const BASE_URL = "https://integracao-organiza.nexello.com.br/integracao/api/v2/relatorio-personalizado/";
const MAX_RESPONSE_BYTES = 1_048_576;
const TIMEOUT_MS = 15_000;

const PositiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ReportPage = z.object({
  data: z.array(z.record(z.string(), z.unknown())).max(100),
  page: PositiveInteger,
  per_page: PositiveInteger.max(100),
  last_page: PositiveInteger,
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export type NexelloReportPage = z.infer<typeof ReportPage>;
type ErrorCode = "CONFIG_INVALIDA" | "CONSULTA_INVALIDA" | "HTTP" |
  "TRANSPORTE" | "RESPOSTA_INVALIDA" | "RESPOSTA_GRANDE";

export class NexelloReportError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  constructor(code: ErrorCode, status?: number) {
    super("Consulta Nexello: " + code + (status === undefined ? "" : " (" + status + ")"));
    this.name = "NexelloReportError";
    this.code = code;
    this.status = status;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new NexelloReportError("RESPOSTA_INVALIDA");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new NexelloReportError("RESPOSTA_GRANDE");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (text.includes("\uFFFD")) throw new NexelloReportError("RESPOSTA_INVALIDA");
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    if (error instanceof NexelloReportError) throw error;
    throw new NexelloReportError("RESPOSTA_INVALIDA");
  } finally {
    try { await reader.cancel(); } catch { /* Never expose upstream errors. */ }
    reader.releaseLock();
  }
}

/**
 * Read a single documented report page. No storage, filtering assumptions,
 * pagination loop, logging or external writes. Caller must validate the report
 * contract and completeness before using any rows for import.
 */
export async function readNexelloReportPage(
  token: string,
  reportId: number,
  page: number,
  limit: number,
  fetcher: typeof fetch = fetch,
): Promise<NexelloReportPage> {
  if (!token.trim() || /[\r\n]/.test(token)) throw new NexelloReportError("CONFIG_INVALIDA");
  if (!Number.isSafeInteger(reportId) || reportId < 1 ||
      !Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new NexelloReportError("CONSULTA_INVALIDA");
  }
  const url = new URL(String(reportId), BASE_URL);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("page", String(page));
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { Authorization: "Bearer " + token.trim(), Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new NexelloReportError("TRANSPORTE");
  }
  if (!response.ok) {
    try { await response.body?.cancel(); } catch { /* No upstream body in errors. */ }
    throw new NexelloReportError("HTTP", response.status);
  }
  const parsed = ReportPage.safeParse(await readJson(response));
  if (!parsed.success) throw new NexelloReportError("RESPOSTA_INVALIDA");
  const result = parsed.data;
  if (result.page !== page || result.per_page !== limit ||
      result.last_page !== Math.max(1, Math.ceil(result.total / limit)) ||
      page > result.last_page ||
      result.data.length !== Math.min(limit, Math.max(0, result.total - (page - 1) * limit))) {
    throw new NexelloReportError("RESPOSTA_INVALIDA");
  }
  return result;
}
