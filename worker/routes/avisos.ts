import type { AuthUser } from "../../shared/auth.ts";
import type { AppEnv } from "../env.ts";
import { Hono } from "hono";
import { auditStatement } from "../repositories/audit.ts";
import { checkLoginRateLimit } from "../lib/login-rate-limit.ts";
import { publishAvisosChanged } from "../services/realtime.ts";
import { definirReacaoSchema, publicarAvisoSchema, publicarMensagemSchema } from "../../shared/avisos.ts";
import {
  avisoJson,
  definirReacao,
  listAvisos,
  listLeitoresDoAviso,
  markAvisoLido,
  markTodosAvisosLidos,
  publishAvisoStatements,
  publishMensagemStatements
} from "../repositories/avisos.ts";

// Rotas de avisos e do canal de avisos em chat (decisão do João, 25/11/2026).
// - /api/avisos: somente administradores e conferentes acessam o canal.
//   Eventos operacionais são consultados na auditoria. Admin e
//   conferente publicam mensagens comuns aqui; o visualizador não tem acesso.
// - /api/admin/avisos: publicação de aviso oficial e a régua "quem viu"
//   exclusivas do admin (a cadeia /api/admin/* já exige requireAuth +
//   requireAdmin). Não existe inativação/exclusão: registro permanente.

const avisoRoutes = new Hono<AppEnv>();
const adminAvisoRoutes = new Hono<AppEnv>();

avisoRoutes.use("*", async (c, next) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "NAO_AUTENTICADO", message: "Sessão inválida ou expirada." }, 401);
  if (user.papel !== "admin" && user.papel !== "conferente") return c.json({ error: "SEM_PERMISSAO", message: "Canal restrito a administradores e conferentes." }, 403);
  await next();
});

// Conferente vê os avisos da sua loja (e os de todas); os demais papéis,
// sem loja, veem todos os comunicados. Nenhum papel recebe eventos operacionais.
function lojaDoUsuario(user: AuthUser) {
  return user.papel === "conferente" ? user.lojaCodigo : null;
}

function verEventosDoUsuario(_user: AuthUser) {
  // Eventos operacionais pertencem à auditoria, não ao canal de comunicação.
  return false;
}

avisoRoutes.get("/", async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "NAO_AUTENTICADO", message: "Sessão inválida ou expirada." }, 401);
  const before = c.req.query("before");
  const beforeId = c.req.query("beforeId");
  if ((before && !beforeId) || (!before && beforeId) ||
      (before && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(before) || Number.isNaN(Date.parse(before)))) ||
      (beforeId && (beforeId.length > 128 || beforeId.length === 0))) {
    return c.json({ error: "REQUISICAO_INVALIDA", message: "Cursor de avisos inválido." }, 400);
  }
  const cursor = before && beforeId ? { criadoEm: before, id: beforeId } : null;
  const tipo = c.req.query("tipo");
  const busca = (c.req.query("q") ?? "").trim();
  if ((tipo !== undefined && tipo !== "aviso") || busca.length > 200) {
    return c.json({ error: "REQUISICAO_INVALIDA", message: "Filtro de avisos inválido." }, 400);
  }
  const { avisos, naoLidos, urgenteNaoLido, hasMore, nextCursor } = await listAvisos(
    c.env.DB, user.id, lojaDoUsuario(user), verEventosDoUsuario(user), 50, cursor, tipo, busca
  );
  return c.json({ avisos: avisos.map(avisoJson), naoLidos, urgenteNaoLido, hasMore, nextCursor });
});

// Mensagem comum do canal (tipo "chat"): escrita de admin e conferente,
// sempre global. Rate limit reutiliza o limitador do login por usuário e
// por IP, falhando fechado quando o limitador está indisponível.
avisoRoutes.post("/", async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "NAO_AUTENTICADO", message: "Sessão inválida ou expirada." }, 401);
  const parsed = publicarMensagemSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: "REQUISICAO_INVALIDA", message: parsed.error.issues[0]?.message ?? "Verifique a mensagem." },
      400
    );
  }
  const rate = await checkLoginRateLimit(
    c.env.LOGIN_RATE_LIMITER, "chat:" + user.id, c.req.header("CF-Connecting-IP")
  );
  if (rate === "unavailable") {
    return c.json(
      { error: "INDISPONIVEL", message: "Não foi possível enviar agora. Tente novamente em instantes." },
      503
    );
  }
  if (rate === "limited") {
    return c.json({ error: "MUITAS_MENSAGENS", message: "Aguarde antes de enviar outra mensagem." }, 429);
  }
  const { mensagem } = parsed.data;
  const now = new Date().toISOString();
  const mensagemId = crypto.randomUUID();
  const statements = [
    publishMensagemStatements(c.env.DB, {
      id: mensagemId,
      mensagem,
      criadoPor: user.id,
      autor: user.nome,
      criadoEm: now
    }),
    auditStatement(c.env.DB, {
      userId: user.id,
      action: "mensagem_do_canal_publicada",
      entity: "aviso",
      entityId: mensagemId,
      after: { tipo: "chat", mensagem },
      details: "Mensagem enviada no canal de avisos.",
      createdAt: now
    })
  ];
  await c.env.DB.batch(statements);
  await publishAvisosChanged(c.env, mensagemId);
  // Resposta é a mensagem completa (avisoSchema): o frontend faz parse dela.
  // próprio autor recebe com proprio=1 para alinhar a bolha à direita.
  return c.json(
    avisoJson({
      id: mensagemId,
      tipo: "chat",
      titulo: null,
      mensagem,
      criado_em: now,
      urgente: 0,
      autor: user.nome,
      lojas: null,
      lido: 1,
      proprio: 1
    }),
    201
  );
});

avisoRoutes.put("/:id/reacao", async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "NAO_AUTENTICADO", message: "Sessão inválida ou expirada." }, 401);
  const parsed = definirReacaoSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "REQUISICAO_INVALIDA", message: "Reação inválida." }, 400);
  const id = c.req.param("id");
  const reacoes = await definirReacao(c.env.DB, id, user.id, lojaDoUsuario(user), parsed.data.emoji, new Date().toISOString());
  if (reacoes === null) return c.json({ error: "NAO_ENCONTRADO", message: "Publicação indisponível para reação." }, 404);
  await publishAvisosChanged(c.env, id);
  return c.json({ reacoes });
});

avisoRoutes.post("/:id/lido", async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "NAO_AUTENTICADO", message: "Sessão inválida ou expirada." }, 401);
  const id = c.req.param("id");
  const inserted = await markAvisoLido(
    c.env.DB,
    id,
    user.id,
    new Date().toISOString(),
    lojaDoUsuario(user),
    verEventosDoUsuario(user)
  );
  if (!inserted) {
    // Idempotente: já lido OU aviso invisível ao usuário (fora do filtro de
    // loja/tipo) OU inexistente. A resposta é a mesma para não vazar
    // existência de aviso fora do que o usuário enxerga.
    return c.json({ ok: true, jaLido: true });
  }
  return c.json({ ok: true, jaLido: false });
});

// "Marcar todos": grava a leitura de todos os avisos e mensagens visíveis ao
// usuário. É também a base da leitura automática ao abrir o canal.
avisoRoutes.post("/marcar-todos", async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "NAO_AUTENTICADO", message: "Sessão inválida ou expirada." }, 401);
  const marcados = await markTodosAvisosLidos(
    c.env.DB,
    user.id,
    new Date().toISOString(),
    lojaDoUsuario(user),
    verEventosDoUsuario(user)
  );
  return c.json({ ok: true, marcados });
});

// Régua do admin: quem já viu o AVISO oficial (com horário) e quem falta.
// "Visto" registra a leitura individual do aviso; registros legados podem
// ter sido automáticos. Só aviso oficial tem acompanhamento.
adminAvisoRoutes.get("/:id/leitores", async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "NAO_AUTENTICADO", message: "Sessão inválida ou expirada." }, 401);
  const id = c.req.param("id");
  const existe = await c.env.DB.prepare(
    "SELECT id FROM avisos WHERE id = ? AND tipo = 'aviso'"
  ).bind(id).first();
  if (!existe) {
    return c.json({ error: "NAO_ENCONTRADO", message: "Aviso não encontrado." }, 404);
  }
  const { vistos, faltantes } = await listLeitoresDoAviso(c.env.DB, id);
  return c.json({ vistos, faltantes });
});

adminAvisoRoutes.post("/", async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "NAO_AUTENTICADO", message: "Sessão inválida ou expirada." }, 401);
  const parsed = publicarAvisoSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: "REQUISICAO_INVALIDA", message: parsed.error.issues[0]?.message ?? "Verifique os dados do aviso." },
      400
    );
  }
  const { titulo, mensagem, urgente } = parsed.data;
  const lojas = parsed.data.lojas ? [...new Set(parsed.data.lojas)] : null;
  // Direcionamento só para lojas ativas e existentes.
  if (lojas) {
    const rows = await c.env.DB.prepare(
      "SELECT codigo FROM lojas WHERE ativo = 1 AND excluido_em IS NULL"
    ).all<{ codigo: string }>();
    const validas = new Set((rows.results ?? []).map((row) => row.codigo));
    if (lojas.some((loja) => !validas.has(loja))) {
      return c.json(
        { error: "LOJAS_INVALIDAS", message: "Alguma loja escolhida não existe ou está inativa." },
        400
      );
    }
  }
  const now = new Date().toISOString();
  const avisoId = crypto.randomUUID();
  const statements = [
    ...publishAvisoStatements(c.env.DB, {
      id: avisoId,
      titulo,
      mensagem,
      criadoPor: user.id,
      autor: user.nome,
      criadoEm: now,
      urgente,
      lojas
    }),
    auditStatement(c.env.DB, {
      userId: user.id,
      action: "aviso_publicado",
      entity: "aviso",
      entityId: avisoId,
      after: { titulo, mensagem, urgente, lojas },
      details: lojas
        ? `Aviso publicado para as lojas ${lojas.join(", ")}.`
        : "Aviso publicado para todas as lojas.",
      createdAt: now
    })
  ];
  await c.env.DB.batch(statements);
  await publishAvisosChanged(c.env, avisoId);
  // Resposta é o aviso completo (avisoSchema): o frontend faz parse dela.
  // Divergir aqui fazia o admin ver erro com o aviso já criado (bug corrigido
  // em revisão — o mock de E2E era fiel ao schema, não à rota).
  return c.json(
    avisoJson({
      id: avisoId,
      tipo: "aviso",
      titulo,
      mensagem,
      criado_em: now,
      urgente: urgente ? 1 : 0,
      autor: user.nome,
      // char(31) é o separador do GROUP_CONCAT em repositories/avisos.ts:
      // código de loja com vírgula não pode quebrar o parse de avisoJson.
      lojas: lojas ? lojas.join("\u001f") : null,
      lido: 0,
      proprio: 1
    }),
    201
  );
});

export { avisoRoutes, adminAvisoRoutes };
