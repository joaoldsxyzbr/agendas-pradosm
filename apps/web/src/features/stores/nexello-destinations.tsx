import { useState } from "react";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ApiError,apiFetch } from "@/lib/api";
import type { Store } from "@/features/receiving/model";
import { NexelloDestinationsSchema } from "../../../../../shared/nexello-destinations.ts";
const key=["admin","nexello-destinos"] as const;
export function NexelloDestinations({stores}:{stores:Store[]}){
  const client=useQueryClient();
  const [selected,setSelected]=useState("");
  const [confirm,setConfirm]=useState(false);
  const query=useQuery({queryKey:key,queryFn:async()=>NexelloDestinationsSchema.parse(await apiFetch<unknown>("/api/admin/stores/nexello-destinos")),retry:false});
  const mutation=useMutation({mutationFn:async(id:string)=>apiFetch<{created:boolean}>("/api/admin/stores/nexello-destinos",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({storeId:id})
  }),onSuccess:async()=>{setSelected("");setConfirm(false);await client.invalidateQueries({queryKey:key});}});
  const destinations=query.data??[];
  const linked=new Set(destinations.filter(d=>!d.dock).map(d=>d.externalCode));
  const eligible=stores.filter(s=>s.ativo&&/^F\d{1,3}$/.test(s.codigo)&&!linked.has(s.codigo));
  const chosen=eligible.find(s=>s.id===selected);
  return <section aria-label="Vínculos Nexello" className="rounded-md border border-[#344956] bg-[#192734]">
    <div className="border-b border-[#344956] p-4 md:p-5">
      <h2 className="text-lg font-semibold">Destinos da integração Nexello</h2>
      <p className="mt-1 text-sm text-slate-300">Vincule explicitamente filiais com o mesmo código no Prado. O vínculo não inicia a sincronização.</p>
    </div>
    <div className="space-y-4 p-4 md:p-5">
      {query.isPending&&<p role="status" className="text-sm text-slate-400">Carregando vínculos…</p>}
      {query.isError&&<p role="alert" className="text-sm text-rose-300">Não foi possível consultar os vínculos. <Button size="sm" variant="secondary" onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}
      {query.data&&<>
        <div className="overflow-x-auto"><table className="w-full min-w-[450px] text-left text-sm" aria-label="Destinos vinculados"><thead className="text-xs text-slate-400"><tr><th className="p-2">Nexello</th><th className="p-2">Unidade Prado</th><th className="p-2">Situação</th></tr></thead><tbody className="divide-y divide-[#344956]">{destinations.map(d=><tr key={d.externalCode+":"+d.dock}><td className="p-2 tabular-nums">{d.externalCode}{d.dock?" · "+d.dock:""}</td><td className="p-2">{d.storeCode} — {d.storeName}</td><td className="p-2">{d.active?"Ativa":"Inativa"}</td></tr>)}</tbody></table></div>
        {!destinations.length&&<p className="text-sm text-slate-400">Nenhuma filial vinculada.</p>}
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-0 flex-1 gap-1 text-xs text-slate-300">Unidade para vincular<select disabled={mutation.isPending||confirm} className="min-h-10 rounded border border-[#526777] bg-[#131c25] px-3 text-sm" value={selected} onChange={e=>{setSelected(e.target.value);mutation.reset();}}><option value="">Selecione a filial</option>{eligible.map(s=><option value={s.id} key={s.id}>{s.codigo} — {s.nome}</option>)}</select></label>
          <Button disabled={!chosen||confirm||mutation.isPending} onClick={()=>setConfirm(true)}>Revisar vínculo</Button>
        </div>
        {confirm&&chosen&&<div className="space-y-3 rounded border border-[#526777] p-3">
          <p className="text-sm">Confirma a associação de {chosen.codigo} na Nexello à unidade {chosen.nome} ({chosen.codigo})? Confira o código no Organiza antes de confirmar.</p>
          <div className="flex gap-2"><Button variant="secondary" disabled={mutation.isPending} onClick={()=>setConfirm(false)}>Cancelar</Button><Button disabled={mutation.isPending} onClick={()=>mutation.mutate(chosen.id)}>Confirmar vínculo</Button></div>
        </div>}
        {mutation.isError&&<p role="alert" className="text-sm text-rose-300">{mutation.error instanceof ApiError?mutation.error.message:"Não foi possível salvar o vínculo."}</p>}
        {mutation.isSuccess&&<p role="status" className="text-sm text-slate-200">Vínculo confirmado.</p>}
      </>}
      <p className="text-xs text-slate-400">O CD não pode ser vinculado por este fluxo: a doca deve ser identificada na origem. Alterações de vínculos existentes não são automáticas.</p>
    </div>
  </section>;
}
