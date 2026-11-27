// V2: monitoramento de volume e idade. Sem R2 e sem exclusão de registros
// operacionais/auditoria. A idade sinaliza revisão, não autoriza purga.
const DAY_MS = 86400000;
const DEFAULT_WARNING = 500000;
const HISTORY = [
  { tabela: "historico_status", colunaTempo: "alterado_em", retencaoDias: 365 },
  { tabela: "historico_agenda", colunaTempo: "alterado_em", retencaoDias: 365 },
  { tabela: "auditoria", colunaTempo: "criado_em", retencaoDias: 730 },
] as const;
const VOLUME_TABLES = [
  "agendamentos","historico_status","historico_agenda","auditoria",
  "agenda_digitacao_fornecedor","diagnosticos",
] as const;
type VolumeTable = typeof VOLUME_TABLES[number];
function cutoff(now: Date, days: number): string {
  return new Date(now.getTime()-days*DAY_MS).toISOString();
}
function count(value: unknown): number {
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0)throw new Error("RETENCAO_CONTAGEM_INVALIDA");
  return value;
}
export async function retentionStatus(db: D1Database, now = new Date()) {
  const tabelas = await Promise.all(HISTORY.map(async spec=>{
    const corte=cutoff(now,spec.retencaoDias);
    const row=await db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN ${spec.colunaTempo} < ? THEN 1 ELSE 0 END),0) AS expiradas FROM ${spec.tabela}`)
      .bind(corte).first<{total:number;expiradas:number}>();
    return {...spec,corte,total:count(row?.total),expiradas:count(row?.expiradas)};
  }));
  return {geradoEm:now.toISOString(),tabelas};
}
export async function runRetention(db: D1Database, options: {now?:Date;runId?:string;rowWarningThreshold?:number}={}) {
  const now=options.now??new Date();
  const runId=options.runId??crypto.randomUUID();
  const threshold=options.rowWarningThreshold??DEFAULT_WARNING;
  if(!Number.isSafeInteger(threshold)||threshold<1)throw new Error("RETENCAO_LIMITE_INVALIDO");
  const status=await retentionStatus(db,now);
  const contagemTabelas: Partial<Record<VolumeTable,number>>={};
  for(const row of status.tabelas)contagemTabelas[row.tabela]=row.total;
  for(const table of VOLUME_TABLES){
    if(contagemTabelas[table]!==undefined)continue;
    const row=await db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{total:number}>();
    contagemTabelas[table]=count(row?.total);
  }
  const totalLinhas=Object.values(contagemTabelas).reduce((sum,n)=>sum+n,0);
  const tabelas=status.tabelas.map(row=>({
    tabela:row.tabela,corte:row.corte,exportados:0,purgados:0,lotes:0,pendentes:row.expiradas,
    ...(row.expiradas?{motivo:"PRESERVACAO_SEM_ARQUIVAMENTO"}:{})
  }));
  return {runId,executadoEm:now.toISOString(),tabelas,exportacaoPulada:tabelas.some(row=>row.pendentes>0),
    totalLinhas,contagemTabelas,alertaTamanhoBanco:totalLinhas>=threshold?{nivel:"warning",totalLinhas,limite:threshold}:null};
}
