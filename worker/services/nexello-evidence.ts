import type { NexelloAppointment } from "./nexello-agenda.ts";
import { appointmentFingerprint, type ExternalState } from "./nexello-lifecycle.ts";
import type { VerifiedNewBatch } from "../repositories/nexello-persistence.ts";

export type EvidenceSource = "csv_situacao" | "api_estado" | "revisao_admin";
export interface StateEvidence {
  appointment: NexelloAppointment;
  state: Exclude<ExternalState,"unknown">;
  source: EvidenceSource;
  hash: string;
}
export type EvidenceDecision =
  | { protocol:string; kind:"unresolved_store"|"duplicate_observation"|"missing_evidence"|"conflicting_evidence"|"identity_mismatch"|"invalid_evidence"|"not_confirmed" }
  | { protocol:string; kind:"confirmed_candidate"; entry:VerifiedNewBatch["entries"][number]; date:string; externalCode:string };

const HASH=/^[0-9a-f]{64}$/;
function validEvidence(evidence:StateEvidence):boolean{
  return HASH.test(evidence.hash)&&
    (evidence.source==="csv_situacao"||evidence.source==="api_estado"||evidence.source==="revisao_admin")&&
    (evidence.state==="confirmed"||evidence.state==="pending"||evidence.state==="cancelled"||evidence.state==="rejected");
}

/**
 * Pure reconciliation of trusted, already normalized observations and state
 * evidence. This function does NOT authenticate the evidence source; never
 * call with client-supplied assertions or infer the state from report 60.
 * A candidate still requires human review, local conflict checks, and an
 * atomic write guard. No implicit matches or cross-protocol associations.
 */
export function reconcileNexelloEvidence(
  observations:readonly NexelloAppointment[],
  evidence:readonly StateEvidence[],
):EvidenceDecision[]{
  const groups=new Map<string,NexelloAppointment[]>();
  const evidenceGroups=new Map<string,StateEvidence[]>();
  for(const row of observations){
    const group=groups.get(row.protocol)??[];
    group.push(row);groups.set(row.protocol,group);
  }
  for(const row of evidence){
    const group=evidenceGroups.get(row.appointment.protocol)??[];
    group.push(row);evidenceGroups.set(row.appointment.protocol,group);
  }
  const decisions:EvidenceDecision[]=[];
  for(const [protocol,rows] of groups){
    const row=rows[0];
    if(!row)continue;
    // Even exact repeats may be shared loads or pagination drift. Do not
    // collapse automatically for persistence until the source contract is known.
    if(rows.length!==1){decisions.push({protocol,kind:"duplicate_observation"});continue;}
    if(!row.storeCode||!/^F\d{1,3}$/.test(row.storeCode)){
      decisions.push({protocol,kind:"unresolved_store"});continue;
    }
    const candidates=evidenceGroups.get(protocol)??[];
    if(!candidates.length){decisions.push({protocol,kind:"missing_evidence"});continue;}
    if(candidates.some(item=>!validEvidence(item))){decisions.push({protocol,kind:"invalid_evidence"});continue;}
    const first=candidates[0];
    if(!first)continue;
    const identity=appointmentFingerprint(row);
    if(candidates.some(item=>appointmentFingerprint(item.appointment)!==identity)){
      decisions.push({protocol,kind:"identity_mismatch"});continue;
    }
    // Do not resolve contradictory statements by timestamp assumptions.
    if(candidates.some(item=>item.state!==first.state||item.source!==first.source||item.hash!==first.hash)){
      decisions.push({protocol,kind:"conflicting_evidence"});continue;
    }
    if(first.state!=="confirmed"){decisions.push({protocol,kind:"not_confirmed"});continue;}
    decisions.push({protocol,kind:"confirmed_candidate",date:row.date,externalCode:row.storeCode,
      entry:{protocol:row.protocol,startTime:row.startTime,endTime:row.endTime,supplier:row.supplier,
        type:row.type,nfe:[...row.nfe],orders:[...row.orders],externalState:"confirmed",
        evidence:first.source,evidenceHash:first.hash}});
  }
  return decisions.sort((a,b)=>a.protocol.localeCompare(b.protocol));
}
