import type { Aviso, AvisoTipo, AvisoCursor, LeitorCanal, Reacao, ReacaoEmoji } from "../../shared/avisos.ts";
import { reacaoEmojiSchema } from "../../shared/avisos.ts";
import { z } from "zod";
import { noticeVisibilitySql as visibilidadePorLoja, noticeScopeArgs as lojaArgs, type NoticeScope } from "../services/notice-scope.ts";
import { listUsersWithAccess } from "./access.ts";

interface AvisoRow {
  id: string;
  tipo: AvisoTipo;
  titulo: string | null;
  mensagem: string;
  criado_em: string;
  urgente: number;
  autor: string | null;
  lojas: string | null;
  lido: number;
  proprio?: number | null;
  reacoes_json?: string | null;
}
interface MensagemInput {
  id?: string;
  mensagem: string;
  criadoPor: string;
  autor: string;
  criadoEm: string;
}
interface AvisoInput extends MensagemInput {
  titulo: string;
  urgente: boolean;
  lojas: { id: string; codigo: string }[] | null;
}
const reacaoRowSchema = z.object({ emoji: reacaoEmojiSchema, nome: z.string(), proprio: z.number() });

// Repositório de avisos/notificações in-app (spec 2026-11-11, melhorias de
// 12/11/2026). Eventos antigos permanecem no D1; operações novas são
// registradas na auditoria, sem duplicação no canal.
// Avisos são registro permanente: sem filtro de expiração/inativação — a
// lista é o histórico completo, do mais recente para o mais antigo.
// Desde 25/11/2026 o canal é um chat: a mensagem comum (tipo "chat") vive na
// mesma tabela, sem título, sem urgência e sempre global.

// Filtro de direcionamento por loja: aviso sem linhas em avisos_lojas é de
// todas as lojas; com linhas, só quem tem a loja (ou vê tudo) o enxerga.
// Mensagens de chat não têm linhas em avisos_lojas: sempre visíveis.
// Eventos automáticos são do admin/gerente: o conferente recebe os avisos
// publicados pelo admin E as mensagens do chat (decisão de 25/11/2026 — sem
// ruído de operações de lojas alheias para quem confere).
function filtroTipo(verEventos: boolean) {
  return verEventos ? "" : "a.tipo IN ('aviso', 'chat')";
}

// Lista os avisos com o estado "lido" do usuário, do mais recente para o
// mais antigo (decisão de 12/11: lista única, sem separação de histórico).
// Limitado aos últimos `limit` itens. Admin (loja null) vê tudo.
export async function listAvisos(db: D1Database, userId: string, loja: NoticeScope = null, verEventos = true, limit = 50, cursor: AvisoCursor | null = null, tipoAviso: string | undefined = undefined, busca = "") {
  const filtroLoja = visibilidadePorLoja(loja);
  const tipo = filtroTipo(verEventos);
  const filtroBase = [tipo, filtroLoja ? "(" + filtroLoja + ")" : ""].filter(Boolean).join(" AND ");
  // Cursor por (criado_em, id) evita pular/duplicar registros quando novos
  // avisos são publicados entre duas páginas.
  const filtroCursor = cursor
    ? "(a.criado_em < ? OR (a.criado_em = ? AND a.id < ?))"
    : "";
  const filtroAviso = tipoAviso === "aviso" ? "a.tipo = 'aviso'" : "";
  const filtroBusca = busca ? "instr(lower(coalesce(a.titulo, '') || ' ' || a.mensagem || ' ' || coalesce(a.autor, '')), lower(?)) > 0" : "";
  const where = [filtroBase, filtroAviso, filtroBusca, filtroCursor].filter(Boolean).join(" AND ");
  // Separador char(31) (unit separator): código de loja com vírgula não pode
  // quebrar o GROUP_CONCAT vindo do D1.
  const lojasSelect =
    "(SELECT GROUP_CONCAT(COALESCE(s.codigo, x.loja), char(31)) FROM avisos_lojas x LEFT JOIN lojas s ON s.id = x.loja_id WHERE x.aviso_id = a.id) AS lojas";
  // "proprio" alinha a mensagem do próprio autor à direita no chat sem
  // depender de nome (homônimos); eventos (criado_por NULL) nunca são próprios.
  const values = [userId, userId, userId, userId, ...lojaArgs(loja), ...(busca ? [busca] : []),
    ...(cursor ? [cursor.criadoEm, cursor.criadoEm, cursor.id] : []), limit + 1];
  const result = await db.prepare(
    `SELECT a.id, a.tipo, a.titulo, a.mensagem, a.criado_em, a.urgente, a.autor,
            (a.criado_por = ?) AS proprio,
            (SELECT json_group_array(json_object('emoji', r.emoji, 'nome', u.nome, 'proprio', r.usuario_id = ?))
               FROM avisos_reacoes r JOIN usuarios u ON u.id = r.usuario_id WHERE r.aviso_id = a.id) AS reacoes_json,
            ${lojasSelect},
            CASE WHEN a.tipo = 'chat' AND a.criado_por = ? THEN 1 WHEN l.usuario_id IS NULL THEN 0 ELSE 1 END AS lido
       FROM avisos a
       LEFT JOIN avisos_lidos l ON l.aviso_id = a.id AND l.usuario_id = ?
      ${where ? "WHERE " + where : ""}
      ORDER BY a.criado_em DESC, a.id DESC
      LIMIT ?`
  ).bind(...values).all<AvisoRow>();
  const unread = await db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(MAX(CASE WHEN a.tipo = 'aviso' AND a.urgente = 1 THEN 1 ELSE 0 END), 0) AS urgente
       FROM avisos a
      WHERE ${filtroBase ? filtroBase + " AND " : ""}(a.tipo <> 'chat' OR a.criado_por IS NOT ?) AND NOT EXISTS (
          SELECT 1 FROM avisos_lidos l
           WHERE l.aviso_id = a.id AND l.usuario_id = ?
        )`
  ).bind(...lojaArgs(loja), userId, userId).first<{ total: number; urgente: number }>();
  const rows = result.results ?? [];
  const avisos = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const ultimo = avisos.at(-1);
  return {
    avisos,
    naoLidos: unread?.total ?? 0,
    urgenteNaoLido: unread?.urgente === 1,
    hasMore,
    nextCursor: hasMore && ultimo ? { criadoEm: ultimo.criado_em, id: ultimo.id } : null
  };
}

// Marca um aviso como lido para o usuário — apenas o que ele enxerga (mesmo
// filtro de loja e tipo da listagem). Idempotente: marcar de novo não
// regrava (INSERT OR IGNORE na PK composta); aviso invisível responde igual
// a já lido, sem vazar existência fora do que o usuário vê.
export async function markAvisoLido(db: D1Database, avisoId: string, userId: string, now: string, loja: NoticeScope = null, verEventos = true) {
  const filtroLoja = visibilidadePorLoja(loja);
  const tipo = filtroTipo(verEventos);
  const where = [tipo, filtroLoja ? "(" + filtroLoja + ")" : ""].filter(Boolean).join(" AND ");
  const result = await db.prepare(
    `INSERT OR IGNORE INTO avisos_lidos (aviso_id, usuario_id, lido_em)
      SELECT ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM avisos a WHERE a.id = ?${where ? " AND " + where : ""}
      )`
  ).bind(avisoId, userId, now, avisoId, ...lojaArgs(loja)).run();
  return result?.meta?.changes === 1;
}

// Marca todos os avisos visíveis ao usuário como lidos. Também é a base da
// leitura automática estilo WhatsApp (decisão de 25/11/2026): abrir o canal
// marca tudo o que o usuário enxerga. Idempotente por aviso (INSERT OR
// IGNORE); respeita o direcionamento por loja e o filtro de tipo.
// Retorna quantos viraram lidos agora.
export async function markTodosAvisosLidos(db: D1Database, userId: string, now: string, loja: NoticeScope = null, verEventos = true) {
  const filtroLoja = visibilidadePorLoja(loja);
  const tipo = filtroTipo(verEventos);
  const where = [tipo, filtroLoja ? "(" + filtroLoja + ")" : ""].filter(Boolean).join(" AND ");
  const result = await db.prepare(
    `INSERT OR IGNORE INTO avisos_lidos (aviso_id, usuario_id, lido_em)
      SELECT a.id, ?, ? FROM avisos a
      ${where ? "WHERE " + where + " AND " : "WHERE "}NOT EXISTS (
        SELECT 1 FROM avisos_lidos l
         WHERE l.aviso_id = a.id AND l.usuario_id = ?
      )`
  ).bind(userId, now, ...lojaArgs(loja), userId).run();
  return Number(result?.meta?.changes ?? 0);
}

// Mapeia a linha do D1 para o contrato camelCase do frontend (shared/avisos.ts).
export function avisoJson(row: AvisoRow): Aviso {
  return {
    id: row.id,
    tipo: row.tipo,
    titulo: row.titulo ?? null,
    mensagem: row.mensagem,
    criadoEm: row.criado_em,
    lido: row.lido === 1,
    urgente: row.urgente === 1,
    // Ausente (undefined) em respostas de publicação e tabelas sem a coluna:
    // o contrato do schema é opcional justamente por isso.
    ...(row.proprio === undefined ? {} : { proprio: row.proprio === 1 }),
    reacoes: row.reacoes_json ? z.array(reacaoRowSchema).parse(JSON.parse(row.reacoes_json)).map(r => ({ ...r, proprio: r.proprio === 1 })) : [],
    autor: row.autor ?? "Sistema",
    lojas: row.lojas ? String(row.lojas).split("\u001f") : null
  };
}

// Statements de INSERT do aviso publicado pelo admin (com urgência, autor e
// direcionamento por loja); entram no mesmo batch da auditoria
// (aviso_publicado) na rota. O `id` opcional permite casar o INSERT com o
// entityId gravado na auditoria.
export function publishAvisoStatements(db: D1Database, { id, titulo, mensagem, criadoPor, autor, criadoEm, urgente, lojas }: AvisoInput): D1PreparedStatement[] {
  const avisoId = id ?? crypto.randomUUID();
  const statements = [
    db.prepare(
      "INSERT INTO avisos (id, tipo, titulo, mensagem, criado_por, criado_em, urgente, autor) VALUES (?, 'aviso', ?, ?, ?, ?, ?, ?)"
    ).bind(avisoId, titulo, mensagem, criadoPor, criadoEm, urgente ? 1 : 0, autor)
  ];
  for (const loja of lojas ?? []) {
    statements.push(
      db.prepare("INSERT INTO avisos_lojas (aviso_id, loja, loja_id) VALUES (?, ?, ?)").bind(avisoId, loja.codigo, loja.id)
    );
  }
  return statements;
}

// Statement de INSERT da mensagem comum do canal (tipo "chat"): sem título,
// sem urgência e global (sem linhas em avisos_lojas = todas as lojas).
// Usada pelo POST /api/avisos de admin e conferente (decisão de 25/11).
export function publishMensagemStatements(db: D1Database, { id, mensagem, criadoPor, autor, criadoEm }: MensagemInput): D1PreparedStatement {
  const mensagemId = id ?? crypto.randomUUID();
  return db.prepare(
    "INSERT INTO avisos (id, tipo, titulo, mensagem, criado_por, criado_em, urgente, autor) VALUES (?, 'chat', NULL, ?, ?, ?, 0, ?)"
  ).bind(mensagemId, mensagem, criadoPor, criadoEm, autor);
}

// Régua do admin para o aviso oficial: conferentes ATIVOS do público
// destinatário (aviso sem linhas em avisos_lojas = todas as lojas), com quem
// já leu (lido_em) e quem ainda está aguardando. Leitura automática do canal
// grava em avisos_lidos, então "visto" = abriu o canal após a publicação.
export async function listLeitoresDoAviso(db: D1Database, avisoId: string, accessMode = false) {
  if(accessMode)return listLeitoresComAcesso(db,avisoId);
  // EXISTS evita listas IN variáveis e mantém destinos não resolvidos fechados.
  const publico = await db.prepare(
    `SELECT u.id, u.nome, s.codigo AS loja
       FROM usuarios u JOIN lojas s ON s.id = u.loja_id
      WHERE u.papel = 'conferente' AND u.ativo = 1 AND u.excluido_em IS NULL
        AND (NOT EXISTS (SELECT 1 FROM avisos_lojas x WHERE x.aviso_id = ?)
          OR EXISTS (SELECT 1 FROM avisos_lojas x WHERE x.aviso_id = ? AND x.loja_id = s.id))`
  ).bind(avisoId, avisoId).all<{ id: string; nome: string; loja: string }>();
  const lidos = await db.prepare(
    `SELECT l.usuario_id, l.lido_em
       FROM avisos_lidos l
       JOIN usuarios u ON u.id = l.usuario_id
      WHERE l.aviso_id = ? AND u.papel = 'conferente' AND u.ativo = 1 AND u.excluido_em IS NULL`
  ).bind(avisoId).all<{ usuario_id: string; lido_em: string }>();
  const lidosMap = new Map((lidos.results ?? []).map((row) => [row.usuario_id, row.lido_em]));
  const vistos: LeitorCanal[] = [];
  const faltantes: LeitorCanal[] = [];
  for (const pessoa of publico.results ?? []) {
    const lidoEm = lidosMap.get(pessoa.id) ?? null;
    const registro = { id: pessoa.id, nome: pessoa.nome, lidoEm, loja: pessoa.loja };
    if (lidoEm) vistos.push(registro);
    else faltantes.push(registro);
  }
  vistos.sort((a, b) => a.nome.localeCompare(b.nome));
  faltantes.sort((a, b) => a.nome.localeCompare(b.nome));
  return { vistos, faltantes };
}

// Statement reutilizável do evento automático, para dentro do db.batch da
// operação. `guardAuditId`: só grava o aviso se a auditoria da operação
// registrou (padrão onlyIfPreviousWrite — falha silenciosa se a operação
// não alterou nada). Urgência 0 e autor 'Sistema' vêm do DEFAULT de 0023.
export function avisoEventoStatement(db: D1Database, { titulo, mensagem, criadoEm, guardAuditId = null }: { titulo: string; mensagem: string; criadoEm: string; guardAuditId?: string | null }): D1PreparedStatement {
  const id = crypto.randomUUID();
  if (guardAuditId) {
    return db.prepare(
      "INSERT INTO avisos (id, tipo, titulo, mensagem, criado_por, criado_em) " +
      "SELECT ?, 'evento', ?, ?, NULL, ? WHERE EXISTS (SELECT 1 FROM auditoria WHERE id = ?)"
    ).bind(id, titulo, mensagem, criadoEm, guardAuditId);
  }
  return db.prepare(
    "INSERT INTO avisos (id, tipo, titulo, mensagem, criado_por, criado_em) VALUES (?, 'evento', ?, ?, NULL, ?)"
  ).bind(id, titulo, mensagem, criadoEm);
}

 // A visibilidade e a autoria são verificadas também na própria mutação SQL.
export async function definirReacao(db: D1Database, avisoId: string, userId: string, loja: NoticeScope, emoji: ReacaoEmoji | null, now: string): Promise<Reacao[] | null> {
  const filtroLoja = visibilidadePorLoja(loja);
  const where = "a.id = ? AND a.tipo IN ('aviso', 'chat') AND a.criado_por IS NOT ?" +
    (filtroLoja ? " AND (" + filtroLoja + ")" : "");
  const args = [avisoId, userId, ...lojaArgs(loja)];
  const alvo = await db.prepare("SELECT a.id FROM avisos a WHERE " + where).bind(...args).first();
  if (!alvo) return null;
  if (emoji === null) {
    await db.prepare("DELETE FROM avisos_reacoes WHERE aviso_id = ? AND usuario_id = ? AND EXISTS (SELECT 1 FROM avisos a WHERE " + where + ")")
      .bind(avisoId, userId, ...args).run();
  } else {
    await db.prepare(`INSERT INTO avisos_reacoes (aviso_id, usuario_id, emoji, atualizado_em)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM avisos a WHERE ${where})
      ON CONFLICT(aviso_id, usuario_id) DO UPDATE SET emoji = excluded.emoji, atualizado_em = excluded.atualizado_em
      WHERE avisos_reacoes.emoji <> excluded.emoji`).bind(avisoId, userId, emoji, now, ...args).run();
  }
  const rows = await db.prepare(`SELECT r.emoji, u.nome, (r.usuario_id = ?) AS proprio
      FROM avisos_reacoes r JOIN usuarios u ON u.id = r.usuario_id WHERE r.aviso_id = ?
      ORDER BY r.emoji, u.nome, u.id`).bind(userId, avisoId).all<{ emoji: ReacaoEmoji; nome: string; proprio: number }>();
  return (rows.results ?? []).map(row => ({ emoji: row.emoji, nome: row.nome, proprio: row.proprio === 1 }));
}

async function listLeitoresComAcesso(db:D1Database,avisoId:string){
  const [accounts,targets,stores,reads]=await Promise.all([
    listUsersWithAccess(db),
    db.prepare("SELECT loja_id FROM avisos_lojas WHERE aviso_id=?").bind(avisoId).all<{loja_id:string|null}>(),
    db.prepare("SELECT id,codigo FROM lojas WHERE ativo=1 AND excluido_em IS NULL").all<{id:string;codigo:string}>(),
    db.prepare("SELECT usuario_id,lido_em FROM avisos_lidos WHERE aviso_id=?").bind(avisoId).all<{usuario_id:string;lido_em:string}>(),
  ]);
  if(!targets.success||!stores.success||!reads.success||!targets.results||!stores.results||!reads.results)throw Error("AVISOS_LEITORES_CONSULTA_FALHOU");
  const destinatarios=new Set(targets.results.map(t=>t.loja_id).filter((id):id is string=>id!==null));
  const global=targets.results.length===0;
  const lidos=new Map(reads.results.map(row=>[row.usuario_id,row.lido_em]));
  const vistos:LeitorCanal[]=[],faltantes:LeitorCanal[]=[];
  for(const {user,access} of accounts){
    if(!access?.active||access.profile!=="conferente"||!access.permissions.has("avisos.ver")||!access.permissions.has("avisos.marcar_lido"))continue;
    const visible=stores.results.filter(s=>(access.scope.mode==="all"||access.scope.storeIds.includes(s.id))&&(global||destinatarios.has(s.id)));
    if(!global&&!visible.length)continue;
    if(!access.customized&&!visible.length)continue;
    const registro:LeitorCanal={id:user.id,nome:user.nome,loja:visible.length===1?(visible[0]?.codigo??null):null,lidoEm:lidos.get(user.id)??null};
    (registro.lidoEm?vistos:faltantes).push(registro);
  }
  return {vistos,faltantes};
}
