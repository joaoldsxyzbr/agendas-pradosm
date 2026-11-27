// Eventos limitados a códigos estáveis. Nunca armazenar conteúdo de arquivos, URL, stack, mensagens ou tokens.
export const DIAGNOSTIC_EVENTS = [
  "IMPORT_SELECTED", "IMPORT_PREVIEW_READY", "IMPORT_VALIDATION_FAILED",
  "IMPORT_READ_FAILED", "IMPORT_REQUEST_FAILED", "IMPORT_SUCCEEDED",
  "IMPORT_DROP_REJECTED", "BROWSER_EXCEPTION", "BROWSER_REJECTION",
  "WORKER_EXCEPTION"
] as const;
const eventSet = new Set<string>(DIAGNOSTIC_EVENTS);
const levels = new Set(["info", "warning", "error"]);
const operations = new Set(["importacao", "aplicativo", "api"]);
const formats = new Set(["csv", "pdf", "outro"]);
const sources = new Set(["browser", "worker"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type DiagnosticData={origem:unknown;nivel:unknown;evento:unknown;operacao:unknown;formato?:unknown;
  quantidade?:unknown;duracaoMs?:unknown;httpStatus?:unknown;correlacao?:unknown;userId?:string|null;storeId?:string|null};
interface DiagnosticRow {
  id:string;usuario_id:string|null;usuario_nome:string|null;origem:string;nivel:string;evento:string;operacao:string;
  formato:string|null;quantidade:number|null;http_status:number|null;duracao_ms:number|null;correlacao:string;criado_em:string;loja_id:string|null;
}
function allowed(value:unknown,values:ReadonlySet<string>):value is string{
  return typeof value==="string"&&values.has(value);
}
function boundedInt(value:unknown,min:number,max:number):number|null{
  if(value==null)return null;
  if(typeof value!=="number"||!Number.isInteger(value)||value<min||value>max)throw new TypeError("Métrica de diagnóstico inválida");
  return value;
}
export function normalizeDiagnostic(input:DiagnosticData) {
  if(!input||!allowed(input.evento,eventSet)||!allowed(input.nivel,levels)||
    !allowed(input.operacao,operations)||!allowed(input.origem,sources))throw new TypeError("Evento de diagnóstico inválido");
  const formato=input.formato??null;
  if(formato!==null&&!allowed(formato,formats))throw new TypeError("Formato inválido");
  return {
    origem:input.origem,nivel:input.nivel,evento:input.evento,operacao:input.operacao,formato,
    quantidade:boundedInt(input.quantidade,0,700),duracaoMs:boundedInt(input.duracaoMs,0,120000),
    httpStatus:boundedInt(input.httpStatus,100,599),
    correlacao:typeof input.correlacao==="string"&&uuid.test(input.correlacao)?input.correlacao:crypto.randomUUID()
  };
}
async function insertDiagnostic(db:D1Database,data:DiagnosticData,limitBrowser:boolean,now:Date){
  const item=normalizeDiagnostic(data);
  if(limitBrowser&&(item.origem!=="browser"||!data.userId))throw new TypeError("Diagnóstico autenticado obrigatório");
  const id=crypto.randomUUID();
  const values=[id,data.userId??null,data.storeId??null,item.origem,item.nivel,item.evento,item.operacao,
    item.formato,item.quantidade,item.duracaoMs,item.httpStatus,item.correlacao,now.toISOString()];
  const insert="INSERT INTO diagnosticos (id,usuario_id,loja_id,origem,nivel,evento,operacao,formato,quantidade,duracao_ms,http_status,correlacao,criado_em) ";
  // O limite é avaliado no mesmo statement da gravação; requisições concorrentes
  // não podem ultrapassá-lo por uma leitura anterior desatualizada.
  const statement=limitBrowser?
    db.prepare(insert+"SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM diagnosticos WHERE usuario_id=? AND origem='browser' AND criado_em>=?)<30")
      .bind(...values,data.userId,new Date(now.getTime()-60000).toISOString()):
    db.prepare(insert+"VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...values);
  const result=await statement.run();
  if(!result.success||(result.meta?.changes!==1&&(!limitBrowser||result.meta?.changes!==0)))throw new Error("DIAGNOSTICO_GRAVACAO_FALHOU");
  return result.meta?.changes===1?{id,correlacao:item.correlacao}:null;
}
export async function recordDiagnostic(db:D1Database,data:DiagnosticData){
  const result=await insertDiagnostic(db,data,false,new Date());
  if(!result)throw new Error("DIAGNOSTICO_GRAVACAO_FALHOU");
  return result;
}
export function recordBrowserDiagnostic(db:D1Database,data:DiagnosticData,now=new Date()){
  return insertDiagnostic(db,data,true,now);
}
export async function recordDiagnosticSafe(db:D1Database,data:DiagnosticData){
  try{return await recordDiagnostic(db,data);}
  catch{console.warn("Diagnostic persistence unavailable");return null;}
}
export async function listDiagnostics(db:D1Database,filters:{nivel?:string;operacao?:string;origem?:string;userId?:string;storeId?:string;date?:string;limit?:number}={}):Promise<DiagnosticRow[]>{
  const clauses:string[]=[],values:(string|number)[]=[];
  if(filters.nivel){clauses.push("d.nivel = ?");values.push(filters.nivel);}
  if(filters.operacao){clauses.push("d.operacao = ?");values.push(filters.operacao);}
  if(filters.origem){clauses.push("d.origem = ?");values.push(filters.origem);}
  if(filters.userId){clauses.push("d.usuario_id = ?");values.push(filters.userId);}
  if(filters.storeId){clauses.push("d.loja_id = ?");values.push(filters.storeId);}
  if(filters.date){
    const start=new Date(filters.date+"T00:00:00.000Z");
    if(!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==filters.date)throw new TypeError("Data inválida");
    clauses.push("d.criado_em >= ? AND d.criado_em < ?");
    values.push(start.toISOString(),new Date(start.getTime()+86400000).toISOString());
  }
  const limit=Math.min(200,Math.max(1,filters.limit??100));
  const where=clauses.length?"WHERE "+clauses.join(" AND "):"";
  const result=await db.prepare("SELECT d.id,d.usuario_id,u.nome AS usuario_nome,d.origem,d.nivel,d.evento,d.operacao,d.formato,d.quantidade,d.http_status,d.duracao_ms,d.correlacao,d.criado_em,d.loja_id FROM diagnosticos d LEFT JOIN usuarios u ON u.id=d.usuario_id "+where+" ORDER BY d.criado_em DESC,d.id DESC LIMIT ?")
    .bind(...values,limit).all<DiagnosticRow>();
  if(!result.success||!result.results)throw new Error("DIAGNOSTICO_CONSULTA_FALHOU");
  return result.results;
}
export async function pruneDiagnostics(db:D1Database,now=new Date()):Promise<void>{
  const result=await db.prepare("DELETE FROM diagnosticos WHERE criado_em < ?").bind(new Date(now.getTime()-30*86400000).toISOString()).run();
  if(!result.success)throw new Error("DIAGNOSTICO_LIMPEZA_FALHOU");
}
