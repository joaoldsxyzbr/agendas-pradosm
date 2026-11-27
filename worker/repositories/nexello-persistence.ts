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
export interface NexelloActor {id:string;sessionVersion:number;}
async function sha256(value:unknown):Promise<string>{
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
}
function canonicalDocs(values:string[]):string[]{return [...new Set(values)].sort();}
function denied():never{throw new Error("NEXELLO_AUTORIDADE_INVALIDA");}

/**
 * Internal persistence primitive, intentionally NOT connected to HTTP.
 * Only call after the server has verified the state evidence and review
 * ownership. A hash is an integrity reference, not evidence authentication.
 * One store/day, new occurrences only. No inferred approval or CD routing.
 * No replacement, reactivation, move, cancellation or update of existing rows.
 */
export async function persistVerifiedNewAppointments(
  db:D1Database,actor:NexelloActor,input:VerifiedNewBatch,now=new Date(),
):Promise<{reviewId:string;replayed:boolean}>{
  const batch=Batch.parse(input);
  if(!Number.isSafeInteger(actor.sessionVersion)||actor.sessionVersion<1)denied();
  const access=await findEffectiveAccess(db,actor.id);
  if(!access||!access.active||access.sessionVersion!==actor.sessionVersion||access.scope.mode!=="all"||
     !access.permissions.has("importacao.ver")||!access.permissions.has("importacao.executar")||
     !((access.profile==="admin"&&!access.customized)||(access.profile==="digitador"&&access.customized)))denied();
  const entries=batch.entries.map(row=>({...row,nfe:canonicalDocs(row.nfe),orders:canonicalDocs(row.orders)}))
    .sort((a,b)=>a.protocol.localeCompare(b.protocol));
  const hash=await sha256([batch.storeId,batch.externalCode,batch.date,batch.expectedAgenda,entries]);
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
        WHERE d.filial_externa=? AND d.doca_externa='' AND l.id=? AND l.ativo=1 AND l.excluido_em IS NULL
      ) THEN ? ELSE NULL END,?,?,?,?,'confirmada',?,?,0,?,?)
    `).bind(actor.id,actor.sessionVersion,batch.externalCode,batch.storeId,batch.reviewId,
      actor.id,batch.date,batch.date,batch.storeId,hash,entries.length,at,at),
  ];
  if(batch.expectedAgenda){
    statements.push(db.prepare(`
      UPDATE agendas SET versao_importacao=CASE WHEN loja_id=? AND data_agenda=? AND status_dia='aberto'
        AND versao_importacao=? THEN versao_importacao+1 ELSE -1 END,
        atualizado_em=?,digitado_em=NULL,digitado_por=NULL WHERE id=?
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
  }
  statements.push(db.prepare(`
    INSERT INTO auditoria(id,usuario_id,acao,entidade,entidade_id,loja_id,agenda_id,depois,detalhes,criado_em)
    VALUES(?,?,'nexello_novos_confirmados','sincronizacao',?,?,?,?,?,?)
  `).bind(crypto.randomUUID(),actor.id,batch.reviewId,batch.storeId,agendaId,
    JSON.stringify({count:entries.length,hash}),"Inclusão incremental de agendamentos revisados.",at));
  const results=await db.batch(statements);
  if(results.length!==statements.length||results.some(result=>!result.success))throw new Error("NEXELLO_RESULTADO_INDETERMINADO");
  return {reviewId:batch.reviewId,replayed:false};
}
