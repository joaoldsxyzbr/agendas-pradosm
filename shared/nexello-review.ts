import { NexelloPreviewPageSchema, type NexelloPreviewPage, type NexelloPreviewRow } from "./nexello-preview.ts";

export interface NexelloReview {
  rows: NexelloPreviewRow[];
  total: number;
  pages: number;
  repeatedProtocols: number;
  divergentProtocols: number;
  invalidRows: number;
}
type Observed = Extract<NexelloPreviewRow,{kind:"observed"}>;
function fingerprint(row: Observed): string {
  const docs = (values: string[]) => [...new Set(values)].sort();
  return JSON.stringify([row.date,row.storeCode,row.startTime,row.endTime,row.supplier,row.type,docs(row.nfe),docs(row.orders)]);
}

/** A complete traversal is not a stable upstream snapshot. Reject detectable
 * pagination drift and preserve every row, even identical duplicates. */
export function assembleNexelloReview(input: readonly NexelloPreviewPage[]): NexelloReview {
  const pages = input.map(page => NexelloPreviewPageSchema.parse(page));
  const first = pages[0];
  if (!first || pages.length !== first.lastPage || first.lastPage !== Math.max(1,Math.ceil(first.total/100))) {
    throw new Error("NEXELLO_LEITURA_INCOMPLETA");
  }
  const groups = new Map<string,{count:number;keys:Set<string>;comparisons:Set<string>}>();
  const rows: NexelloPreviewRow[] = [];
  for (const [i,page] of pages.entries()) {
    if (page.page !== i+1 || page.lastPage !== first.lastPage || page.total !== first.total ||
      page.rows.length !== Math.min(100,Math.max(0,first.total-i*100))) throw new Error("NEXELLO_PAGINACAO_ALTERADA");
    for (const [j,row] of page.rows.entries()) {
      if (row.index !== j+1) throw new Error("NEXELLO_PAGINACAO_ALTERADA");
      const indexed={...row,index:rows.length+1};
      rows.push(indexed);
      if (row.kind === "observed") {
        const group=groups.get(row.protocol)??{count:0,keys:new Set<string>(),comparisons:new Set<string>()};
        group.count++;
        group.keys.add(fingerprint(row));
        if(row.comparison)group.comparisons.add(row.comparison);
        groups.set(row.protocol,group);
      }
    }
  }
  const divergent=new Set([...groups].filter(([,group])=>group.keys.size>1).map(([key])=>key));
  const changed=new Set([...groups].filter(([,group])=>group.comparisons.size>1).map(([key])=>key));
  return {
    rows: rows.map(row=>row.kind!=="observed"?row:divergent.has(row.protocol)?{...row,comparison:"duplicate_conflict"}:
      changed.has(row.protocol)?{...row,comparison:"local_changed"}:row),
    total:first.total,pages:pages.length,
    repeatedProtocols:[...groups.values()].filter(group=>group.count>1).length,
    divergentProtocols:divergent.size,
    invalidRows:rows.filter(row=>row.kind==="invalid").length,
  };
}
export function filterNexelloReview(rows: readonly NexelloPreviewRow[], start: string, end: string, store: string): NexelloPreviewRow[] {
  if(start && end && start>end)return [];
  // Invalid rows cannot reliably be scoped by date or store; never hide them.
  return rows.filter(row=>row.kind==="invalid" || ((!start||row.date>=start)&&(!end||row.date<=end)&&
    (!store||(store==="unresolved"?row.storeCode===null:row.storeCode===store))));
}
