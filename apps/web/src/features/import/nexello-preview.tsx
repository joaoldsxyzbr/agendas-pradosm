import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { NexelloPreviewConfigSchema, NexelloPreviewPageSchema, type NexelloPreviewPage, type NexelloComparison } from "../../../../../shared/nexello-preview.ts";
import { assembleNexelloReview, filterNexelloReview, type NexelloReview } from "../../../../../shared/nexello-review.ts";

const labels: Record<NexelloComparison,string> = {
  unresolved_store:"Filial não identificada",duplicate_conflict:"Protocolo divergente",
  multiple_local:"Mais de um registro local",not_found:"Não localizado no Prado",
  protected_local:"Registro local protegido",same_fields:"Campos coincidentes",different_fields:"Campos divergentes",
  local_changed:"Comparação variou durante a leitura",
};
const field="min-h-10 rounded border border-[#526777] bg-[#131c25] px-3 py-2 text-sm text-white";
const PAGE_SIZE=50;
function wait(signal: AbortSignal): Promise<void> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new Error("ABORTED"));return;}
    const onAbort=()=>{clearTimeout(timer);reject(new Error("ABORTED"));};
    const timer=setTimeout(()=>{signal.removeEventListener("abort",onAbort);resolve();},4500);
    signal.addEventListener("abort",onAbort,{once:true});
  });
}
export function NexelloPreview() {
  const [review,setReview]=useState<NexelloReview|null>(null);
  const [progress,setProgress]=useState<{page:number;total:number}|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [start,setStart]=useState("");
  const [end,setEnd]=useState("");
  const [store,setStore]=useState("");
  const [tablePage,setTablePage]=useState(1);
  const running=useRef<AbortController|null>(null);
  useEffect(()=>()=>{running.current?.abort();},[]);
  const config=useQuery({queryKey:["nexello-preview-config"],queryFn:async()=>
    NexelloPreviewConfigSchema.parse(await apiFetch<unknown>("/api/admin/nexello/config")),retry:false});
  const stores=useMemo(()=>[...new Set((review?.rows??[]).flatMap(row=>row.kind==="observed"&&row.storeCode?[row.storeCode]:[]))].sort(),[review]);
  const filtered=useMemo(()=>filterNexelloReview(review?.rows??[],start,end,store),[review,start,end,store]);
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const currentPage=Math.min(tablePage,totalPages);
  const visible=filtered.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);

  async function consult() {
    if(running.current||config.data?.available!==true)return;
    const controller=new AbortController();
    running.current=controller;
    setReview(null);setError(null);setProgress({page:1,total:1});setTablePage(1);setStore("");
    const pages:NexelloPreviewPage[]=[];
    try {
      let expected=1;
      for(let number=1;number<=expected;number++){
        if(number>1)await wait(controller.signal);
        setProgress({page:number,total:expected});
        const response=NexelloPreviewPageSchema.parse(await apiFetch<unknown>("/api/admin/nexello/pages/"+number,
          {method:"POST",signal:controller.signal}));
        if(response.page!==number)throw new Error("NEXELLO_PAGINACAO_ALTERADA");
        if(number===1)expected=response.lastPage;
        else if(response.lastPage!==expected||response.total!==pages[0]?.total)throw new Error("NEXELLO_PAGINACAO_ALTERADA");
        pages.push(response);
      }
      if(!controller.signal.aborted)setReview(assembleNexelloReview(pages));
    }catch(cause:unknown){
      if(!controller.signal.aborted)setError(cause instanceof ApiError?cause.message:"Leitura incompleta ou paginação alterada. Nenhum resultado parcial foi mantido.");
    }finally{
      if(running.current===controller){running.current=null;if(!controller.signal.aborted)setProgress(null);}
    }
  }
  function cancel(){
    running.current?.abort();running.current=null;setProgress(null);setReview(null);
  }
  return <section aria-label="Consulta Nexello" className="min-w-0 rounded-md border border-[#344956] bg-[#192734]">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#344956] p-5">
      <div className="max-w-2xl">
        <p className="text-xs font-medium text-[#90c8df]">Integração · Organiza</p>
        <h2 className="mt-1 text-xl font-semibold text-white">Revisão de agendamentos</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">Percorra as páginas do relatório 60 e compare os protocolos com o Prado. Nenhuma agenda é gravada nesta consulta.</p>
      </div>
      {progress?<Button variant="secondary" onClick={cancel}>Cancelar consulta</Button>:
        <Button disabled={config.data?.available!==true} onClick={()=>void consult()}><RefreshCw size={16} aria-hidden="true"/>Consultar Nexello</Button>}
    </div>
    <div className="space-y-4 p-5">
      {config.isPending&&<p role="status" className="text-sm text-slate-300">Verificando configuração…</p>}
      {config.isError&&<p role="alert" className="text-sm text-rose-300">Não foi possível verificar a configuração.</p>}
      {config.data?.available===false&&<p role="status" className="text-sm text-slate-300">Conexão desabilitada neste ambiente. A leitura depende do novo Worker e de uma configuração autorizada.</p>}
      {progress&&<p role="status" className="text-sm text-slate-200">Consultando página {progress.page} de {progress.total}…</p>}
      {error&&<p role="alert" className="text-sm text-rose-300">{error}</p>}
      {review&&<>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-[#344956] bg-[#344956] md:grid-cols-4">
          {[[review.total,"Linhas consultadas"],[review.repeatedProtocols,"Protocolos repetidos"],[review.divergentProtocols,"Protocolos divergentes"],[review.invalidRows,"Linhas inválidas"]].map(([value,label])=>
            <div key={label} className="bg-[#192734] p-4"><p className="text-xs text-slate-300">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div>)}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-slate-300">Data inicial<input type="date" className={field} value={start} onChange={e=>{setStart(e.target.value);setTablePage(1);}}/></label>
          <label className="grid gap-1 text-xs text-slate-300">Data final<input type="date" className={field} value={end} onChange={e=>{setEnd(e.target.value);setTablePage(1);}}/></label>
          <label className="grid gap-1 text-xs text-slate-300">Filial<select className={field} value={store} onChange={e=>{setStore(e.target.value);setTablePage(1);}}><option value="">Todas</option>{stores.map(code=><option key={code} value={code}>{code}</option>)}<option value="unresolved">Não identificada</option></select></label>
          <Button variant="secondary" onClick={()=>{setStart("");setEnd("");setStore("");setTablePage(1);}}>Limpar filtros</Button>
        </div>
        {start&&end&&start>end&&<p role="alert" className="text-sm text-rose-300">A data final deve ser igual ou posterior à inicial.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm tabular-nums text-slate-300">{filtered.length} linhas no filtro · {review.pages} páginas da fonte percorridas</p>
          <div className="flex items-center gap-2"><Button variant="secondary" size="sm" disabled={currentPage<=1} onClick={()=>setTablePage(currentPage-1)}><ChevronLeft size={14} aria-hidden="true"/>Anterior</Button><span className="text-xs tabular-nums">{currentPage}/{totalPages}</span><Button variant="secondary" size="sm" disabled={currentPage>=totalPages} onClick={()=>setTablePage(currentPage+1)}>Próxima<ChevronRight size={14} aria-hidden="true"/></Button></div>
        </div>
        <div className="overflow-x-auto rounded border border-[#344956]">
          <table aria-label="Registros observados na Nexello" className="w-full min-w-[1040px] text-left text-sm">
            <thead className="bg-[#223443] text-xs text-slate-300"><tr>{["Protocolo","Data e horário","Filial","Fornecedor","Tipo","Situação externa","Comparação local"].map(text=><th key={text} scope="col" className="px-3 py-3 font-medium">{text}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#344956]">{visible.map(row=><tr key={row.index}>
              {row.kind==="invalid"?<td colSpan={7} className="px-3 py-3 text-amber-200">Linha {row.index}: formato não reconhecido ({row.field}).</td>:<>
                <td className="px-3 py-3 tabular-nums">{row.protocol}</td><td className="px-3 py-3 tabular-nums">{row.date}<span className="block text-xs text-slate-400">{row.startTime}–{row.endTime}</span></td>
                <td className="px-3 py-3">{row.storeCode??"Não resolvida"}</td><td className="px-3 py-3">{row.supplier}</td><td className="px-3 py-3">{row.type}</td><td className="px-3 py-3 text-slate-300">Não informada</td><td className="px-3 py-3 text-xs">{row.comparison?labels[row.comparison]:"Não comparado"}</td>
              </>}
            </tr>)}</tbody>
          </table>
          {!visible.length&&<p className="p-4 text-sm text-slate-400">Nenhum registro neste filtro.</p>}
        </div>
        <p className="text-xs leading-relaxed text-slate-400">A leitura completa das páginas não comprova um retrato estável da Nexello. Registros inválidos permanecem visíveis porque não podem ser filtrados com segurança. Comparações não comprovam identidade, aprovação ou cancelamento. Nenhuma importação automática é permitida.</p>
      </>}
    </div>
  </section>;
}
