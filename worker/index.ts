export { RealtimeHub } from "./realtime/RealtimeHub.ts";
import { app } from "./app.ts";
import { closePastOpenAgendas } from "./services/agenda-maintenance.ts";
import { pruneDiagnostics } from "./repositories/diagnostics.ts";
import { runRetention } from "./services/retention.ts";
import { pruneRevokedSessions } from "./repositories/users.ts";

export default {
  fetch: app.fetch,
  async scheduled(
    controller,
    env,
    _ctx,
  ) {
    try { await closePastOpenAgendas(env.DB, new Date(controller.scheduledTime)); }
    catch { console.error("Scheduled agenda maintenance failed"); }
    try { await pruneDiagnostics(env.DB, new Date(controller.scheduledTime)); }
    catch { console.warn("Scheduled diagnostics retention unavailable"); }
    try { await pruneRevokedSessions(env.DB, Math.floor(controller.scheduledTime / 1000)); }
    catch { console.warn("Scheduled session cleanup unavailable"); }
    try {
      const limiteConfigurado = Number(env.RETENTION_ROW_LIMIT_WARNING);
      const rowWarningThreshold = Number.isFinite(limiteConfigurado) && limiteConfigurado > 0
        ? limiteConfigurado
        : undefined;
      const resumo = await runRetention(env.DB, env.RETENTION_BUCKET ?? null, {
        now: new Date(controller.scheduledTime),
        ...(rowWarningThreshold ? { rowWarningThreshold } : {})
      });
      console.log(JSON.stringify({
        event: "retention_summary",
        runId: resumo.runId,
        exportacaoPulada: resumo.exportacaoPulada,
        totalLinhas: resumo.totalLinhas
      }));
    } catch (error) {
      console.error("Scheduled retention failed", {
        message: error instanceof Error ? error.message : "Erro desconhecido."
      });
    }
  },
};