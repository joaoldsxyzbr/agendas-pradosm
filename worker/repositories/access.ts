// Resolução única de acesso, compartilhada pelas rotas e pela sessão.
import { isAccessProfile, resolvePermissions, type AccessProfile, type Permission, type PermissionOverride, type StoreScope } from "../../shared/permissions.ts";
import { auditStatement } from "./audit.ts";

export interface EffectiveAccess {
  profile: AccessProfile;
  permissions: ReadonlySet<Permission>;
  scope: StoreScope;
  overrides: readonly PermissionOverride[];
  customized: boolean;
  active: boolean;
  sessionVersion: number;
}
export function decodeAccess(row: {
  papel: unknown; loja_id: unknown; session_version: unknown;
  perfil: unknown; escopo: unknown; lojas: unknown; excecoes: unknown; ativo_efetivo?:unknown;
}): EffectiveAccess | null {
  if (!Number.isSafeInteger(row.session_version) || Number(row.session_version)<1) return null;
  if(row.ativo_efetivo!==undefined&&row.ativo_efetivo!==0&&row.ativo_efetivo!==1)return null;
  const customized=row.perfil!==null;
  const profile=customized?row.perfil:row.papel;
  if(!isAccessProfile(profile)||(!customized&&profile==="digitador"))return null;
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
  return {profile,permissions:effective,scope,overrides,customized,active:row.ativo_efetivo!==0,sessionVersion:Number(row.session_version)};
}

// Uma leitura consistente: configurações, vínculos e exceções no mesmo snapshot SQL.
// Não concede privilégios caso a conta esteja inativa ou removida.
const ACCESS_SELECT=`
    SELECT u.id,u.nome,u.login,u.ativo,u.papel,u.loja_id,u.session_version,a.perfil,a.escopo,CASE WHEN a.usuario_id IS NULL THEN u.ativo ELSE a.ativo END AS ativo_efetivo,
      COALESCE((SELECT json_group_array(x.loja_id) FROM
        (SELECT loja_id FROM usuario_acesso_lojas WHERE usuario_id=u.id ORDER BY loja_id) x),'[]') AS lojas,
      COALESCE((SELECT json_group_array(json_object('permission',x.permissao,'effect',x.efeito)) FROM
        (SELECT permissao,efeito FROM usuario_acesso_excecoes WHERE usuario_id=u.id ORDER BY permissao) x),'[]') AS excecoes
    FROM usuarios u LEFT JOIN usuario_acesso a ON a.usuario_id=u.id`;
export async function findEffectiveAccess(db: D1Database,userId:string,includeInactive=false):Promise<EffectiveAccess|null>{
  const row=await db.prepare(ACCESS_SELECT+`
    WHERE u.id=? AND u.excluido_em IS NULL AND (?=1 OR CASE WHEN a.usuario_id IS NULL THEN u.ativo ELSE a.ativo END=1)
  `).bind(userId,includeInactive?1:0).first<Parameters<typeof decodeAccess>[0]>();
  return row?decodeAccess(row):null;
}

// Evita uma consulta D1 adicional por usuário e mantém a listagem sem hashes de senha.
export async function listUsersWithAccess(db:D1Database){
  const rows=await db.prepare(ACCESS_SELECT+" WHERE u.excluido_em IS NULL ORDER BY u.nome COLLATE NOCASE,u.id").all<Parameters<typeof decodeAccess>[0]&{id:string;nome:string;login:string;ativo:number}>();
  return rows.results.map(row=>({user:row,access:decodeAccess(row)}));
}

export interface AccessChange {
  profile: AccessProfile;
  scope: StoreScope;
  overrides: readonly PermissionOverride[];
}
function accessAudit(access: EffectiveAccess | AccessChange) {
  return {profile:access.profile,scope:access.scope,overrides:[...access.overrides]};
}
export function validChange(input:AccessChange):boolean {
  if(!isAccessProfile(input.profile)||!resolvePermissions(input.profile,input.overrides))return false;
  const scope=input.scope;
  if(!scope||typeof scope!=="object")return false;
  if(scope.mode==="all")return !("storeIds" in scope);
  return scope.mode==="assigned"&&Array.isArray(scope.storeIds)&&scope.storeIds.length<=50&&
    new Set(scope.storeIds).size===scope.storeIds.length&&scope.storeIds.every(id=>typeof id==="string"&&id.length>0&&id===id.trim());
}

// Escrita transacional: os guards, filtros de loja e o rollback seguro são obrigatórios.
// A conta delegadora precisa ser um administrador integral sem customização.
export async function saveAccessConfiguration(db:D1Database, actor:{id:string;sessionVersion:number},
  targetId:string,expectedVersion:number,input:AccessChange):Promise<EffectiveAccess>{
  if(actor.id===targetId||!Number.isSafeInteger(actor.sessionVersion)||actor.sessionVersion<1||
      !Number.isSafeInteger(expectedVersion)||expectedVersion<1||!validChange(input))
    throw new Error("ACESSO_CONFIG_INVALIDA");
  const before=await findEffectiveAccess(db,targetId,true);
  if(!before||before.sessionVersion!==expectedVersion)throw new Error("ACESSO_CONFLITO");
  const now=new Date().toISOString();
  const statements:D1PreparedStatement[]=[
    // Se o CAS/autoridade falhar, a constraint NOT NULL aborta todo o batch.
    db.prepare(`UPDATE usuarios SET ativo=0,session_version=CASE WHEN session_version=? AND excluido_em IS NULL
       AND EXISTS (SELECT 1 FROM usuarios actor WHERE actor.id=? AND actor.session_version=? AND actor.papel='admin'
         AND actor.ativo=1 AND actor.excluido_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM usuario_acesso a WHERE a.usuario_id=actor.id))
      THEN session_version+1 ELSE NULL END,atualizado_em=? WHERE id=?`)
      .bind(expectedVersion,actor.id,actor.sessionVersion,now,targetId),
    db.prepare("DELETE FROM conferente_presenca WHERE usuario_id=?").bind(targetId),
    db.prepare("DELETE FROM usuario_acesso_lojas WHERE usuario_id=?").bind(targetId),
    db.prepare("DELETE FROM usuario_acesso_excecoes WHERE usuario_id=?").bind(targetId),
    db.prepare(`INSERT INTO usuario_acesso(usuario_id,perfil,escopo,ativo) VALUES (?,?,?,?)
      ON CONFLICT(usuario_id) DO UPDATE SET perfil=excluded.perfil,escopo=excluded.escopo,ativo=excluded.ativo`)
      .bind(targetId,input.profile,input.scope.mode==="all"?"todas":"vinculadas",before.active?1:0),
  ];
  if(input.scope.mode==="assigned"){
    for(const storeId of input.scope.storeIds) statements.push(
      db.prepare(`INSERT INTO usuario_acesso_lojas(usuario_id,loja_id) VALUES (?,(
        SELECT id FROM lojas WHERE id=? AND ativo=1 AND excluido_em IS NULL))`).bind(targetId,storeId));
  }
  for(const override of input.overrides) statements.push(
    db.prepare("INSERT INTO usuario_acesso_excecoes(usuario_id,permissao,efeito) VALUES (?,?,?)")
      .bind(targetId,override.permission,override.effect));
  statements.push(auditStatement(db,{
    userId:actor.id,action:"usuario_acesso_atualizado",entity:"usuario",entityId:targetId,
    before:accessAudit(before),after:accessAudit(input),details:"Configuração de acesso atualizada.",createdAt:now,
  }));
  await db.batch(statements);
  const after=await findEffectiveAccess(db,targetId,true);
  if(!after||after.sessionVersion!==expectedVersion+1)throw new Error("ACESSO_CONFLITO");
  return after;
}

export function accessInsertStatements(db:D1Database,targetId:string,input:AccessChange):D1PreparedStatement[]{
  if(!validChange(input))throw new Error("ACESSO_CONFIG_INVALIDA");
  const statements=[db.prepare("INSERT INTO usuario_acesso(usuario_id,perfil,escopo) VALUES (?,?,?)").bind(targetId,input.profile,input.scope.mode==="all"?"todas":"vinculadas")];
  if(input.scope.mode==="assigned")for(const id of input.scope.storeIds)statements.push(db.prepare("INSERT INTO usuario_acesso_lojas(usuario_id,loja_id) VALUES (?,(SELECT id FROM lojas WHERE id=? AND ativo=1 AND excluido_em IS NULL))").bind(targetId,id));
  for(const override of input.overrides)statements.push(db.prepare("INSERT INTO usuario_acesso_excecoes(usuario_id,permissao,efeito) VALUES (?,?,?)").bind(targetId,override.permission,override.effect));
  return statements;
}
export function accessJson(access:EffectiveAccess){
  return {profile:access.profile,scope:access.scope,overrides:access.overrides,permissions:[...access.permissions],customized:access.customized,active:access.active,sessionVersion:access.sessionVersion};
}
