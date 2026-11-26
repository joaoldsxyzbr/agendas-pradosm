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
function visibilidadePorLoja(loja) {
  return loja
    ? "(SELECT COUNT(*) FROM avisos_lojas x WHERE x.aviso_id = a.id) = 0 " +
        "OR EXISTS (SELECT 1 FROM avisos_lojas x WHERE x.aviso_id = a.id AND x.loja = ?)"
    : "";
}

// Eventos automáticos são do admin/gerente: o conferente recebe os avisos
// publicados pelo admin E as mensagens do chat (decisão de 25/11/2026 — sem
// ruído de operações de lojas alheias para quem confere).
function filtroTipo(verEventos) {
  return verEventos ? "" : "a.tipo IN ('aviso', 'chat')";
}

// Lista os avisos com o estado "lido" do usuário, do mais recente para o
// mais antigo (decisão de 12/11: lista única, sem separação de histórico).
// Limitado aos últimos `limit` itens. Admin/visualizador (loja null) veem tudo.
export async function listAvisos(db, userId, loja = null, verEventos = true, limit = 50, cursor = null, tipoAviso: string | undefined = undefined, busca = "") {
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
    "(SELECT GROUP_CONCAT(x.loja, char(31)) FROM avisos_lojas x WHERE x.aviso_id = a.id) AS lojas";
  // "proprio" alinha a mensagem do próprio autor à direita no chat sem
  // depender de nome (homônimos); eventos (criado_por NULL) nunca são próprios.
  const values = [userId, userId, userId, ...(loja ? [loja] : []), ...(busca ? [busca] : []),
    ...(cursor ? [cursor.criadoEm, cursor.criadoEm, cursor.id] : []), limit + 1];
  const result = await db.prepare(
    `SELECT a.id, a.tipo, a.titulo, a.mensagem, a.criado_em, a.urgente, a.autor,
            (a.criado_por = ?) AS proprio,
            ${lojasSelect},
            CASE WHEN a.tipo = 'chat' AND a.criado_por = ? THEN 1 WHEN l.usuario_id IS NULL THEN 0 ELSE 1 END AS lido
       FROM avisos a
       LEFT JOIN avisos_lidos l ON l.aviso_id = a.id AND l.usuario_id = ?
      ${where ? "WHERE " + where : ""}
      ORDER BY a.criado_em DESC, a.id DESC
      LIMIT ?`
  ).bind(...values).all();
  const unread = await db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(MAX(CASE WHEN a.tipo = 'aviso' AND a.urgente = 1 THEN 1 ELSE 0 END), 0) AS urgente
       FROM avisos a
      WHERE ${filtroBase ? filtroBase + " AND " : ""}(a.tipo <> 'chat' OR a.criado_por IS NOT ?) AND NOT EXISTS (
          SELECT 1 FROM avisos_lidos l
           WHERE l.aviso_id = a.id AND l.usuario_id = ?
        )`
  ).bind(...(loja ? [loja, userId, userId] : [userId, userId])).first();
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
export async function markAvisoLido(db, avisoId, userId, now, loja = null, verEventos = true) {
  const filtroLoja = visibilidadePorLoja(loja);
  const tipo = filtroTipo(verEventos);
  const where = [tipo, filtroLoja ? "(" + filtroLoja + ")" : ""].filter(Boolean).join(" AND ");
  const result = await db.prepare(
    `INSERT OR IGNORE INTO avisos_lidos (aviso_id, usuario_id, lido_em)
      SELECT ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM avisos a WHERE a.id = ?${where ? " AND " + where : ""}
      )`
  ).bind(...(loja ? [avisoId, userId, now, avisoId, loja] : [avisoId, userId, now, avisoId])).run();
  return result?.meta?.changes === 1;
}

// Marca todos os avisos visíveis ao usuário como lidos. Também é a base da
// leitura automática estilo WhatsApp (decisão de 25/11/2026): abrir o canal
// marca tudo o que o usuário enxerga. Idempotente por aviso (INSERT OR
// IGNORE); respeita o direcionamento por loja e o filtro de tipo.
// Retorna quantos viraram lidos agora.
export async function markTodosAvisosLidos(db, userId, now, loja = null, verEventos = true) {
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
  ).bind(...(loja ? [userId, now, loja, userId] : [userId, now, userId])).run();
  return result?.meta?.changes ?? 0;
}

// Mapeia a linha do D1 para o contrato camelCase do frontend (shared/avisos.ts).
export function avisoJson(row) {
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
    autor: row.autor ?? "Sistema",
    lojas: row.lojas ? String(row.lojas).split("\u001f") : null
  };
}

// Statements de INSERT do aviso publicado pelo admin (com urgência, autor e
// direcionamento por loja); entram no mesmo batch da auditoria
// (aviso_publicado) na rota. O `id` opcional permite casar o INSERT com o
// entityId gravado na auditoria.
export function publishAvisoStatements(db, { id, titulo, mensagem, criadoPor, autor, criadoEm, urgente, lojas }) {
  const avisoId = id ?? crypto.randomUUID();
  const statements = [
    db.prepare(
      "INSERT INTO avisos (id, tipo, titulo, mensagem, criado_por, criado_em, urgente, autor) VALUES (?, 'aviso', ?, ?, ?, ?, ?, ?)"
    ).bind(avisoId, titulo, mensagem, criadoPor, criadoEm, urgente ? 1 : 0, autor)
  ];
  for (const loja of lojas ?? []) {
    statements.push(
      db.prepare("INSERT INTO avisos_lojas (aviso_id, loja) VALUES (?, ?)").bind(avisoId, loja)
    );
  }
  return statements;
}

// Statement de INSERT da mensagem comum do canal (tipo "chat"): sem título,
// sem urgência e global (sem linhas em avisos_lojas = todas as lojas).
// Usada pelo POST /api/avisos de admin e conferente (decisão de 25/11).
export function publishMensagemStatements(db, { id, mensagem, criadoPor, autor, criadoEm }) {
  const mensagemId = id ?? crypto.randomUUID();
  return db.prepare(
    "INSERT INTO avisos (id, tipo, titulo, mensagem, criado_por, criado_em, urgente, autor) VALUES (?, 'chat', NULL, ?, ?, ?, 0, ?)"
  ).bind(mensagemId, mensagem, criadoPor, criadoEm, autor);
}

// Régua do admin para o aviso oficial: conferentes ATIVOS do público
// destinatário (aviso sem linhas em avisos_lojas = todas as lojas), com quem
// já leu (lido_em) e quem ainda está aguardando. Leitura automática do canal
// grava em avisos_lidos, então "visto" = abriu o canal após a publicação.
export async function listLeitoresDoAviso(db, avisoId) {
  const lojasRows = await db.prepare(
    "SELECT loja FROM avisos_lojas WHERE aviso_id = ?"
  ).bind(avisoId).all();
  const codigos = (lojasRows.results ?? []).map((row) => row.loja);
  const alvo = codigos.length
    ? " AND s.codigo IN (" + codigos.map(() => "?").join(",") + ")"
    : "";
  const publico = await db.prepare(
    `SELECT u.id, u.nome, s.codigo AS loja
       FROM usuarios u
       JOIN lojas s ON s.id = u.loja_id
      WHERE u.papel = 'conferente' AND u.ativo = 1 AND u.excluido_em IS NULL${alvo}`
  ).bind(...codigos).all();
  const lidos = await db.prepare(
    `SELECT l.usuario_id, l.lido_em
       FROM avisos_lidos l
       JOIN usuarios u ON u.id = l.usuario_id
      WHERE l.aviso_id = ? AND u.papel = 'conferente' AND u.ativo = 1 AND u.excluido_em IS NULL`
  ).bind(avisoId).all();
  const lidosMap = new Map((lidos.results ?? []).map((row) => [row.usuario_id, row.lido_em]));
  const vistos = [];
  const faltantes = [];
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
export function avisoEventoStatement(db, { titulo, mensagem, criadoEm, guardAuditId = null }) {
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
