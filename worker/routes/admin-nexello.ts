import { Hono } from "hono";
import { reserveNexelloRequest } from "../repositories/nexello-rate.ts";
import { compareNexelloPage } from "../services/nexello-comparison.ts";
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
  return env.NEXELLO_READ_MODE === "on" && Boolean(env.NEXELLO_API_TOKEN?.trim());
}

export const adminNexelloRoutes = new Hono<AppEnv>();
// A consulta 60 não filtra por loja. Apenas administrador integral e Digitador
// com escopo global e permissões de importação podem consultar.
adminNexelloRoutes.use("*", async (c, next) => {
  const user = c.get("authUser");
  const access = c.get("effectiveAccess");
  const integral = user?.papel === "admin" && !access?.customized;
  const digitador = access?.customized === true && access.profile === "digitador" &&
    access.scope.mode === "all" && access.permissions.has("importacao.ver") && access.permissions.has("importacao.executar");
  if (!user || (!integral && !digitador)) {
    return c.json({ error: "ACESSO_NEGADO", message: "Consulta exclusiva do administrador integral ou Digitador com acesso a todas as lojas." }, 403);
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
  if (!available(c.env) || !token) {
    return c.json({ error: "NEXELLO_INDISPONIVEL", message: "Integração de leitura ainda não habilitada." }, 503);
  }
  try {
    if (!await reserveNexelloRequest(c.env.DB)) {
      c.header("Retry-After", "4");
      return c.json({ error: "NEXELLO_LIMITE", message: "Outra consulta está em andamento ou foi iniciada recentemente. Aguarde alguns segundos." }, 429);
    }
    const page = await getNexelloPreviewPage(token, Number(raw));
    return c.json(await compareNexelloPage(c.env.DB, page));
  } catch (error: unknown) {
    if (error instanceof NexelloReportError && error.status === 429) {
      return c.json({ error: "NEXELLO_LIMITE", message: "A Nexello limitou as consultas. Tente novamente mais tarde." }, 429);
    }
    return c.json({ error: "NEXELLO_CONSULTA_FALHOU", message: "Não foi possível obter uma página válida da Nexello." }, 502);
  }
});
