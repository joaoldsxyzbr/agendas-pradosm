import type { NexelloDestination } from "../../shared/nexello-destinations.ts";
type Actor={id:string;sessionVersion:number};
type DestinationRow={filial_externa:string;doca_externa:string;loja_id:string;codigo:string;nome:string;ativo:number;excluido_em:string|null;criado_em:string};
const INTEGRAL="EXISTS(SELECT 1 FROM usuarios u WHERE u.id=? AND u.session_version=? AND u.papel='admin' AND u.ativo=1 AND u.excluido_em IS NULL AND NOT EXISTS(SELECT 1 FROM usuario_acesso a WHERE a.usuario_id=u.id))";
async function requireIntegral(db:D1Database,actor:Actor):Promise<void>{
  if(!Number.isSafeInteger(actor.sessionVersion)||actor.sessionVersion<1||
    !await db.prepare("SELECT 1 WHERE "+INTEGRAL).bind(actor.id,actor.sessionVersion).first())
    throw new Error("NEXELLO_AUTORIDADE_INVALIDA");
}
export async function listNexelloDestinations(db:D1Database,actor:Actor):Promise<NexelloDestination[]>{
  await requireIntegral(db,actor);
  const result=await db.prepare("SELECT d.filial_externa,d.doca_externa,d.loja_id,l.codigo,l.nome,l.ativo,l.excluido_em,d.criado_em FROM nexello_destinos d JOIN lojas l ON l.id=d.loja_id ORDER BY d.filial_externa,d.doca_externa LIMIT 501").all<DestinationRow>();
  if(!result.success||!result.results||result.results.length>500)throw new Error("NEXELLO_DESTINOS_LIMITE");
  return result.results.map(row=>({externalCode:row.filial_externa,dock:row.doca_externa,storeId:row.loja_id,
    storeCode:row.codigo,storeName:row.nome,active:row.ativo===1&&row.excluido_em===null&&(row.doca_externa!==''||row.codigo===row.filial_externa),createdAt:row.criado_em}));
}
/** Explicit administrator decision, identical code only. No silent remapping. */
export async function linkSameCodeDestination(db:D1Database,actor:Actor,storeId:string,now=new Date()):Promise<{created:boolean}>{
  await requireIntegral(db,actor);
  const store=await db.prepare("SELECT id,codigo FROM lojas WHERE id=? AND ativo=1 AND excluido_em IS NULL")
    .bind(storeId).first<{id:string;codigo:string}>();
  if(!store||!/^F\d{1,3}$/.test(store.codigo))throw new Error("NEXELLO_DESTINO_INVALIDO");
  const existing=await db.prepare("SELECT loja_id FROM nexello_destinos WHERE filial_externa=? AND doca_externa=''")
    .bind(store.codigo).first<{loja_id:string}>();
  if(existing){
    if(existing.loja_id!==storeId)throw new Error("NEXELLO_DESTINO_CONFLITO");
    return {created:false};
  }
  const at=now.toISOString();
  const results=await db.batch([
    db.prepare("INSERT INTO nexello_destinos(filial_externa,doca_externa,loja_id,criado_por,criado_em) VALUES(CASE WHEN "+INTEGRAL+
      " AND EXISTS(SELECT 1 FROM lojas WHERE id=? AND codigo=? AND ativo=1 AND excluido_em IS NULL) THEN ? ELSE NULL END,'',?,?,?)")
      .bind(actor.id,actor.sessionVersion,storeId,store.codigo,store.codigo,storeId,actor.id,at),
    db.prepare("INSERT INTO auditoria(id,usuario_id,acao,entidade,entidade_id,loja_id,depois,detalhes,criado_em) VALUES(?,?,'nexello_destino_vinculado','loja',?,?,?,?,?)")
      .bind(crypto.randomUUID(),actor.id,storeId,storeId,JSON.stringify({externalCode:store.codigo,dock:""}),"Vínculo Nexello explícito por código da filial.",at),
  ]);
  if(results.length!==2||results.some(result=>!result.success))throw new Error("NEXELLO_DESTINO_FALHOU");
  return {created:true};
}
