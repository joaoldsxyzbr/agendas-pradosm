export { RealtimeHub } from "./realtime/RealtimeHub.ts";
import type { Env } from "./env.ts";
import { app } from "./app.ts";
import { closePastOpenAgendas } from "./services/agenda-maintenance.ts";
import { pruneDiagnostics } from "./repositories/diagnostics.ts";
import { pruneExpiredNexelloReviews } from "./repositories/nexello-persistence.ts";
import { runRetention } from "./services/retention.ts";
import { pruneRevokedSessions } from "./repositories/users.ts";

export default {
  fetch: app.fetch,
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    try { await closePastOpenAgendas(env.DB, new Date(controller.scheduledTime)); }
    catch { console.error("Scheduled agenda maintenance failed"); }
    try { await pruneDiagnostics(env.DB, new Date(controller.scheduledTime)); }
    catch { console.warn("Scheduled diagnostics retention unavailable"); }
    try { await pruneExpiredNexelloReviews(env.DB, new Date(controller.scheduledTime)); }
    catch { console.warn("Scheduled Nexello review cleanup unavailable"); }
    try { await pruneRevokedSessions(env.DB, Math.floor(controller.scheduledTime / 1000)); }
    catch { console.warn("Scheduled session cleanup unavailable"); }
    try {
      const limiteConfigurado = Number(env.RETENTION_ROW_LIMIT_WARNING);
      const rowWarningThreshold = Number.isSafeInteger(limiteConfigurado) && limiteConfigurado > 0
        ? limiteConfigurado
        : undefined;
      const resumo = await runRetention(env.DB, {
        now: new Date(controller.scheduledTime),
        ...(rowWarningThreshold ? { rowWarningThreshold } : {})
      });
      console.log(JSON.stringify({
        event: "retention_summary",
        runId: resumo.runId,
        exportacaoPulada: resumo.exportacaoPulada,
        totalLinhas: resumo.totalLinhas,
        alertaTamanhoBanco: resumo.alertaTamanhoBanco
      }));
    } catch {
      console.error("Scheduled retention monitoring failed");
    }
  },
};