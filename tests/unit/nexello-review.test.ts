import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleNexelloReview, filterNexelloReview } from "../../shared/nexello-review.ts";
import type { NexelloPreviewPage, NexelloPreviewRow } from "../../shared/nexello-preview.ts";
const observed: Extract<NexelloPreviewRow,{kind:"observed"}>={index:1,kind:"observed",protocol:"123456",date:"2026-11-27",storeCode:"F01",startTime:"08:00",endTime:"09:00",supplier:"Fictício",type:"Pedido",nfe:[],orders:[],externalState:"unknown",comparison:"not_found"};
const first:NexelloPreviewPage={page:1,lastPage:2,total:101,readOnly:true,rows:Array.from({length:100},(_,i)=>({...observed,index:i+1,protocol:String(123456+i)}))};
const last:NexelloPreviewPage={page:2,lastPage:2,total:101,readOnly:true,rows:[{...observed,storeCode:"F02"}]};
test("cross-page conflicts are identified before filtering; all rows are preserved",()=>{
  const review=assembleNexelloReview([first,last]);
  assert.equal(review.total,101);assert.equal(review.repeatedProtocols,1);assert.equal(review.divergentProtocols,1);
  assert.equal(review.rows[100]?.index,101);
  const matches=review.rows.filter(r=>r.kind==="observed"&&r.protocol==="123456");
  assert.ok(matches.every(r=>r.kind==="observed"&&r.comparison==="duplicate_conflict"&&r.externalState==="unknown"));
  assert.equal(filterNexelloReview(review.rows,"2026-11-27","2026-11-27","F02").length,1);
});
test("incomplete, reordered, or changed pages are rejected",()=>{
  assert.throws(()=>assembleNexelloReview([first]));
  assert.throws(()=>assembleNexelloReview([last,first]));
  assert.throws(()=>assembleNexelloReview([first,{...last,total:102}]));
  assert.throws(()=>assembleNexelloReview([first,{...last,rows:[]}]));
});
test("identical duplicates and invalid rows remain visible; local drift is explicit",()=>{
  const review=assembleNexelloReview([first,{...last,rows:[{...observed,comparison:"same_fields"}]}]);
  assert.equal(review.repeatedProtocols,1);assert.equal(review.divergentProtocols,0);
  assert.equal(review.rows[0]?.kind==="observed"&&review.rows[0].comparison,"local_changed");
  const invalid:NexelloPreviewRow={kind:"invalid",index:2,field:"tipo"};
  assert.deepEqual(filterNexelloReview([observed,invalid],"2026-11-28","","F02"),[invalid]);
});
