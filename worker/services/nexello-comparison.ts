import type { NexelloPreviewPage, NexelloPreviewRow, NexelloComparison } from "../../shared/nexello-preview.ts";
import { normalizeStoreCode } from "../../shared/store.ts";

type Observed = Extract<NexelloPreviewRow, { kind: "observed" }>;
export interface ComparisonLocalRow {
  protocolo: string;
  data_agenda: string;
  codigo: string;
  horario_inicio: string;
  horario_fim: string;
  fornecedor: string;
  tipo: string | null;
  nfe: string;
  pedidos: string;
  origem: string;
  ativo: number;
  status: string;
  status_dia: string;
  digitacao_protegida: number;
}
function documentKey(values: readonly string[]): string {
  return JSON.stringify([...new Set(values)].sort());
}
function localDocumentKey(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((v: unknown) => typeof v === "string") ? documentKey(parsed) : null;
  } catch { return null; }
}
function sourceKey(row: Observed): string {
  return JSON.stringify([row.date,row.storeCode,row.startTime,row.endTime,row.supplier,row.type,documentKey(row.nfe),documentKey(row.orders)]);
}
function matches(row: Observed, local: ComparisonLocalRow): boolean {
  return row.date === local.data_agenda && row.storeCode === normalizeStoreCode(local.codigo) &&
    row.startTime === local.horario_inicio && row.endTime === local.horario_fim &&
    row.supplier === local.fornecedor.replace(/\s+/g," ").trim() && row.type === local.tipo &&
    documentKey(row.nfe) === localDocumentKey(local.nfe) && documentKey(row.orders) === localDocumentKey(local.pedidos);
}
/** Comparison of a single page, not a lifecycle decision or proof of identity. */
export function compareObservedRows(rows: readonly NexelloPreviewRow[], local: readonly ComparisonLocalRow[]): NexelloPreviewRow[] {
  const fingerprints = new Map<string, Set<string>>();
  const byProtocol = new Map<string, ComparisonLocalRow[]>();
  for (const row of rows) if (row.kind === "observed") {
    const set = fingerprints.get(row.protocol) ?? new Set<string>();
    set.add(sourceKey(row));
    fingerprints.set(row.protocol,set);
  }
  for (const row of local) {
    const list = byProtocol.get(row.protocolo) ?? [];
    list.push(row);
    byProtocol.set(row.protocolo,list);
  }
  return rows.map(row => {
    if (row.kind !== "observed") return row;
    const candidates = byProtocol.get(row.protocol) ?? [];
    const candidate = candidates[0];
    let comparison: NexelloComparison;
    if ((fingerprints.get(row.protocol)?.size ?? 0) > 1) comparison = "duplicate_conflict";
    else if (row.storeCode === null) comparison = "unresolved_store";
    else if (candidates.length > 1) comparison = "multiple_local";
    else if (!candidate) comparison = "not_found";
    else if (candidate.origem !== "importado" || candidate.ativo !== 1 ||
      candidate.status !== "aguardando" || candidate.status_dia !== "aberto" || candidate.digitacao_protegida !== 0) comparison = "protected_local";
    else comparison = matches(row,candidate) ? "same_fields" : "different_fields";
    return { ...row, comparison };
  });
}
interface MappingRow {filial_externa:string;codigo:string;ativo:number;excluido_em:string|null;}
export function annotateDestinations(rows:readonly NexelloPreviewRow[],mappings:readonly MappingRow[]):NexelloPreviewRow[]{
  const byCode=new Map(mappings.map(row=>[row.filial_externa,row]));
  return rows.map(row=>{
    if(row.kind!=="observed")return row;
    if(!row.storeCode)return {...row,destination:"unresolved"};
    const mapping=byCode.get(row.storeCode);
    if(!mapping)return {...row,destination:"unlinked"};
    return {...row,destination:mapping.ativo===1&&mapping.excluido_em===null&&mapping.codigo===row.storeCode?"linked":"inactive",destinationCode:mapping.codigo};
  });
}
/** Two bounded read queries, at most 100 bind parameters each; no partial results. */
export async function compareNexelloPage(db: D1Database, page: NexelloPreviewPage): Promise<NexelloPreviewPage> {
  const protocols = [...new Set(page.rows.flatMap(row => row.kind === "observed" ? [row.protocol] : []))];
  if (!protocols.length) return page;
  if (protocols.length > 100) throw new Error("NEXELLO_COMPARACAO_LIMITE");
  const result = await db.prepare(`
    SELECT p.protocolo,a.data_agenda,l.codigo,p.horario_inicio,p.horario_fim,
      p.fornecedor,p.tipo,p.nfe,p.pedidos,p.origem,p.ativo,p.status,a.status_dia,
      CASE WHEN a.digitado_em IS NOT NULL OR EXISTS (
        SELECT 1 FROM agenda_digitacao_fornecedor d WHERE d.agenda_id=a.id AND d.digitado_em IS NOT NULL
      ) THEN 1 ELSE 0 END AS digitacao_protegida
    FROM agendamentos p JOIN agendas a ON a.id=p.agenda_id JOIN lojas l ON l.id=a.loja_id
    WHERE p.protocolo IN (${protocols.map(() => "?").join(",")})
    LIMIT 501
  `).bind(...protocols).all<ComparisonLocalRow>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > 500) throw new Error("NEXELLO_COMPARACAO_LIMITE");
  const codes=[...new Set(page.rows.flatMap(row=>row.kind==="observed"&&row.storeCode?[row.storeCode]:[]))];
  let mappings:MappingRow[]=[];
  if(codes.length){
    const mapped=await db.prepare("SELECT d.filial_externa,l.codigo,l.ativo,l.excluido_em FROM nexello_destinos d JOIN lojas l ON l.id=d.loja_id WHERE d.doca_externa='' AND d.filial_externa IN ("+codes.map(()=>"?").join(",")+")").bind(...codes).all<MappingRow>();
    if(!mapped.success||!mapped.results)throw new Error("NEXELLO_DESTINOS_FALHOU");
    mappings=mapped.results;
  }
  return { ...page, rows: annotateDestinations(compareObservedRows(page.rows,result.results),mappings) };
}
