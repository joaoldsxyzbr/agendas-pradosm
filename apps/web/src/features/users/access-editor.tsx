import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ACCESS_PROFILES, PERMISSIONS, resolvePermissions, type AccessProfile, type Permission } from "../../../../../shared/permissions.ts";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import type { Store } from "@/features/receiving/model";
import { ROLE_LABELS, getAccess, setAccess, usersKey, type AccessForm } from "./api";

const groups:Record<string,string>={recebimento:"Recebimento",conferencia:"Conferência",agendas:"Agendas",importacao:"Importação",relatorios:"Relatório gerencial",lojas:"Lojas",usuarios:"Usuários",auditoria:"Auditoria",diagnosticos:"Diagnósticos",retencao:"Retenção",avisos:"Avisos"};
const actions:Record<string,string>={ver:"Visualizar",editar:"Editar",criar:"Criar",excluir:"Excluir",concluir:"Concluir",reabrir:"Reabrir",exportar:"Exportar PDF",historico:"Histórico",executar:"Executar",substituir:"Substituir importação",permissoes:"Configurar permissões",marcar_lido:"Marcar como lido",publicar:"Publicar", "manual.criar":"Adicionar fornecedor sem agenda","manual.editar":"Editar fornecedor sem agenda","manual.excluir":"Excluir fornecedor sem agenda"};
const field="rounded-md border border-slate-600 bg-[#192d46] px-2 py-1.5 text-xs text-white";
export function validAccess(form:AccessForm){return !!resolvePermissions(form.profile,form.overrides)&& (form.scope.mode==="all"||form.scope.storeIds.length>0);}
export function AccessEditor({value,onChange,stores,disabled=false}:{value:AccessForm;onChange:(value:AccessForm)=>void;stores:Store[];disabled?:boolean}){
  const effective=resolvePermissions(value.profile,value.overrides);
  const defaults=resolvePermissions(value.profile);
  const choose=(permission:Permission,effect:string)=>{
    const overrides=value.overrides.filter(item=>item.permission!==permission);
    if(effect==="allow"||effect==="deny")overrides.push({permission,effect});
    onChange({...value,overrides});
  };
  return <fieldset disabled={disabled} className="space-y-3 rounded-lg border border-slate-600 p-3">
    <legend className="px-1 text-sm font-semibold text-sky-200">Perfil e permissões</legend>
    <label className="grid gap-1 text-xs">Perfil base
      <select className={field} value={value.profile} onChange={event=>onChange({...value,profile:event.target.value as AccessProfile,overrides:[]})}>
        {ACCESS_PROFILES.map(p=><option key={p} value={p}>{ROLE_LABELS[p]}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs">Escopo de lojas
      <select className={field} value={value.scope.mode} onChange={event=>onChange({...value,scope:event.target.value==="all"?{mode:"all"}:{mode:"assigned",storeIds:[]}})}>
        <option value="all">Todas as lojas</option><option value="assigned">Lojas selecionadas</option>
      </select>
    </label>
    {value.scope.mode==="assigned"&&<div className="max-h-40 overflow-auto space-y-1 rounded border border-slate-600 p-2">
      {stores.filter(s=>s.ativo||value.scope.mode==="assigned"&&value.scope.storeIds.includes(s.id)).map(store=><label key={store.id} className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={value.scope.mode==="assigned"&&value.scope.storeIds.includes(store.id)} onChange={event=>{
          if(value.scope.mode!=="assigned")return;
          const ids=value.scope.storeIds.filter(id=>id!==store.id);
          if(event.target.checked)ids.push(store.id);
          onChange({...value,scope:{mode:"assigned",storeIds:ids}});
        }}/>{store.codigo} — {store.nome}
      </label>)}
    </div>}
    <p className="text-xs text-slate-400">Herdar usa o padrão do perfil. Permitir e negar substituem esse padrão. Apenas o administrador integral pode cadastrar, editar ou excluir usuários e delegar direitos. A exportação é uma permissão de interface; dados visíveis podem ser copiados.</p>
    <Button variant="secondary" size="sm" disabled={value.overrides.length===0} onClick={()=>onChange({...value,overrides:[]})}>Restaurar permissões do perfil</Button>
    <div className="max-h-80 overflow-auto space-y-3">
      {Object.entries(groups).map(([group,label])=><section key={group} className="rounded border border-slate-700 p-2">
        <h4 className="mb-2 text-xs font-bold text-sky-200">{label}</h4>
        {PERMISSIONS.filter(p=>p.startsWith(group+".")).map(permission=>{
          const action=permission.slice(group.length+1);
          const selected=value.overrides.find(o=>o.permission===permission)?.effect??"inherit";
          return <label key={permission} className="grid grid-cols-[1fr_auto] items-center gap-2 py-1 text-xs">
            <span>{actions[action]??action}<small className="block text-slate-400">{effective?.has(permission)?"Permitido":"Negado"}</small></span>
            <select className={field} aria-label={label+" — "+(actions[action]??action)} value={selected} onChange={e=>choose(permission,e.target.value)}>
              <option value="inherit">Herdar ({defaults?.has(permission)?"sim":"não"})</option><option value="allow">Permitir</option><option value="deny">Negar</option>
            </select>
          </label>;
        })}
      </section>)}
    </div>
    {!effective&&<p role="alert" className="text-xs text-rose-300">Uma ação permitida exige a visualização da mesma área.</p>}
  </fieldset>;
}
function LoadedAccess({id,initial,stores,onSaved}:{id:string;initial:Awaited<ReturnType<typeof getAccess>>;stores:Store[];onSaved:()=>void}){
  const client=useQueryClient();
  const [value,setValue]=useState<AccessForm>({profile:initial.profile,scope:initial.scope,overrides:initial.overrides});
  const mutation=useMutation({mutationFn:()=>setAccess(id,initial.sessionVersion,value),onSuccess:async()=>{await client.invalidateQueries({queryKey:usersKey});onSaved();}});
  return <div className="space-y-2"><AccessEditor value={value} onChange={setValue} stores={stores} disabled={mutation.isPending}/>
    {mutation.isError&&<p role="alert" className="text-xs text-rose-300">{mutation.error instanceof ApiError?mutation.error.message:"Não foi possível salvar o acesso."}</p>}
    <Button disabled={mutation.isPending||!validAccess(value)} onClick={()=>mutation.mutate()}>{mutation.isPending?"Salvando…":"Salvar permissões e revogar sessão"}</Button>
  </div>;
}
export function ExistingAccessEditor({id,stores,onSaved}:{id:string;stores:Store[];onSaved:()=>void}){
  const query=useQuery({queryKey:["user-access",id],queryFn:()=>getAccess(id),staleTime:0,retry:false});
  if(query.isPending)return <p className="text-xs text-slate-400">Carregando acesso…</p>;
  if(query.isError)return <p role="alert" className="text-xs text-rose-300">Não foi possível consultar o acesso. A conta precisa estar ativa.</p>;
  return <LoadedAccess key={query.data.sessionVersion} id={id} initial={query.data} stores={stores} onSaved={onSaved}/>;
}
