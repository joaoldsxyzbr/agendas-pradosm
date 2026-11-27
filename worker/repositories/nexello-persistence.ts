import { z } from "zod";
import { AGENDA_DOCUMENT_TYPES } from "../../shared/agenda.ts";
import { businessDate } from "../../shared/time.ts";
import { findEffectiveAccess } from "./access.ts";

const Hash=z.string().regex(/^[0-9a-f]{64}$/);
const Id=z.string().min(1).max(128);
const DateCode=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const d=new Date(value+"T00:00:00Z");
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
});
const Time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const Docs=z.array(z.string().regex(/^\d{1,80}$/)).max(100);
const Entry=z.object({
  protocol:z.string().regex(/^\d{6,20}$/),
  startTime:Time,endTime:Time,supplier:z.string().trim().min(1).max(200),
  type:z.enum(AGENDA_DOCUMENT_TYPES),nfe:Docs,orders:Docs,
  externalState:z.literal("confirmed"),
  evidence:z.enum(["csv_situacao","api_estado","revisao_admin"]),
  evidenceHash:Hash,
}).strict().refine(row=>row.startTime<row.endTime);
const Batch=z.object({
  reviewId:Id,storeId:Id,externalCode:z.string().regex(/^F\d{1,3}$/),
  date:DateCode,
  expectedAgenda:z.object({id:Id,version:z.number().int().nonnegative()}).strict().nullable(),
  entries:z.array(Entry).min(1).max(50),
}).strict().refine(value=>new Set(value.entries.map(row=>row.protocol)).size===value.entries.length);
export type VerifiedNewBatch=z.input<typeof Batch>;
export interface NexelloActor {id:string;sessionVersion:number;sessionKey:string;}
const SessionKey=/^sid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function sha256(value:unknown):Promise<string>{
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
}
function canonicalDocs(values:string[]):string[]{return [...new Set(values)].sort();}
function denied():never{throw new Error("NEXELLO_AUTORIDADE_INVALIDA");}

const REVIEW_TTL_MS=10*60*1000;
const MAX_PENDING_PER_ACTOR=10;
const MAX_REVIEW_BYTES=262144;
async function requireActor(db:D1Database,actor:NexelloActor):Promise<void>{
  if(!Number.isSafeInteger(actor.sessionVersion)||actor.sessionVersion<1||!SessionKey.test(actor.sessionKey)||!actor.sessionKey.startsWith("sid:"))denied();
  if(await db.prepare("SELECT 1 FROM sessoes_revogadas WHERE session_key=?").bind(actor.sessionKey).first())denied();
  const access=await findEffectiveAccess(db,actor.id);
  if(!access||!access.active||access.sessionVersion!==actor.sessionVersion||access.scope.mode!=="all"||
     !access.permissions.has("importacao.ver")||!access.permissions.has("importacao.executar")||
     !((access.profile==="admin"&&!access.customized)||(access.profile==="digitador"&&access.customized)))denied();
}
async function canonicalBatch(batch:z.output<typeof Batch>){
  const entries=batch.entries.map(row=>({...row,nfe:canonicalDocs(row.nfe),orders:canonicalDocs(row.orders)}))
    .sort((a,b)=>a.protocol.localeCompare(b.protocol));
  const hash=await sha256([batch.storeId,batch.externalCode,batch.date,batch.expectedAgenda,entries]);
  return {entries,hash};
}

type PendingReview={usuario_id:string;versao_sessao:number;chave_sessao:string|null;hash_conteudo:string;conteudo:string;expira_em:string};
async function readPending(db:D1Database,id:string):Promise<PendingReview|null>{
  return db.prepare("SELECT usuario_id,versao_sessao,chave_sessao,hash_conteudo,conteudo,expira_em FROM nexello_revisoes_pendentes WHERE id=?")
    .bind(id).first<PendingReview>();
}

/** Internal only. Caller must obtain and verify evidence on the server.
 * Generate a fresh identifier, capture the current agenda version, and
 * persist normalized fields, not raw files or tokens. */
export async function prepareVerifiedReview(db:D1Database,actor:NexelloActor,
  input:Omit<VerifiedNewBatch,"reviewId"|"expectedAgenda">,now=new Date()){
  await requireActor(db,actor);
  const agenda=await db.prepare("SELECT a.id,a.versao_importacao,a.status_dia,CASE WHEN a.digitado_em IS NOT NULL OR EXISTS(SELECT 1 FROM agenda_digitacao_fornecedor d WHERE d.agenda_id=a.id AND d.digitado_em IS NOT NULL) THEN 1 ELSE 0 END AS digitacao_protegida FROM agendas a WHERE a.loja_id=? AND a.data_agenda=?")
    .bind(input.storeId,input.date).first<{id:string;versao_importacao:number;status_dia:string;digitacao_protegida:number}>();
  if(agenda&&agenda.status_dia!=="aberto")throw new Error("NEXELLO_DATA_ENCERRADA");
  if(agenda&&agenda.digitacao_protegida!==0)throw new Error("NEXELLO_DIGITACAO_PROTEGIDA");
  const batch=Batch.parse({...input,reviewId:crypto.randomUUID(),expectedAgenda:agenda?{id:agenda.id,version:agenda.versao_importacao}:null});
  if(batch.date<businessDate(now))throw new Error("NEXELLO_DATA_ENCERRADA");
  const mapping=await db.prepare("SELECT 1 FROM nexello_destinos d JOIN lojas l ON l.id=d.loja_id WHERE d.filial_externa=? AND d.doca_externa='' AND l.id=? AND l.codigo=d.filial_externa AND l.ativo=1 AND l.excluido_em IS NULL")
    .bind(batch.externalCode,batch.storeId).first();
  if(!mapping)throw new Error("NEXELLO_DESTINO_INVALIDO");
  const {entries,hash}=await canonicalBatch(batch);
  const protocols=entries.map(row=>row.protocol);
  const conflict=await db.prepare("SELECT 1 FROM agendamentos WHERE protocolo IN ("+protocols.map(()=>"?").join(",")+") LIMIT 1").bind(...protocols).first();
  if(conflict)throw new Error("NEXELLO_PROTOCOLO_EXISTENTE");
  const payload=JSON.stringify({...batch,entries});
  if(new TextEncoder().encode(payload).byteLength>MAX_REVIEW_BYTES)throw new Error("NEXELLO_REVISAO_GRANDE");
  await pruneExpiredNexelloReviews(db,now);
  const expiresAt=new Date(now.getTime()+REVIEW_TTL_MS).toISOString();
  const result=await db.prepare("INSERT INTO nexello_revisoes_pendentes(id,usuario_id,versao_sessao,hash_conteudo,conteudo,criado_em,expira_em,chave_sessao) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM nexello_revisoes_pendentes WHERE usuario_id=? AND expira_em>?) < ?")
    .bind(batch.reviewId,actor.id,actor.sessionVersion,hash,payload,now.toISOString(),expiresAt,actor.sessionKey,actor.id,now.toISOString(),MAX_PENDING_PER_ACTOR).run();
  if(!result.success)throw new Error("NEXELLO_REVISAO_FALHOU");
  if(result.meta?.changes!==1)throw new Error("NEXELLO_REVISAO_LIMITE");
  return {reviewId:batch.reviewId,expiresAt,hash,entryCount:entries.length,storeId:batch.storeId,date:batch.date,entries};
}

/** The browser must never supply the batch or assert its own evidence. */
export async function confirmPreparedReview(db:D1Database,actor:NexelloActor,reviewId:string,expectedHash:string,now=new Date()){
  Id.parse(reviewId);Hash.parse(expectedHash);
  await requireActor(db,actor);
  const draft=await readPending(db,reviewId);
  if(!draft){
    const done=await db.prepare("SELECT usuario_id,hash_conteudo,situacao FROM sincronizacoes_nexello WHERE id=?")
      .bind(reviewId).first<{usuario_id:string;hash_conteudo:string;situacao:string}>();
    if(done?.usuario_id===actor.id&&done.hash_conteudo===expectedHash&&done.situacao==="confirmada")
      return {reviewId,replayed:true};
    throw new Error("NEXELLO_REVISAO_INDISPONIVEL");
  }
  if(draft.usuario_id!==actor.id||draft.versao_sessao!==actor.sessionVersion||draft.chave_sessao!==actor.sessionKey||
    draft.expira_em<=now.toISOString()||draft.hash_conteudo!==expectedHash)
    throw new Error("NEXELLO_REVISAO_INDISPONIVEL");
  const batch=Batch.parse(JSON.parse(draft.conteudo) as unknown);
  if(batch.reviewId!==reviewId||(await canonicalBatch(batch)).hash!==expectedHash)
    throw new Error("NEXELLO_REVISAO_CONFLITO");
  return persistVerifiedNewAppointments(db,actor,batch,now);
}
export async function cancelPreparedReview(db:D1Database,actor:NexelloActor,reviewId:string):Promise<boolean>{
  Id.parse(reviewId);await requireActor(db,actor);
  const result=await db.prepare("DELETE FROM nexello_revisoes_pendentes WHERE id=? AND usuario_id=? AND versao_sessao=? AND chave_sessao=? AND NOT EXISTS(SELECT 1 FROM sessoes_revogadas WHERE session_key=?)")
    .bind(reviewId,actor.id,actor.sessionVersion,actor.sessionKey,actor.sessionKey).run();
  if(!result.success)throw new Error("NEXELLO_REVISAO_FALHOU");
  return result.meta?.changes===1;
}
export async function pruneExpiredNexelloReviews(db:D1Database,now=new Date()):Promise<void>{
  const result=await db.prepare("DELETE FROM nexello_revisoes_pendentes WHERE id IN (SELECT id FROM nexello_revisoes_pendentes WHERE expira_em<=? ORDER BY expira_em LIMIT 100)")
    .bind(now.toISOString()).run();
  if(!result.success)throw new Error("NEXELLO_REVISAO_FALHOU");
}

/**
 * Internal persistence primitive, intentionally NOT connected to HTTP.
 * Only call after the server has verified the state evidence and review
 * ownership. A hash is an integrity reference, not evidence authentication.
 * One store/day, new occurrences only. No inferred approval or CD routing.
 * No replacement, reactivation, move, cancellation or update of existing rows.
 */
async function persistVerifiedNewAppointments(
  db:D1Database,actor:NexelloActor,input:VerifiedNewBatch,now=new Date(),
):Promise<{reviewId:string;replayed:boolean}>{
  const batch=Batch.parse(input);
  await requireActor(db,actor);
  const {entries,hash}=await canonicalBatch(batch);
  const previous=await db.prepare("SELECT usuario_id,hash_conteudo,situacao FROM sincronizacoes_nexello WHERE id=?")
    .bind(batch.reviewId).first<{usuario_id:string;hash_conteudo:string;situacao:string}>();
  if(previous){
    if(previous.usuario_id===actor.id&&previous.hash_conteudo===hash&&previous.situacao==="confirmada")
      return {reviewId:batch.reviewId,replayed:true};
    throw new Error("NEXELLO_REVISAO_CONFLITO");
  }
  if(batch.date<businessDate(now))throw new Error("NEXELLO_DATA_ENCERRADA");
  const at=now.toISOString();
  const agendaId=batch.expectedAgenda?.id??crypto.randomUUID();
  // A NULL primary key aborts the entire batch on stale authority/mapping.
  // The session version is advanced by access configuration changes.
  const statements:D1PreparedStatement[]=[
    db.prepare(`
      INSERT INTO sincronizacoes_nexello(id,usuario_id,data_inicio,data_fim,loja_id,situacao,
        hash_conteudo,linhas_lidas,conflitos,criado_em,finalizado_em)
      VALUES(CASE WHEN EXISTS(
        SELECT 1 FROM usuarios u LEFT JOIN usuario_acesso x ON x.usuario_id=u.id
        WHERE u.id=? AND u.session_version=? AND u.excluido_em IS NULL
        AND ((u.papel='admin' AND u.ativo=1 AND x.usuario_id IS NULL) OR
          (x.perfil='digitador' AND x.ativo=1 AND x.escopo='todas' AND NOT EXISTS(
            SELECT 1 FROM usuario_acesso_excecoes e WHERE e.usuario_id=u.id
            AND e.efeito='deny' AND e.permissao IN ('importacao.ver','importacao.executar'))))
      ) AND EXISTS(
        SELECT 1 FROM nexello_destinos d JOIN lojas l ON l.id=d.loja_id
        WHERE d.filial_externa=? AND d.doca_externa='' AND l.id=? AND l.codigo=d.filial_externa AND l.ativo=1 AND l.excluido_em IS NULL
      ) AND EXISTS(SELECT 1 FROM nexello_revisoes_pendentes r WHERE r.id=? AND r.usuario_id=? AND r.versao_sessao=? AND r.chave_sessao=? AND r.hash_conteudo=? AND r.expira_em>?)
      AND NOT EXISTS(SELECT 1 FROM sessoes_revogadas WHERE session_key=?)
      THEN ? ELSE NULL END,?,?,?,?,'confirmada',?,?,0,?,?)
    `).bind(actor.id,actor.sessionVersion,batch.externalCode,batch.storeId,batch.reviewId,actor.id,actor.sessionVersion,actor.sessionKey,hash,at,actor.sessionKey,batch.reviewId,
      actor.id,batch.date,batch.date,batch.storeId,hash,entries.length,at,at),
  ];
  if(batch.expectedAgenda){
    statements.push(db.prepare(`
      UPDATE agendas SET versao_importacao=CASE WHEN loja_id=? AND data_agenda=? AND status_dia='aberto' AND versao_importacao=? AND digitado_em IS NULL AND NOT EXISTS(SELECT 1 FROM agenda_digitacao_fornecedor d WHERE d.agenda_id=agendas.id AND d.digitado_em IS NOT NULL) THEN versao_importacao+1 ELSE -1 END, atualizado_em=? WHERE id=?
    `).bind(batch.storeId,batch.date,batch.expectedAgenda.version,at,agendaId));
  }else{
    statements.push(db.prepare(`
      INSERT INTO agendas(id,loja_id,data_agenda,arquivo_original,criado_por,criado_em,atualizado_em,versao_importacao)
      VALUES(?,?,?,'Nexello',?,?,?,1)
    `).bind(agendaId,batch.storeId,batch.date,actor.id,at,at));
  }
  for(const entry of entries){
    const id=crypto.randomUUID();
    const rowHash=await sha256([batch.externalCode,batch.date,entry]);
    // Never equate protocol uniqueness in the source with identity. Any local
    // occurrence (including inactive/manual or in another store) blocks insertion.
    statements.push(db.prepare(`
      INSERT INTO agendamentos(id,agenda_id,protocolo,horario_inicio,horario_fim,fornecedor,
        tipo,nfe,pedidos,origem,status,ativo,criado_em,atualizado_em)
      VALUES(CASE WHEN NOT EXISTS(SELECT 1 FROM agendamentos WHERE protocolo=?)
        AND EXISTS(SELECT 1 FROM agendas WHERE id=? AND loja_id=? AND data_agenda=? AND status_dia='aberto')
        THEN ? ELSE NULL END,?,?,?,?,?,?,?,?,'importado','aguardando',1,?,?)
    `).bind(entry.protocol,agendaId,batch.storeId,batch.date,id,agendaId,entry.protocol,
      entry.startTime,entry.endTime,entry.supplier,entry.type,JSON.stringify(entry.nfe),JSON.stringify(entry.orders),at,at));
    statements.push(db.prepare(`
      INSERT INTO agendamento_nexello(agendamento_id,sincronizacao_id,estado_externo,evidencia,observado_em,hash_conteudo)
      VALUES(?,?,'confirmado',?,?,?)
    `).bind(id,batch.reviewId,entry.evidence,at,rowHash));
    statements.push(db.prepare(`
      INSERT INTO nexello_evidencias(sincronizacao_id,agendamento_id,fonte,estado_externo,hash_evidencia,hash_registro,verificado_em)
      VALUES(?,?,?,'confirmado',?,?,?)
    `).bind(batch.reviewId,id,entry.evidence,entry.evidenceHash,rowHash,at));
  }
  statements.push(db.prepare(`
    INSERT INTO auditoria(id,usuario_id,acao,entidade,entidade_id,loja_id,agenda_id,depois,detalhes,criado_em)
    VALUES(?,?,'nexello_novos_confirmados','sincronizacao',?,?,?,?,?,?)
  `).bind(crypto.randomUUID(),actor.id,batch.reviewId,batch.storeId,agendaId,
    JSON.stringify({count:entries.length,hash}),"Inclusão incremental de agendamentos revisados.",at));
  statements.push(db.prepare("DELETE FROM nexello_revisoes_pendentes WHERE id=? AND usuario_id=? AND hash_conteudo=?").bind(batch.reviewId,actor.id,hash));
  try {
    const results=await db.batch(statements);
    if(results.length!==statements.length||results.some(result=>!result.success))throw new Error("NEXELLO_RESULTADO_INDETERMINADO");
  } catch (error: unknown) {
    // Network ambiguity or concurrent replay: only the exact committed review
    // belonging to this actor can be treated as success.
    const committed=await db.prepare("SELECT usuario_id,hash_conteudo,situacao FROM sincronizacoes_nexello WHERE id=?")
      .bind(batch.reviewId).first<{usuario_id:string;hash_conteudo:string;situacao:string}>();
    if(committed?.usuario_id===actor.id&&committed.hash_conteudo===hash&&committed.situacao==="confirmada")
      return {reviewId:batch.reviewId,replayed:true};
    throw error;
  }
  return {reviewId:batch.reviewId,replayed:false};
}
