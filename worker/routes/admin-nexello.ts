import { Hono } from "hono";
import type { AppEnv, Env } from "../env.ts";
import { readNexelloReportPage, NexelloReportError } from "../services/nexello-report.ts";
import { normalizeNexelloAppointment, NexelloNormalizationError } from "../services/nexello-agenda.ts";
import type { NexelloPreviewPage, NexelloPreviewRow } from "../../shared/nexello-preview.ts";

const MAX_PAGES = 15;
const PAGE_SIZE = 100;

export async function getNexelloPreviewPage(token: string, page: number, fetcher: typeof fetch = fetch): Promise<NexelloPreviewPage> {
  const result = await readNexelloReportPage(token, 60, page, PAGE_SIZE, fetcher);
  if (result.last_page > MAX_PAGES) throw new NexelloReportError("RESPOSTA_GRANDE");
  const rows: NexelloPreviewRow[] = result.data.map((raw, i) => {
    try {
      const row = normalizeNexelloAppointment(raw);
      return { index: i + 1, kind: "observed", protocol: row.protocol, date: row.date,
        startTime: row.startTime, endTime: row.endTime, storeCode: row.storeCode,
        supplier: row.supplier, type: row.type, nfe: row.nfe, orders: row.orders, externalState: "unknown" };
    } catch (error: unknown) {
      if (!(error instanceof NexelloNormalizationError)) throw error;
      return { index: i + 1, kind: "invalid", field: error.field };
    }
  });
  return { page, lastPage: result.last_page, total: result.total, rows, readOnly: true };
}

function available(env: Env): boolean {
  return env.NEXELLO_READ_MODE === "on" && Boolean(env.NEXELLO_API_TOKEN?.trim()) && Boolean(env.NEXELLO_RATE_LIMITER);
}

export const adminNexelloRoutes = new Hono<AppEnv>();
// A consulta 60 não tem filtro por loja no servidor. Não expor dados globais
// a contas delegadas, ainda que tenham permissão de importar arquivos.
adminNexelloRoutes.use("*", async (c, next) => {
  const user = c.get("authUser");
  if (!user || user.papel !== "admin" || c.get("effectiveAccess")?.customized) {
    return c.json({ error: "ACESSO_NEGADO", message: "Consulta exclusiva do administrador integral." }, 403);
  }
  c.header("Cache-Control", "no-store");
  await next();
});
adminNexelloRoutes.get("/config", c => c.json({ available: available(c.env), readOnly: true }));
adminNexelloRoutes.post("/pages/:page", async c => {
  const raw = c.req.param("page");
  if (!/^[1-9]\d?$/.test(raw) || Number(raw) > MAX_PAGES) {
    return c.json({ error: "PAGINA_INVALIDA", message: "Página fora do limite de consulta." }, 400);
  }
  const token = c.env.NEXELLO_API_TOKEN;
  const limiter = c.env.NEXELLO_RATE_LIMITER;
  if (!available(c.env) || !token || !limiter) {
    return c.json({ error: "NEXELLO_INDISPONIVEL", message: "Integração de leitura ainda não habilitada." }, 503);
  }
  try {
    const limit = await limiter.limit({ key: "nexello-report-60" });
    if (!limit.success) return c.json({ error: "NEXELLO_LIMITE", message: "Limite de consultas atingido. Tente novamente mais tarde." }, 429);
    return c.json(await getNexelloPreviewPage(token, Number(raw)));
  } catch (error: unknown) {
    if (error instanceof NexelloReportError && error.status === 429) {
      return c.json({ error: "NEXELLO_LIMITE", message: "A Nexello limitou as consultas. Tente novamente mais tarde." }, 429);
    }
    return c.json({ error: "NEXELLO_CONSULTA_FALHOU", message: "Não foi possível obter uma página válida da Nexello." }, 502);
  }
});
