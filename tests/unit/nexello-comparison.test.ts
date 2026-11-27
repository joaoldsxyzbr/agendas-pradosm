import assert from "node:assert/strict";
import { test } from "node:test";
import { compareObservedRows, type ComparisonLocalRow } from "../../worker/services/nexello-comparison.ts";
import type { NexelloPreviewRow } from "../../shared/nexello-preview.ts";
const row = { index:1,kind:"observed",protocol:"123456",date:"2026-11-27",storeCode:"F01",
  startTime:"08:00",endTime:"09:00",supplier:"Fictício",type:"Pedido",nfe:[],orders:["001","002"],externalState:"unknown" } as const;
const observed: Extract<NexelloPreviewRow,{kind:"observed"}> = {...row,nfe:[],orders:["001","002"]};
const local: ComparisonLocalRow = {protocolo:"123456",data_agenda:"2026-11-27",codigo:"F01",horario_inicio:"08:00",
  horario_fim:"09:00",fornecedor:"Fictício",tipo:"Pedido",nfe:"[]",pedidos:'["002","001"]',origem:"importado",ativo:1,status:"aguardando",status_dia:"aberto"};
function result(rows: NexelloPreviewRow[], locals: ComparisonLocalRow[]) {
  return compareObservedRows(rows,locals).map(r => r.kind==="observed" ? r.comparison : "invalid");
}
test("comparison is observational, ignores document order and never invents external state",()=>{
  assert.deepEqual(result([observed],[local]),["same_fields"]);
  assert.deepEqual(result([observed],[]),["not_found"]);
  assert.deepEqual(result([observed],[{...local,data_agenda:"2026-11-28"}]),["different_fields"]);
  assert.deepEqual(result([observed],[{...local,pedidos:"invalid"}]),["different_fields"]);
  const compared=compareObservedRows([observed],[local])[0];
  assert.equal(compared?.kind==="observed" && compared.externalState,"unknown");
});
test("conflicts and protected rows are not treated as matching records",()=>{
  assert.deepEqual(result([observed,{...observed,index:2,storeCode:"F02"}],[local]),["duplicate_conflict","duplicate_conflict"]);
  assert.deepEqual(result([observed],[local,local]),["multiple_local"]);
  assert.deepEqual(result([{...observed,storeCode:null}],[]),["unresolved_store"]);
  for (const protectedRow of [{...local,origem:"manual"},{...local,ativo:0},{...local,status:"recebido"},{...local,status_dia:"concluido"}])
    assert.deepEqual(result([observed],[protectedRow]),["protected_local"]);
});
