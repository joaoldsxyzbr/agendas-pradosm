import type { AuthUser } from "../../shared/auth.ts";
import { canAccessStore } from "../../shared/permissions.ts";
import type { Env } from "../env.ts";
import { findEffectiveAccess, type EffectiveAccess } from "../repositories/access.ts";
import { findActiveStoreById } from "../repositories/stores.ts";
type UserRow={id:string;nome:string;papel:AuthUser["papel"];loja_id:string|null;session_version:number};
export async function sessionIdentity(env:Env,user:UserRow,requestedStore?:string):Promise<{user:AuthUser;access?:EffectiveAccess}|null>{
  const access=env.ACCESS_MODE==="on"?await findEffectiveAccess(env.DB,user.id):undefined;
  if(env.ACCESS_MODE==="on"&&(!access||access.sessionVersion!==user.session_version))return null;
  if(!access?.customized){
    const store=user.papel==="conferente"&&user.loja_id?await findActiveStoreById(env.DB,user.loja_id):null;
    if(user.papel==="conferente"&&!store)return null;
    return {user:{id:user.id,nome:user.nome,papel:user.papel,lojaId:user.loja_id,lojaCodigo:store?.codigo??null,lojaNome:store?.nome??null},access};
  }
  const result=await env.DB.prepare("SELECT id,codigo,nome FROM lojas WHERE ativo=1 AND excluido_em IS NULL ORDER BY codigo").all<{id:string;codigo:string;nome:string}>();
  const stores=(result.results??[]).filter(store=>canAccessStore(access.scope,store.id));
  const chosen=stores.find(store=>store.id===requestedStore)??stores.find(store=>store.id===user.loja_id)??stores[0];
  return {user:{id:user.id,nome:user.nome,papel:user.papel,perfil:access.profile,permissoes:[...access.permissions],escopo:access.scope,
    lojasDisponiveis:stores,lojaId:chosen?.id??null,lojaCodigo:chosen?.codigo??null,lojaNome:chosen?.nome??null},access};
}
