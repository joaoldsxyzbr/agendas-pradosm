// Matriz de rotas para contas personalizadas (#248). Não substitui ainda os guards vigentes.
// Um identificador de loja do cliente nunca é suficiente: a integração deverá resolver a entidade real.
import { canAccessStore, type Permission, type StoreScope } from "../../shared/permissions.ts";

export type ScopeCheck="none"|"all-stores"|"filtered-list"|"agenda-id"|"appointment-id"|"store-id"|"import-batch"|"selected-store"|"notice-filter"|"realtime";
export type RoutePolicy={any:readonly Permission[];all?:readonly Permission[];scope:ScopeCheck};
const rule=(any:Permission|readonly Permission[],scope:ScopeCheck="none",all?:readonly Permission[]):RoutePolicy=>({any:typeof any==="string"?[any]:any,scope,...(all?{all}:{})});
const id="[^/]+";
type Rule=[string,RegExp,RoutePolicy];
const route=(method:string,path:string,policy:RoutePolicy):Rule=>[method,new RegExp("^"+path+"$"),policy];
const A="/api/admin",S="/api/store";
const RULES:Rule[]=[
  route("GET",A+"/stores",rule(["lojas.ver","recebimento.ver","agendas.ver","importacao.ver","relatorios.ver"],"filtered-list")),
  route("GET",A+"/stores/nexello-destinos",rule("lojas.ver","all-stores")),
  route("POST",A+"/stores/nexello-destinos",rule("lojas.editar","all-stores")),
  route("POST",A+"/stores",rule("lojas.criar","all-stores")),
  route("PATCH",A+"/stores",rule("lojas.editar","store-id")),
  route("DELETE",A+"/stores/"+id,rule("lojas.excluir","store-id")),
  route("GET",A+"/users",rule("usuarios.ver","all-stores")),
  route("GET",A+"/users/"+id+"/access",rule("usuarios.permissoes","all-stores")),
  route("PUT",A+"/users/"+id+"/access",rule("usuarios.permissoes","all-stores")),
  route("POST",A+"/users",rule("usuarios.criar","all-stores",["usuarios.permissoes"])),
  route("PATCH",A+"/users",rule("usuarios.editar","all-stores",["usuarios.permissoes"])),
  route("DELETE",A+"/users/"+id,rule("usuarios.excluir","all-stores",["usuarios.permissoes"])),
  route("GET",A+"/nexello/config",rule("importacao.ver","all-stores",["importacao.executar"])),
  route("POST",A+"/nexello/pages/[1-9][0-9]?",rule("importacao.executar","all-stores",["importacao.ver"])),
  route("POST",A+"/agendas/import(?:/bulk)?",rule("importacao.executar","import-batch")),
  route("GET",A+"/agendas(?:/today)?",rule(["recebimento.ver","agendas.ver","importacao.ver"],"filtered-list")),
  route("GET",A+"/agendas/"+id+"/digitacao",rule("agendas.ver","agenda-id")),
  route("PATCH",A+"/agendas/"+id+"/(?:digitado|digitacao)",rule("agendas.editar","agenda-id")),
  route("GET",A+"/agendas/"+id+"/history",rule("agendas.historico","agenda-id")),
  route("POST",A+"/agendas/"+id+"/manual",rule("recebimento.manual.criar","agenda-id")),
  route("PATCH",A+"/agendas/"+id+"/status",rule(["recebimento.concluir","recebimento.reabrir"],"agenda-id")),
  route("GET",A+"/agendas/"+id,rule(["recebimento.ver","agendas.ver"],"agenda-id")),
  route("GET",A+"/appointments/"+id,rule("recebimento.ver","appointment-id")),
  route("GET",A+"/appointments/"+id+"/history",rule("recebimento.ver","appointment-id")),
  route("PATCH",A+"/appointments/"+id+"/manual",rule("recebimento.manual.editar","appointment-id")),
  route("DELETE",A+"/appointments/"+id+"/manual",rule("recebimento.manual.excluir","appointment-id")),
  route("PATCH",A+"/appointments/"+id+"/(?:status|exchanges|observation)",rule("recebimento.editar","appointment-id")),
  route("GET",A+"/reports(?:/occurrences)?",rule("relatorios.ver","filtered-list")),
  route("GET",A+"/presence",rule("recebimento.ver","filtered-list")),
  route("GET",A+"/audit",rule("auditoria.ver","all-stores")),
  route("GET",A+"/diagnostics",rule("diagnosticos.ver","all-stores")),
  route("GET",A+"/retention/status",rule("retencao.ver","all-stores")),
  route("POST",A+"/retention/run",rule("retencao.executar","all-stores")),
  route("POST",A+"/avisos",rule("avisos.publicar","notice-filter")),
  route("GET",S+"/today",rule("conferencia.ver","selected-store")),
  route("GET",S+"/history(?:/"+id+")?",rule("conferencia.historico","selected-store")),
  route("POST",S+"/(?:today|agenda/"+id+")/manual",rule("conferencia.manual.criar","selected-store")),
  route("POST",S+"/agenda/"+id+"/complete",rule("conferencia.concluir","selected-store")),
  route("GET",S+"/appointments/"+id,rule("conferencia.ver","appointment-id")),
  route("PATCH",S+"/appointments/"+id+"/manual",rule("conferencia.manual.editar","appointment-id")),
  route("DELETE",S+"/appointments/"+id+"/manual",rule("conferencia.manual.excluir","appointment-id")),
  route("PATCH",S+"/appointments/"+id+"/(?:status|exchanges|observation)",rule("conferencia.editar","appointment-id")),
  route("POST",S+"/presence",rule("conferencia.ver","selected-store")),
  route("DELETE",S+"/presence",rule("conferencia.ver","selected-store")),
  route("GET","/api/avisos",rule("avisos.ver","notice-filter")),
  route("POST","/api/avisos/(?:marcar-todos|"+id+"/lido)",rule("avisos.marcar_lido","notice-filter")),
  route("GET","/api/realtime(?:/config)?",rule(["recebimento.ver","conferencia.ver","agendas.ver","relatorios.ver"],"realtime")),
];
export function routePolicy(method:string,path:string):RoutePolicy|null{
  // Sem normalização permissiva de barras codificadas, caminhos alternativos ou métodos.
  if(path.includes("%")||path.includes("//")||path.includes("?")||path.includes("#")||path.split("/").some(p=>p==="."||p===".."))return null;
  return RULES.find(([m,re])=>m===method&&re.test(path))?.[2]??null;
}
export function permitsAction(policy:RoutePolicy|null,permissions:ReadonlySet<Permission>):boolean{
  return !!policy&&policy.any.some(p=>permissions.has(p))&&(!policy.all||policy.all.every(p=>permissions.has(p)));
}
// Usar somente depois de resolver no banco TODAS as lojas reais envolvidas.
export function permitsResolvedScope(policy:RoutePolicy|null,scope:StoreScope,storeIds:readonly string[]):boolean{
  if(!policy)return false;
  if(policy.scope==="none")return true;
  if(policy.scope==="all-stores")return scope.mode==="all";
  if(policy.scope==="filtered-list"||policy.scope==="notice-filter"||policy.scope==="realtime")return false; // requer integração de filtro/snapshot específica
  return storeIds.length>0&&storeIds.every(id=>canAccessStore(scope,id));
}
export function permitsImportReplacement(permissions:ReadonlySet<Permission>,replace:boolean):boolean{
  return permissions.has("importacao.executar")&&(!replace||permissions.has("importacao.substituir"));
}
export function permitsDayStatus(permissions:ReadonlySet<Permission>,status:unknown):boolean{
  return status==="concluido"?permissions.has("recebimento.concluir"):status==="aberto"?permissions.has("recebimento.reabrir"):false;
}
