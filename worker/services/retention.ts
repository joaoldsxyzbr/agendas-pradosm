// Retenção de dados operacionais antigos.
// Regras: historico_status e historico_agenda com mais de 12 meses;
// auditoria com mais de 24 meses. Diagnósticos seguem o pruneDiagnostics (30 dias).
//
// Históricos e auditoria são permanentes. A rotina apenas mede e alerta;
// diagnósticos e sessões expiradas têm limpeza independente.

const DAY_MS = 86400000;
const HISTORICO_RETENCAO_DIAS = 365;
const AUDITORIA_RETENCAO_DIAS = 730;
const LIMITE_ALERTA_LINHAS_PADRAO = 500000;

const TABELAS_RETENCAO = [
  { tabela: "historico_status", colunaTempo: "alterado_em", retencaoDias: HISTORICO_RETENCAO_DIAS },
  { tabela: "historico_agenda", colunaTempo: "alterado_em", retencaoDias: HISTORICO_RETENCAO_DIAS },
  { tabela: "auditoria", colunaTempo: "criado_em", retencaoDias: AUDITORIA_RETENCAO_DIAS }
];

// Tabelas de maior volume: base da contagem aproximada para o alerta de tamanho.
const TABELAS_CONTAGEM = [
  "agendamentos",
  "historico_status",
  "historico_agenda",
  "auditoria",
  "agenda_digitacao_fornecedor",
  "diagnosticos",
  "avisos",
  "avisos_lidos",
  "avisos_lojas",
  "avisos_reacoes"
];

function cortePara(now: Date, dias: number) {
  return new Date(now.getTime() - dias * DAY_MS).toISOString();
}

async function contar(db: D1Database, sql: string, valores: string[] = []) {
  const row = await db.prepare(sql).bind(...valores).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

export async function retentionStatus(db: D1Database) {
  const agora = new Date();
  const tabelas = [];
  for (const spec of TABELAS_RETENCAO) {
    const corte = cortePara(agora, spec.retencaoDias);
    const total = await contar(db, `SELECT COUNT(*) AS total FROM ${spec.tabela}`);
    const expiradas = await contar(
      db,
      `SELECT COUNT(*) AS total FROM ${spec.tabela} WHERE ${spec.colunaTempo} < ?`,
      [corte]
    );
    tabelas.push({
      tabela: spec.tabela,
      colunaTempo: spec.colunaTempo,
      retencaoDias: spec.retencaoDias,
      corte,
      total,
      expiradas
    });
  }
  return { geradoEm: agora.toISOString(), tabelas };
}

export async function runRetention(
  db: D1Database,
  options: { now?: Date; runId?: string; rowWarningThreshold?: number } = {}
) {
  const agora = options.now ?? new Date();
  const runId = options.runId ?? crypto.randomUUID();
  const limiteAlertaLinhas = options.rowWarningThreshold ?? LIMITE_ALERTA_LINHAS_PADRAO;
  const resumo: {
    runId: string; executadoEm: string; tabelas: Array<{ tabela: string; corte: string; exportados: number; purgados: number; lotes: number; pendentes: number; motivo?: string }>;
    exportacaoPulada: boolean; totalLinhas: number; contagemTabelas: Record<string, number>;
    alertaTamanhoBanco: { nivel: string; totalLinhas: number; limite: number } | null;
  } = {
    runId,
    executadoEm: agora.toISOString(),
    tabelas: [],
    exportacaoPulada: false,
    totalLinhas: 0,
    contagemTabelas: {},
    alertaTamanhoBanco: null
  };

  for (const spec of TABELAS_RETENCAO) {
    const corte = cortePara(agora, spec.retencaoDias);
    const expiradas = await contar(
      db,
      `SELECT COUNT(*) AS total FROM ${spec.tabela} WHERE ${spec.colunaTempo} < ?`,
      [corte]
    );
    if (!expiradas) {
      resumo.tabelas.push({
        tabela: spec.tabela, corte, exportados: 0, purgados: 0, lotes: 0, pendentes: 0
      });
      continue;
    }
    resumo.exportacaoPulada = true;
    resumo.tabelas.push({
      tabela: spec.tabela, corte, exportados: 0, purgados: 0, lotes: 0,
      pendentes: expiradas, motivo: "PRESERVACAO_HISTORICO"
    });
  }

  if (resumo.exportacaoPulada) {
    console.log(JSON.stringify({ event: "retention_history_preserved", runId }));
  }

  let total = 0;
  for (const tabela of TABELAS_CONTAGEM) {
    const quantidade = await contar(db, `SELECT COUNT(*) AS total FROM ${tabela}`);
    resumo.contagemTabelas[tabela] = quantidade;
    total += quantidade;
  }
  resumo.totalLinhas = total;
  if (total >= limiteAlertaLinhas) {
    resumo.alertaTamanhoBanco = {
      nivel: "warning",
      totalLinhas: total,
      limite: limiteAlertaLinhas
    };
    console.error(JSON.stringify({
      event: "db_size_warning", runId, totalLinhas: total,
      limite: limiteAlertaLinhas, tabelas: resumo.contagemTabelas
    }));
  } else {
    console.log(JSON.stringify({
      event: "db_size_report", runId, totalLinhas: total,
      tabelas: resumo.contagemTabelas
    }));
  }
  return resumo;
}
