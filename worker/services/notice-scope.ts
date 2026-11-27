import type { AuthUser } from "../../shared/auth.ts";
import type { Permission } from "../../shared/permissions.ts";

// null é acesso global; [] vê somente publicações realmente globais.
// A sessão contém apenas lojas ativas autorizadas, resolvidas no servidor.
export type NoticeScope = string | readonly string[] | null;
export function noticeScope(user: AuthUser): NoticeScope {
  if(user.perfil) {
    if(user.escopo?.mode==="all")return null;
    return user.escopo?.mode==="assigned"
      ? (user.lojasDisponiveis??[]).map(s=>s.id).filter(id=>user.escopo?.mode==="assigned"&&user.escopo.storeIds.includes(id))
      : [];
  }
  return user.papel==="admin"?null:user.papel==="conferente"&&user.lojaId?[user.lojaId]:[];
}
export function canUseNotice(user:AuthUser,permission:Permission):boolean{
  if(user.perfil)return user.permissoes?.includes("avisos.ver")===true&&user.permissoes.includes(permission);
  return user.papel==="admin"||user.papel==="conferente"&&["avisos.ver","avisos.marcar_lido","avisos.conversar","avisos.reagir"].includes(permission);
}
export function noticeScopeArgs(scope:NoticeScope):string[]{
  const ids=typeof scope==="string"?[scope]:scope===null?[]:[...new Set(scope)];
  if(ids.length>50||ids.some(id=>!id.trim()||id!==id.trim()))throw new Error("ACESSO_ESCOPO_INVALIDO");
  return ids;
}
export function noticeVisibilitySql(scope:NoticeScope):string{
  if(scope===null)return "";
  const ids=noticeScopeArgs(scope);
  const global="NOT EXISTS (SELECT 1 FROM avisos_lojas x WHERE x.aviso_id = a.id)";
  return ids.length?global+" OR EXISTS (SELECT 1 FROM avisos_lojas x WHERE x.aviso_id = a.id AND x.loja_id IN ("+ids.map(()=>"?").join(",")+"))":global;
}
