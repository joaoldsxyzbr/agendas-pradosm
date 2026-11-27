import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.ts";
import { routePolicy, permitsAction, permitsDayStatus, permitsImportReplacement } from "./access-policy.ts";
import { canAccessStore } from "../../shared/permissions.ts";
import { ImportAgendaInput, ImportAgendaBatchInput } from "../../shared/agenda.ts";
import { publicarAvisoSchema } from "../../shared/avisos.ts";
import { findStoreByCode } from "../repositories/agendas.ts";
import { recordAudit } from "../repositories/audit.ts";

export const enforceAccess=createMiddleware<AppEnv>(async(c,next)=>{
  const access=c.get("effectiveAccess");
  if(!access?.customized){await next();return;}
  const user=c.get("authUser");
  const path=c.req.path,method=c.req.method;
  const policy=routePolicy(method,path);
  const deny=async()=>{
    // Somente operações sensíveis ou tentativas de acessar entidades por ID.
    // Não registrar URLs, conteúdo de pedidos, senhas, tokens ou cabeçalhos.
    if(user&&policy&&(method!=="GET"||["agenda-id","appointment-id","store-id"].includes(policy.scope))){
      try{await recordAudit(c.env.DB,{userId:user.id,action:"acesso_negado",entity:"usuario",entityId:user.id,
        details:"Operação negada pela política de autorização.",after:{method,required:policy.any,scope:policy.scope}});}
      catch{console.error("Não foi possível registrar tentativa de acesso negado.");}
    }
    return c.json({error:"ACESSO_NEGADO",message:"Operação ou loja não permitida."},403);
  };
  if(!user)return deny();
  if(!permitsAction(policy,access.permissions)||!policy)return deny();
  // Configuração de usuários é reservada ao administrador integral. Permissão
  // de edição de cadastro não pode ser usada como delegação ou autoelevação.
  if(path.startsWith("/api/admin/users")&&method!=="GET")return deny();
  if(policy.scope==="all-stores"&&access.scope.mode!=="all")return deny();
  if(policy.scope==="store-id"){
    const body=method==="PATCH"?await c.req.raw.clone().json().catch(()=>null) as {id?:unknown}|null:null;
    const id=method==="PATCH"?body?.id:path.split("/")[4];
    if(typeof id!=="string"||!canAccessStore(access.scope,id))return deny();
  }
  if(policy.scope==="agenda-id"||policy.scope==="appointment-id"){
    const id=path.split("/")[4];
    if(!id)return deny();
    const row=policy.scope==="agenda-id"?
      await c.env.DB.prepare("SELECT loja_id FROM agendas WHERE id=?").bind(id).first<{loja_id:string}>():
      await c.env.DB.prepare("SELECT a.loja_id FROM agendamentos p JOIN agendas a ON a.id=p.agenda_id WHERE p.id=?").bind(id).first<{loja_id:string}>();
    if(!row||!canAccessStore(access.scope,row.loja_id))return deny();
  }
  if(method==="PATCH"&&/^\/api\/admin\/agendas\/[^/]+\/status$/.test(path)){
    const body=await c.req.raw.clone().json().catch(()=>null) as {status?:unknown}|null;
    if(!permitsDayStatus(access.permissions,body?.status))return deny();
  }
  if(policy.scope==="import-batch"){
    // A mesma validação das rotas reais, antes de qualquer escrita.
    const body=await c.req.raw.clone().json().catch(()=>null);
    const batch=path.endsWith("/bulk")?ImportAgendaBatchInput.safeParse(body):null;
    const single=batch===null?ImportAgendaInput.safeParse(body):null;
    const inputs=batch?.success?batch.data.agendas:single?.success?[single.data]:null;
    if(!inputs)return c.json({error:"REQUISICAO_INVALIDA",message:"Dados de importação inválidos."},400);
    for(const input of inputs){
      if(!permitsImportReplacement(access.permissions,input.replace===true))return deny();
      const store=await findStoreByCode(c.env.DB,input.storeCode);
      if(!store||!canAccessStore(access.scope,store.id))return deny();
    }
  }
  if(path.startsWith("/api/store/")){
    const selected=user.lojaId;
    const requested=c.req.header("X-Agenda-Store");
    if(!selected||(requested&&requested!==selected)||!canAccessStore(access.scope,selected))return deny();
    // As rotas de conferência ainda validam a loja selecionada e o papel operacional.
    c.set("authUser",{...user,papel:"conferente"});
  }
  if(method==="POST"&&path==="/api/admin/avisos"&&access.scope.mode!=="all"){
    const parsed=publicarAvisoSchema.safeParse(await c.req.raw.clone().json().catch(()=>null));
    const allowed=new Set(user.lojasDisponiveis?.map(s=>s.codigo)??[]);
    if(!parsed.success||!parsed.data.lojas?.length||parsed.data.lojas.some(code=>!allowed.has(code)))return deny();
  }
  // Contas personalizadas usam o fallback HTTP enquanto o hub não entende escopos.
  if(policy.scope==="realtime"){
    if(path.endsWith("/config"))return c.json({mode:"off",protocolVersion:1});
    return deny();
  }
  await next();
});
export function scopedStoreIds(c:{get:(key:"effectiveAccess")=>import("../repositories/access.ts").EffectiveAccess|undefined}):readonly string[]|undefined{
  const access=c.get("effectiveAccess");
  return access?.customized&&access.scope.mode==="assigned"?access.scope.storeIds:undefined;
}
