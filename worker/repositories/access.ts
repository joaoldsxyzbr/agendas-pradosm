// Resolução única de acesso. Preparatória: não habilita contas personalizadas nas rotas.
import { isAccessProfile, resolvePermissions, type AccessProfile, type Permission, type PermissionOverride, type StoreScope } from "../../shared/permissions.ts";

export interface EffectiveAccess {
  profile: AccessProfile;
  permissions: ReadonlySet<Permission>;
  scope: StoreScope;
  overrides: readonly PermissionOverride[];
  customized: boolean;
  sessionVersion: number;
}
export function decodeAccess(row: {
  papel: unknown; loja_id: unknown; session_version: unknown;
  perfil: unknown; escopo: unknown; lojas: unknown; excecoes: unknown;
}): EffectiveAccess | null {
  if (!Number.isSafeInteger(row.session_version) || Number(row.session_version)<1) return null;
  const customized=row.perfil!==null;
  const profile=customized?row.perfil:row.papel;
  if(!isAccessProfile(profile)||(!customized&&profile==="agendador"))return null;
  let scope:StoreScope;
  let overrides:PermissionOverride[]=[];
  if(!customized){
    if(row.escopo!==null)return null;
    if(profile==="conferente"){
      if(typeof row.loja_id!=="string"||!row.loja_id.trim()||row.loja_id!==row.loja_id.trim())return null;
      scope={mode:"assigned",storeIds:[row.loja_id]};
    }else scope={mode:"all"};
  }else{
    try{
      if(typeof row.lojas!=="string"||typeof row.excecoes!=="string")return null;
      const ids:unknown=JSON.parse(row.lojas), parsed:unknown=JSON.parse(row.excecoes);
      if(!Array.isArray(ids)||ids.some(id=>typeof id!=="string"||!id.trim()||id!==id.trim())||
         new Set(ids).size!==ids.length||!Array.isArray(parsed))return null;
      if(row.escopo==="todas"&&ids.length===0)scope={mode:"all"};
      else if(row.escopo==="vinculadas")scope={mode:"assigned",storeIds:ids};
      else return null;
      overrides=parsed;
    }catch{return null;}
  }
  const effective=resolvePermissions(profile,overrides);
  if(!effective)return null;
  return {profile,permissions:effective,scope,overrides,customized,sessionVersion:Number(row.session_version)};
}

// Uma leitura consistente: configurações, vínculos e exceções no mesmo snapshot SQL.
// Não concede privilégios caso a conta esteja inativa ou removida.
export async function findEffectiveAccess(db: D1Database,userId:string):Promise<EffectiveAccess|null>{
  const row=await db.prepare(`
    SELECT u.papel,u.loja_id,u.session_version,a.perfil,a.escopo,
      COALESCE((SELECT json_group_array(x.loja_id) FROM
        (SELECT loja_id FROM usuario_acesso_lojas WHERE usuario_id=u.id ORDER BY loja_id) x),'[]') AS lojas,
      COALESCE((SELECT json_group_array(json_object('permission',x.permissao,'effect',x.efeito)) FROM
        (SELECT permissao,efeito FROM usuario_acesso_excecoes WHERE usuario_id=u.id ORDER BY permissao) x),'[]') AS excecoes
    FROM usuarios u LEFT JOIN usuario_acesso a ON a.usuario_id=u.id
    WHERE u.id=? AND u.ativo=1 AND u.excluido_em IS NULL
  `).bind(userId).first<Parameters<typeof decodeAccess>[0]>();
  return row?decodeAccess(row):null;
}
