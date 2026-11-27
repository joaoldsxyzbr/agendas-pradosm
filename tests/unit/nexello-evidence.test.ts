import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileNexelloEvidence, type StateEvidence } from "../../worker/services/nexello-evidence.ts";
import type { NexelloAppointment } from "../../worker/services/nexello-agenda.ts";

const row:NexelloAppointment={protocol:"123456",date:"2026-11-27",storeCode:"F01",supplier:"Fictício",
  startTime:"08:00",endTime:"09:00",type:"Pedido",nfe:[],orders:["001","002"]};
const evidence:StateEvidence={appointment:{...row,orders:["002","001"]},state:"confirmed",source:"revisao_admin",hash:"a".repeat(64)};
const kind=(rows:NexelloAppointment[],sources:StateEvidence[])=>reconcileNexelloEvidence(rows,sources)[0]?.kind;

test("only explicit matching evidence can produce a candidate, never an automatic write",()=>{
  assert.equal(kind([row],[]),"missing_evidence");
  const result=reconcileNexelloEvidence([row],[evidence])[0];
  assert.equal(result?.kind,"confirmed_candidate");
  if(result?.kind==="confirmed_candidate"){
    assert.equal(result.entry.evidenceHash,evidence.hash);
    assert.equal(result.entry.externalState,"confirmed");
    assert.equal(result.externalCode,"F01");
  }
  for(const state of ["pending","cancelled","rejected"] as const)
    assert.equal(kind([row],[{...evidence,state}]),"not_confirmed");
});
test("identity mismatch, unknown destination and duplicate source observations block candidates",()=>{
  for(const change of [{date:"2026-11-28"},{storeCode:"F02"},{supplier:"Outro"},{startTime:"08:30"},{orders:["003"]}])
    assert.equal(kind([row],[{...evidence,appointment:{...row,...change}}]),"identity_mismatch");
  assert.equal(kind([{...row,storeCode:null}],[evidence]),"unresolved_store");
  assert.equal(kind([row,row],[evidence]),"duplicate_observation");
  assert.equal(kind([row],[{...evidence,appointment:{...row,protocol:"123457"}}]),"missing_evidence");
});
test("conflicting or invalid evidence cannot be resolved silently",()=>{
  assert.equal(kind([row],[evidence,{...evidence,state:"cancelled"}]),"conflicting_evidence");
  assert.equal(kind([row],[evidence,{...evidence,hash:"b".repeat(64)}]),"conflicting_evidence");
  assert.equal(kind([row],[{...evidence,hash:"invalid"}]),"invalid_evidence");
  assert.equal(kind([row],[evidence,evidence]),"confirmed_candidate");
});
