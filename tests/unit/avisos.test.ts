import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { app } from "../../worker/app.ts";
import { createSessionToken } from "../../worker/lib/session.ts";
import {
  avisoSchema,
  avisosResponseSchema,
  leitoresAvisoSchema,
  publicarAvisoSchema,
  publicarMensagemSchema
} from "../../shared/avisos.ts";
import {
  avisoEventoStatement,
  listLeitoresDoAviso,
  markAvisoLido,
  markTodosAvisosLidos,
  publishAvisoStatements,
  publishMensagemStatements
} from "../../worker/repositories/avisos.ts";
import { importAgendaBatchAtomic } from "../../worker/repositories/agendas.ts";

const SECRET = "somente-testes-sinteticos-de-avisos-sem-credencial-real";

// ---------------------------------------------------------------------------
// Contratos zod de avisos (shared/avisos.ts)
// ---------------------------------------------------------------------------

describe("Contratos de avisos (shared/avisos.ts)", () => {
  it("publicarAvisoSchema aceita aviso válido com urgência e lojas opcionais", () => {
    const basico = publicarAvisoSchema.safeParse({
      titulo: " Mudança de doca ",
      mensagem: "A partir de amanhã a doca 3 fica fechada."
    });
    assert.equal(basico.success, true);
    assert.equal(basico.success && basico.data.titulo, "Mudança de doca");
    assert.equal(basico.success && basico.data.urgente, false, "urgência padrão é false");
    assert.equal(basico.success && basico.data.lojas, null, "sem lojas = todas as lojas");
    const direcionado = publicarAvisoSchema.safeParse({
      titulo: "Inventário",
      mensagem: "Amanhã às 7h.",
      urgente: true,
      lojas: ["01", "02"]
    });
    assert.equal(direcionado.success, true);
    assert.equal(direcionado.success && direcionado.data.urgente, true);
    assert.deepEqual(direcionado.success && direcionado.data.lojas, ["01", "02"]);
    const lojasExplicitaNulas = publicarAvisoSchema.safeParse({
      titulo: "Aviso geral",
      mensagem: "Novo fluxo de recebimento em vigor.",
      lojas: null
    });
    assert.equal(lojasExplicitaNulas.success, true);
  });

  it("publicarAvisoSchema rejeita limites e formatos inválidos", () => {
    assert.equal(publicarAvisoSchema.safeParse({ titulo: "", mensagem: "ok" }).success, false);
    assert.equal(
      publicarAvisoSchema.safeParse({ titulo: "x".repeat(201), mensagem: "ok" }).success,
      false
    );
    assert.equal(publicarAvisoSchema.safeParse({ titulo: "ok", mensagem: "" }).success, false);
    assert.equal(
      publicarAvisoSchema.safeParse({ titulo: "ok", mensagem: "x".repeat(2001) }).success,
      false
    );
    assert.equal(
      publicarAvisoSchema.safeParse({ titulo: "ok", mensagem: "ok", urgente: "sim" }).success,
      false
    );
    assert.equal(
      publicarAvisoSchema.safeParse({ titulo: "ok", mensagem: "ok", lojas: "01" }).success,
      false
    );
    assert.equal(
      publicarAvisoSchema.safeParse({ titulo: "ok", mensagem: "ok", lojas: [""] }).success,
      false
    );
    assert.equal(
      publicarAvisoSchema.safeParse({ titulo: "ok", mensagem: "ok", lojas: ["01", ""] }).success,
      false
    );
  });

  it("avisosResponseSchema valida o contrato da listagem", () => {
    const parsed = avisosResponseSchema.parse({
      avisos: [
        { id: "a1", tipo: "aviso", titulo: "T", mensagem: "M", criadoEm: "2026-11-11T10:00:00.000Z",
          lido: false, urgente: true, autor: "Administrador", lojas: ["01", "07"] },
        { id: "a2", tipo: "evento", titulo: "T2", mensagem: "M2", criadoEm: "2026-11-11T11:00:00.000Z",
          lido: true, urgente: false, autor: "Sistema", lojas: null }
      ],
      naoLidos: 1
    });
    assert.equal(parsed.naoLidos, 1);
    assert.equal(parsed.avisos[0].tipo, "aviso");
    assert.equal(parsed.avisos[0].urgente, true);
    assert.equal(parsed.avisos[0].autor, "Administrador");
    assert.deepEqual(parsed.avisos[0].lojas, ["01", "07"]);
    assert.equal(parsed.avisos[1].lojas, null);
  });

  it("publicarMensagemSchema aceita mensagem com trim e rejeita limites", () => {
    const valida = publicarMensagemSchema.safeParse({ mensagem: "  Bom dia; doca 1 livre.  " });
    assert.equal(valida.success, true);
    assert.equal(valida.success && valida.data.mensagem, "Bom dia; doca 1 livre.");
    assert.equal(publicarMensagemSchema.safeParse({ mensagem: "   " }).success, false);
    assert.equal(publicarMensagemSchema.safeParse({ mensagem: "" }).success, false);
    assert.equal(publicarMensagemSchema.safeParse({ mensagem: "x".repeat(2001) }).success, false);
    assert.equal(publicarMensagemSchema.safeParse({ mensagem: 42 }).success, false);
  });

  it("avisoSchema aceita mensagem do canal com título nulo", () => {
    const contrato = avisoSchema.safeParse({
      id: "msg-1", tipo: "chat", titulo: null, mensagem: "Recado do canal.",
      criadoEm: "2026-11-25T10:00:00.000Z", lido: false, urgente: false,
      autor: "Conferente 1", lojas: null, proprio: true
    });
    assert.equal(contrato.success, true);
    assert.equal(contrato.success && contrato.data.titulo, null);
    assert.equal(contrato.success && contrato.data.tipo, "chat");
    assert.equal(contrato.success && contrato.data.proprio, true);
    // Sem "proprio" (resposta de publicação antiga) o contrato ainda vale.
    const semProprio = avisoSchema.safeParse({
      id: "msg-2", tipo: "chat", titulo: null, mensagem: "Outro recado.",
      criadoEm: "2026-11-25T10:05:00.000Z", lido: false, urgente: false,
      autor: "Conferente 2", lojas: null
    });
    assert.equal(semProprio.success, true);
    assert.equal(semProprio.success && semProprio.data.proprio, undefined);
  });

  it("leitoresAvisoSchema valida a régua de quem viu o aviso oficial", () => {
    const parsed = leitoresAvisoSchema.parse({
      vistos: [{ id: "conf1", nome: "Conferente 1", lidoEm: "2026-11-25T12:10:00.000Z", loja: "01" }],
      faltantes: [{ id: "conf2", nome: "Conferente 2", lidoEm: null, loja: "02" }]
    });
    assert.equal(parsed.vistos.length, 1);
    assert.equal(parsed.vistos[0].lidoEm, "2026-11-25T12:10:00.000Z");
    assert.equal(parsed.faltantes[0].lidoEm, null);
  });
});

// ---------------------------------------------------------------------------
// Arity bind x placeholders — o D1 rejeita binds divergentes e a substituição
// em lote já quebrou produção por isso (incidente #214). Todos os statements
// de avisos seguem o mesmo contrato.
// ---------------------------------------------------------------------------

function arityDb() {
  const statements = [];
  const placeholderCount = (sql) => (sql.match(/\?/g) ?? []).length;
  const assertArity = (sql, values) => {
    assert.equal(
      values.length,
      placeholderCount(sql),
      `bind com ${values.length} valores para ${placeholderCount(sql)} placeholders: ${sql}`
    );
  };
  return {
    statements,
    prepare(sql) {
      const statement = {
        sql,
        async all() { return { results: [] }; },
        async first() { return null; },
        async run() { return { meta: { changes: 1 } }; }
      };
      statement.bind = (...values) => {
        assertArity(sql, values);
        statement.values = values;
        statements.push(statement);
        return statement;
      };
      return statement;
    },
    async batch(batchStatements) {
      // Os statements já entram no array via bind(); não duplicar aqui.
      return batchStatements.map(() => ({ meta: { changes: 1 } }));
    }
  };
}

describe("Statements de avisos: bind igual aos placeholders", () => {
  it("publishAvisoStatements têm arity exata com e sem lojas", () => {
    const db = arityDb();
    publishAvisoStatements(db, { titulo: "T", mensagem: "M", criadoPor: "adm1", autor: "Administrador", criadoEm: "t0", urgente: true, lojas: null });
    publishAvisoStatements(db, { titulo: "T", mensagem: "M", criadoPor: "adm1", autor: "Administrador", criadoEm: "t0", urgente: false, lojas: [{ id: "loja1", codigo: "01" }, { id: "loja2", codigo: "02" }] });
    // 1 INSERT do aviso + 2 INSERTs de direcionamento + 1 INSERT + 0.
    assert.equal(db.statements.length, 4);
    assert.match(db.statements[0].sql, /INSERT INTO avisos/);
    assert.match(db.statements[2].sql, /INSERT INTO avisos_lojas/);
    assert.equal(db.statements[2].values[1], "01");
    assert.equal(db.statements[2].values[2], "loja1");
    assert.equal(db.statements[3].values[1], "02");
    const semLojas = arityDb();
    publishAvisoStatements(semLojas, { titulo: "T", mensagem: "M", criadoPor: "adm1", autor: "Administrador", criadoEm: "t0", urgente: false, lojas: null });
    assert.equal(semLojas.statements.length, 1);
  });

  it("markTodosAvisosLidos tem arity exata com e sem filtro de loja/tipo", async () => {
    const db = arityDb();
    await markTodosAvisosLidos(db, "conf1", "t0", "01");
    await markTodosAvisosLidos(db, "adm1", "t0", null);
    await markTodosAvisosLidos(db, "conf1", "t0", "01", false);
    await markTodosAvisosLidos(db, "view1", "t0", null, true);
    assert.equal(db.statements.length, 4);
    assert.match(db.statements[0].sql, /INSERT OR IGNORE INTO avisos_lidos/);
    assert.match(db.statements[0].sql, /avisos_lojas/);
    assert.doesNotMatch(db.statements[1].sql, /avisos_lojas x WHERE x.aviso_id = a.id AND x.loja/);
    // Sem eventos: o filtro por tipo cobre aviso oficial E mensagem do canal.
    assert.match(db.statements[2].sql, /a\.tipo IN \('aviso', 'chat'\)/);
    assert.doesNotMatch(db.statements[3].sql, /a\.tipo IN \('aviso', 'chat'\)/);
  });

  it("markAvisoLido tem arity exata com e sem filtro de loja/tipo", async () => {
    const db = arityDb();
    await markAvisoLido(db, "a1", "conf1", "t0", "01", false);
    await markAvisoLido(db, "a1", "adm1", "t0", null, true);
    assert.equal(db.statements.length, 2);
    assert.match(db.statements[0].sql, /INSERT OR IGNORE INTO avisos_lidos/);
    // Conferente: filtro por tipo (aviso + chat) e por loja dentro do EXISTS.
    assert.match(db.statements[0].sql, /a\.tipo IN \('aviso', 'chat'\)/);
    assert.match(db.statements[0].sql, /avisos_lojas/);
    // Admin/visualizador: enxerga tudo, só exige que o aviso exista.
    assert.doesNotMatch(db.statements[1].sql, /a\.tipo IN \('aviso', 'chat'\)/);
    assert.doesNotMatch(db.statements[1].sql, /avisos_lojas/);
  });

  it("publishMensagemStatements e listLeitoresDoAviso têm arity exata", async () => {
    const db = arityDb();
    const statement = publishMensagemStatements(db, {
      id: "msg-1", mensagem: "M", criadoPor: "conf1", autor: "Conferente 1", criadoEm: "t0"
    });
    assert.equal(statement.values.length, 5);
    assert.equal(statement.values[0], "msg-1");
    assert.equal(statement.values[1], "M");
    assert.match(statement.sql, /VALUES \(\?, 'chat', NULL/);
    // Aviso global: o público é "todas as lojas" e não adiciona binds.
    const leitores = await listLeitoresDoAviso(db, "msg-1");
    assert.deepEqual(leitores, { vistos: [], faltantes: [] });
  });

  it("avisoEventoStatement com e sem guard têm arity exata", () => {
    const db = arityDb();
    avisoEventoStatement(db, { titulo: "T", mensagem: "M", criadoEm: "t0" });
    avisoEventoStatement(db, { titulo: "T", mensagem: "M", criadoEm: "t0", guardAuditId: "aud1" });
    assert.equal(db.statements.length, 2);
    assert.match(db.statements[0].sql, /INSERT INTO avisos/);
    assert.match(db.statements[1].sql, /WHERE EXISTS/);
  });

  it("importação em lote mantém auditoria por loja sem eventos duplicados", async () => {
    const db = arityDb();
    const appointment = {
      protocol: "P1",
      startTime: "08:00",
      endTime: "08:30",
      supplier: "Fornecedor sintético",
      items: 2,
      volumes: null,
      pallets: null,
      cargaBatida: null,
      type: "Carga seca",
      nfe: [],
      orders: ["P1"],
      csvFields: null
    };
    const input = {
      storeCode: "01",
      date: "2026-11-11",
      originalFileName: "lote.csv",
      appointments: [appointment, { ...appointment, protocol: "P2" }]
    };
    await importAgendaBatchAtomic(db, "adm1", [
      { storeId: "loja-1", existing: null, input },
      { storeId: "loja-2", existing: null, input: { ...input, storeCode: "02" } }
    ]);
    const avisos = db.statements.filter((statement) => statement.sql.includes("INSERT INTO avisos"));
    assert.equal(avisos.length, 0);
    assert.equal(db.statements.filter(statement => statement.sql.includes("INSERT INTO auditoria")).length, 2);
  });
});

// ---------------------------------------------------------------------------
// Rotas integradas: Worker + SQLite sintético, sem mocks de endpoints
// (mesmo padrão do recebimento-api-integrated).
// ---------------------------------------------------------------------------

function fixture({ limiter = { limit: async () => ({ success: true }) } } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec([
    "CREATE TABLE sessoes_revogadas (session_key TEXT PRIMARY KEY, expira_em INTEGER NOT NULL)",
    "CREATE TABLE lojas (id TEXT PRIMARY KEY, codigo TEXT, nome TEXT, ativo INTEGER, excluido_em TEXT, criado_em TEXT, atualizado_em TEXT)",
    "CREATE TABLE usuarios (id TEXT PRIMARY KEY, loja_id TEXT, nome TEXT, login TEXT, senha_hash TEXT, papel TEXT, ativo INTEGER, session_version INTEGER, excluido_em TEXT, criado_em TEXT, atualizado_em TEXT)",
    "CREATE TABLE agendas (id TEXT PRIMARY KEY, loja_id TEXT, data_agenda TEXT, arquivo_original TEXT, criado_por TEXT, status_dia TEXT, concluido_em TEXT, concluido_por TEXT, digitado_em TEXT, digitado_por TEXT, criado_em TEXT, atualizado_em TEXT)",
    "CREATE TABLE agendamentos (id TEXT PRIMARY KEY, agenda_id TEXT, protocolo TEXT, horario_inicio TEXT, horario_fim TEXT, fornecedor TEXT, itens INTEGER, volumes INTEGER, paletes INTEGER, carga_batida TEXT, tipo TEXT, nfe TEXT, pedidos TEXT, status TEXT, trocas INTEGER, observacao TEXT, origem TEXT, ativo INTEGER, criado_em TEXT, atualizado_em TEXT, csv_campos TEXT)",
    "CREATE TABLE historico_status (id TEXT PRIMARY KEY, agendamento_id TEXT, usuario_id TEXT, status_anterior TEXT, status_novo TEXT, observacao TEXT, alterado_em TEXT)",
    "CREATE TABLE historico_agenda (id TEXT PRIMARY KEY, agenda_id TEXT, usuario_id TEXT, acao TEXT, detalhes TEXT, alterado_em TEXT)",
    "CREATE TABLE auditoria (id TEXT PRIMARY KEY, usuario_id TEXT, acao TEXT, entidade TEXT, entidade_id TEXT, loja_id TEXT, agenda_id TEXT, agendamento_id TEXT, antes TEXT, depois TEXT, detalhes TEXT, criado_em TEXT)",
    "CREATE TABLE avisos (id TEXT PRIMARY KEY, tipo TEXT NOT NULL CHECK (tipo IN ('aviso','evento','chat')), titulo TEXT, mensagem TEXT NOT NULL, criado_por TEXT, criado_em TEXT NOT NULL, expira_em TEXT, inativo_em TEXT, urgente INTEGER NOT NULL DEFAULT 0 CHECK (urgente IN (0,1)), autor TEXT NOT NULL DEFAULT 'Sistema')",
    "CREATE TABLE avisos_lidos (aviso_id TEXT NOT NULL, usuario_id TEXT NOT NULL, lido_em TEXT NOT NULL, PRIMARY KEY (aviso_id, usuario_id))",
    "CREATE TABLE avisos_lojas (aviso_id TEXT NOT NULL, loja TEXT NOT NULL, loja_id TEXT, PRIMARY KEY (aviso_id, loja))",
    "CREATE TABLE avisos_reacoes (aviso_id TEXT NOT NULL, usuario_id TEXT NOT NULL, emoji TEXT NOT NULL CHECK (emoji IN ('👍', '👀', '😂')), atualizado_em TEXT NOT NULL, PRIMARY KEY (aviso_id, usuario_id))"
  ].join(";\n") + ";");
  const now = "2026-11-11T12:00:00.000Z";
  const addLoja = sqlite.prepare("INSERT INTO lojas (id,codigo,nome,ativo) VALUES (?,?,?,1)");
  addLoja.run("loja1", "01", "Loja sintética 1");
  addLoja.run("loja2", "02", "Loja sintética 2");
  const addUser = sqlite.prepare("INSERT INTO usuarios (id,loja_id,nome,login,senha_hash,papel,ativo,session_version) VALUES (?,?,?,?,?,?,1,1)");
  addUser.run("conf1", "loja1", "Conferente 1", "conf1", "sintetico", "conferente");
  addUser.run("conf2", "loja2", "Conferente 2", "conf2", "sintetico", "conferente");
  addUser.run("adm1", null, "Administrador", "adm1", "sintetico", "admin");
  addUser.run("view1", null, "Visualizador", "view1", "sintetico", "visualizador");
  sqlite.prepare("INSERT INTO agendas (id,loja_id,data_agenda,arquivo_original,criado_por,status_dia,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?)")
    .run("agenda1", "loja1", "2026-11-11", "sintetico.csv", "adm1", "aberto", now, now);

  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let bindings = [];
      const request = {
        sql,
        bind(...values) { bindings = values; return request; },
        async first() { return statement.get(...bindings) ?? null; },
        async all() { return { results: statement.all(...bindings) }; },
        async run() {
          const result = statement.run(...bindings);
          return { success: true, meta: { changes: Number(result.changes) } };
        }
      };
      return request;
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  // O canal reutiliza o limitador do login no POST /api/avisos; sem limitador
  // a rota falha fechado com 503, então o padrão é um limitador sintético
  // que sempre libera — cada teste injeta o comportamento que quiser.
  const env = {
    DB: db,
    SESSION_SECRET: SECRET,
    REALTIME_MODE: "off",
    ...(limiter === null ? {} : { LOGIN_RATE_LIMITER: limiter })
  };
  async function call(userId, path, { method = "GET", body } = {}) {
    const token = await createSessionToken(userId, 1, SECRET);
    return app.request("http://localhost" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        Cookie: "agenda_session=" + token
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) })
    }, env);
  }
  const avisosCount = () => sqlite.prepare("SELECT count(*) AS n FROM avisos").get().n;
  const auditCount = (acao) => sqlite.prepare("SELECT count(*) AS n FROM auditoria WHERE acao = ?").get(acao).n;
  return { sqlite, call, avisosCount, auditCount };
}

describe("Rotas de avisos integradas", () => {
  it("admin publica; conferente lê, marca como lido e o badge zera", async () => {
    const f = fixture();
    try {
      const publicacao = await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "Doca 3 fechada", mensagem: "A doca 3 fica fechada hoje." }
      });
      assert.equal(publicacao.status, 201);
      const publicado = await publicacao.json();
      // Contrato: a resposta da publicação é um aviso completo (o frontend
      // faz avisoSchema.parse nela — mock de E2E fiel ao schema não pega
      // divergência entre rota real e schema).
      const contrato = avisoSchema.safeParse(publicado);
      assert.equal(contrato.success, true);
      assert.equal(contrato.success && contrato.data.autor, "Administrador");
      assert.equal(contrato.success && contrato.data.urgente, false);
      assert.equal(contrato.success && contrato.data.lojas, null);
      const resposta = await (await f.call("conf1", "/api/avisos")).json();
      assert.equal(resposta.naoLidos, 1);
      assert.equal(resposta.avisos.length, 1);
      assert.equal(resposta.avisos[0].titulo, "Doca 3 fechada");
      assert.equal(resposta.avisos[0].tipo, "aviso");
      assert.equal(resposta.avisos[0].lido, false);
      assert.equal(resposta.avisos[0].autor, "Administrador");
      assert.equal(resposta.avisos[0].urgente, false);
      assert.equal(resposta.avisos[0].lojas, null);
      assert.equal(resposta.avisos[0].proprio, false, "aviso do admin não é próprio do conferente");
      assert.equal(f.auditCount("aviso_publicado"), 1);

      const lido = await f.call("conf1", `/api/avisos/${publicado.id}/lido`, { method: "POST" });
      assert.equal(lido.status, 200);
      const aposLer = await (await f.call("conf1", "/api/avisos")).json();
      assert.equal(aposLer.naoLidos, 0);
      assert.equal(aposLer.avisos[0].lido, true);
      // Marcar de novo é idempotente.
      const reMarcar = await f.call("conf1", `/api/avisos/${publicado.id}/lido`, { method: "POST" });
      assert.equal(reMarcar.status, 200);
      assert.equal((await reMarcar.json()).jaLido, true);
      // O estado "lido" é por usuário: o admin continua com badge.
      const visaoAdmin = await (await f.call("adm1", "/api/avisos")).json();
      assert.equal(visaoAdmin.naoLidos, 1);
    } finally {
      f.sqlite.close();
    }
  });

  it("aviso urgente e direcionado: só as lojas destinatárias veem", async () => {
    const f = fixture();
    try {
      const publicacao = await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "Inventário loja 01", mensagem: "Amanhã às 7h.", urgente: true, lojas: ["01"] }
      });
      assert.equal(publicacao.status, 201);
      const publicado = await publicacao.json();
      assert.equal(publicado.urgente, true);
      assert.deepEqual(publicado.lojas, ["01"]);

      const visaoConf1 = await (await f.call("conf1", "/api/avisos")).json();
      assert.equal(visaoConf1.naoLidos, 1);
      assert.equal(visaoConf1.avisos[0].urgente, true);
      assert.deepEqual(visaoConf1.avisos[0].lojas, ["01"]);
      // Conferente de outra loja não vê o aviso direcionado.
      const visaoConf2 = await (await f.call("conf2", "/api/avisos")).json();
      assert.equal(visaoConf2.naoLidos, 0);
      assert.equal(visaoConf2.avisos.length, 0);
      // Admin vê tudo (inclusive direcionado).
      const visaoAdmin = await (await f.call("adm1", "/api/avisos")).json();
      assert.equal(visaoAdmin.avisos.length, 1);
      // Visualizador também vê tudo.
      assert.equal((await f.call("view1", "/api/avisos")).status, 403);
    } finally {
      f.sqlite.close();
    }
  });

  it("eventos históricos não entram no canal nem no badge de nenhum papel", async () => {
    const f = fixture();
    try {
      // Evento automático no mesmo formato dos statements de agendas.ts:
      // sem direcionamento, criado pelo sistema, autor "Sistema".
      f.sqlite.prepare(
        "INSERT INTO avisos (id, tipo, titulo, mensagem, criado_em) " +
        "VALUES ('ev1', 'evento', 'Agenda importada', '10 agendas e 216 agendamentos importados.', '2026-11-12T12:00:00.000Z')"
      ).run();
      await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "Aviso do admin", mensagem: "Somente recados do admin chegam ao conferente." }
      });
      // Conferente: só o aviso — o evento não entra na lista nem no badge
      // (o conferente recebe avisos do admin e mensagens do canal; eventos
      // automáticos ficam com admin e visualizador — decisão de 12/11).
      const visaoConf = await (await f.call("conf1", "/api/avisos")).json();
      assert.equal(visaoConf.avisos.length, 1);
      assert.equal(visaoConf.avisos.every((aviso) => aviso.tipo === "aviso"), true, "nenhum evento na lista do conferente");
      assert.equal(visaoConf.naoLidos, 1, "o evento não conta no badge do conferente");
      // Marcar-todos do conferente só grava o que ele enxerga.
      const marcar = await f.call("conf1", "/api/avisos/marcar-todos", { method: "POST" });
      assert.equal((await marcar.json()).marcados, 1);
      const visaoAdmin = await (await f.call("adm1", "/api/avisos")).json();
      assert.equal(visaoAdmin.avisos.length, 1);
      assert.equal(visaoAdmin.naoLidos, 1);
      assert.equal(visaoAdmin.avisos.some(aviso => aviso.tipo === "evento"), false);
      assert.equal((await f.call("view1", "/api/avisos")).status, 403);
    } finally {
      f.sqlite.close();
    }
  });

  it("marcar lido respeita a visibilidade: evento e aviso de outra loja não são gravados", async () => {
    const f = fixture();
    try {
      // Evento legado (não visível no canal) + aviso direcionado à loja 02.
      f.sqlite.prepare(
        "INSERT INTO avisos (id, tipo, titulo, mensagem, criado_em) " +
        "VALUES ('ev1', 'evento', 'Agenda importada', '10 agendas importadas.', '2026-11-12T12:00:00.000Z')"
      ).run();
      const publicacao = await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "Só loja 02", mensagem: "Recado interno da loja 02.", lojas: ["02"] }
      });
      const aviso02 = (await publicacao.json()).id;

      // Conferente da loja 01 tenta marcar os dois: resposta genérica (não
      // vaza existência), nenhuma leitura gravada, badge segue em 0.
      const evResp = await f.call("conf1", "/api/avisos/ev1/lido", { method: "POST" });
      assert.equal(evResp.status, 200);
      assert.equal((await evResp.json()).jaLido, true);
      const outroResp = await f.call("conf1", `/api/avisos/${aviso02}/lido`, { method: "POST" });
      assert.equal((await outroResp.json()).jaLido, true);
      const leiturasConf1 = f.sqlite
        .prepare("SELECT count(*) AS n FROM avisos_lidos WHERE usuario_id = 'conf1'")
        .get().n;
      assert.equal(leiturasConf1, 0, "conferente não grava leitura do que não enxerga");
      const visaoConf = await (await f.call("conf1", "/api/avisos")).json();
      assert.equal(visaoConf.naoLidos, 0);

      // Admin também não marca eventos legados do sistema.
      const admResp = await f.call("adm1", "/api/avisos/ev1/lido", { method: "POST" });
      assert.equal((await admResp.json()).jaLido, true);
      const leiturasAdm = f.sqlite
        .prepare("SELECT count(*) AS n FROM avisos_lidos WHERE usuario_id = 'adm1' AND aviso_id = 'ev1'")
        .get().n;
      assert.equal(leiturasAdm, 0);
    } finally {
      f.sqlite.close();
    }
  });

  it("código de loja com vírgula não quebra o direcionamento nem a lista", async () => {
    const f = fixture();
    try {
      f.sqlite.prepare(
        "INSERT INTO lojas (id, codigo, nome, ativo) VALUES ('loja3', 'A,B', 'Loja com vírgula', 1)"
      ).run();
      const publicacao = await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "Loja com vírgula", mensagem: "Recado.", lojas: ["A,B"] }
      });
      assert.equal(publicacao.status, 201);
      const publicado = await publicacao.json();
      assert.deepEqual(publicado.lojas, ["A,B"]);
      const visaoAdm = await (await f.call("adm1", "/api/avisos")).json();
      const alvo = visaoAdm.avisos.find((aviso) => aviso.titulo === "Loja com vírgula");
      assert.deepEqual(alvo.lojas, ["A,B"], "o código inteiro chega como um único elemento");
    } finally {
      f.sqlite.close();
    }
  });

  it("marcar-todos grava a leitura dos avisos visíveis e zera o badge", async () => {
    const f = fixture();
    try {
      await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "Aviso 1", mensagem: "Um." }
      });
      await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "Aviso 2", mensagem: "Dois.", urgente: true }
      });
      await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "Só loja 02", mensagem: "Três.", lojas: ["02"] }
      });
      const antes = await (await f.call("conf1", "/api/avisos")).json();
      assert.equal(antes.naoLidos, 2, "o direcionado à loja 02 não conta para o conferente da 01");
      const marcar = await f.call("conf1", "/api/avisos/marcar-todos", { method: "POST" });
      assert.equal(marcar.status, 200);
      const corpo = await marcar.json();
      assert.equal(corpo.ok, true);
      assert.equal(corpo.marcados, 2);
      const depois = await (await f.call("conf1", "/api/avisos")).json();
      assert.equal(depois.naoLidos, 0);
      assert.equal(depois.avisos.filter((aviso) => aviso.lido).length, 2);
      // Idempotente: de novo não regrava nada.
      const deNovo = await f.call("conf1", "/api/avisos/marcar-todos", { method: "POST" });
      assert.equal((await deNovo.json()).marcados, 0);
      // A leitura é por usuário: marcar-todos do conferente da 01 não toca
      // o estado do conferente da 02 (que ainda vê 3 não lidos).
      const visaoConf2 = await (await f.call("conf2", "/api/avisos")).json();
      assert.equal(visaoConf2.naoLidos, 3, "marcar-todos de um usuário não marca por outro");
    } finally {
      f.sqlite.close();
    }
  });

  it("sem sessão é 401; conferente e visualizador não publicam", async () => {
    const f = fixture();
    try {
      assert.equal((await app.request("http://localhost/api/avisos")).status, 401);
      assert.equal(
        (await app.request("http://localhost/api/avisos", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost" },
          body: JSON.stringify({ mensagem: "Sem sessão." })
        })).status,
        401
      );
      assert.equal(
        (await f.call("conf1", "/api/admin/avisos", { method: "POST", body: { titulo: "T", mensagem: "M" } })).status,
        403
      );
      assert.equal(
        (await f.call("view1", "/api/admin/avisos", { method: "POST", body: { titulo: "T", mensagem: "M" } })).status,
        403
      );
      // Visualizador lê os avisos normalmente.
      assert.equal((await f.call("view1", "/api/avisos")).status, 403);
      // Corpo inválido rejeitado com mensagem em PT-BR.
      const invalido = await f.call("adm1", "/api/admin/avisos", { method: "POST", body: { titulo: "", mensagem: "" } });
      assert.equal(invalido.status, 400);
      assert.match((await invalido.json()).message, /título do aviso/i);
      assert.equal(f.avisosCount(), 0);
      // Loja inexistente no direcionamento é 400, sem gravar nada.
      const lojaInvalida = await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "T", mensagem: "M", lojas: ["99"] }
      });
      assert.equal(lojaInvalida.status, 400);
      assert.equal((await lojaInvalida.json()).error, "LOJAS_INVALIDAS");
      assert.equal(f.avisosCount(), 0);
    } finally {
      f.sqlite.close();
    }
  });

  it("avisos publicados permanecem para sempre: nada de expiração ou inativação", async () => {
    const f = fixture();
    try {
      await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "Aviso antigo", mensagem: "Ainda está na lista." }
      });
      await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "Aviso vigente", mensagem: "Também está." }
      });
      const resposta = await (await f.call("conf1", "/api/avisos")).json();
      assert.equal(resposta.avisos.length, 2, "nenhum aviso sai da lista");
      assert.equal(resposta.naoLidos, 2);
      // Rota de inativação não existe mais.
      const inativar = await f.call("adm1", "/api/admin/avisos/nao-existe/inativar", { method: "POST" });
      assert.equal(inativar.status, 404);
      assert.equal(f.auditCount("aviso_inativado"), 0);
    } finally {
      f.sqlite.close();
    }
  });

  it("concluir e reabrir preserva auditoria sem gerar eventos no canal", async () => {
    const f = fixture();
    try {
      assert.equal((await f.call("conf1", "/api/store/agenda/2026-11-11/complete", { method: "POST" })).status, 200);
      assert.equal(f.auditCount("dia_concluido"), 1);
      assert.equal((await f.call("adm1", "/api/admin/agendas/agenda1/status", { method: "PATCH", body: { status: "aberto" } })).status, 200);
      assert.equal(f.auditCount("dia_reaberto"), 1);
      assert.equal(f.avisosCount(), 0);
      assert.equal((await (await f.call("adm1", "/api/avisos")).json()).naoLidos, 0);
    } finally {
      f.sqlite.close();
    }
  });
  it("busca e filtra avisos sem vazar público e conta urgência além da primeira página", async () => {
    const f = fixture();
    try {
      const post = (titulo, lojas = null, urgente = false) => f.call("adm1", "/api/admin/avisos", { method: "POST", body: { titulo, mensagem: "Comunicado sintético", lojas, urgente } });
      assert.equal((await post("Urgente antigo", ["01"], true)).status, 201);
      assert.equal((await post("Restrito loja 02", ["02"])).status, 201);
      assert.equal((await post("Inválido", [])).status, 400);
      const add = f.sqlite.prepare("INSERT INTO avisos (id,tipo,titulo,mensagem,criado_em) VALUES (?,'chat',NULL,'Mensagem nova','2099-01-01T00:00:00.000Z')");
      for (let i = 0; i < 51; i++) add.run("nova-" + i);
      const recente = await (await f.call("conf1", "/api/avisos")).json();
      assert.equal(recente.avisos.length, 50);
      assert.equal(recente.avisos.every(a => a.tipo === "chat"), true);
      assert.equal(recente.urgenteNaoLido, true);
      const oficiais = await (await f.call("conf1", "/api/avisos?tipo=aviso&q=urgente")).json();
      assert.equal(oficiais.avisos.length, 1);
      assert.equal(oficiais.avisos[0].titulo, "Urgente antigo");
      assert.equal(oficiais.naoLidos, recente.naoLidos);
      const restrito = await (await f.call("conf1", "/api/avisos?q=Restrito")).json();
      assert.equal(restrito.avisos.length, 0);
      assert.equal((await f.call("conf1", "/api/avisos?tipo=evento")).status, 400);
    } finally { f.sqlite.close(); }
  });
  it("pagina avisos antigos por cursor estável, respeitando a loja e o total de não lidos", async () => {
    const f = fixture();
    try {
      const insert = f.sqlite.prepare(
        "INSERT INTO avisos (id,tipo,titulo,mensagem,criado_em) VALUES (?,'aviso',?,'Sintético','2026-11-20T10:00:00.000Z')"
      );
      for (let i = 0; i < 62; i++) {
        const id = "global-" + String(i).padStart(3, "0");
        insert.run(id, "Aviso " + i);
      }
      f.sqlite.prepare("INSERT INTO avisos (id,tipo,titulo,mensagem,criado_em) VALUES ('evento','evento','Evento','Sintético','2026-11-20T10:00:00.000Z')").run();
      f.sqlite.prepare("INSERT INTO avisos (id,tipo,titulo,mensagem,criado_em) VALUES ('so-loja-02','aviso','Direcionado','Sintético','2026-11-20T10:00:00.000Z')").run();
      f.sqlite.prepare("INSERT INTO avisos_lojas VALUES ('so-loja-02','02','loja2')").run();
      const primeira = await (await f.call("conf1", "/api/avisos")).json();
      assert.equal(primeira.avisos.length, 50);
      assert.equal(primeira.naoLidos, 62);
      assert.equal(primeira.hasMore, true);
      assert.ok(primeira.nextCursor);
      assert.equal(primeira.avisos.every(a => a.tipo === "aviso"), true);
      f.sqlite.prepare(
        "INSERT INTO avisos (id,tipo,titulo,mensagem,criado_em) VALUES ('novo','aviso','Publicado depois','Sintético','2026-11-21T10:00:00.000Z')"
      ).run();
      const query = new URLSearchParams({
        before: primeira.nextCursor.criadoEm, beforeId: primeira.nextCursor.id
      });
      const segunda = await (await f.call("conf1", "/api/avisos?" + query)).json();
      assert.equal(segunda.avisos.length, 12);
      assert.equal(segunda.hasMore, false);
      assert.equal(segunda.nextCursor, null);
      assert.equal(segunda.naoLidos, 63, "a contagem independe da página");
      const ids = [...primeira.avisos, ...segunda.avisos].map(a => a.id);
      assert.equal(new Set(ids).size, 62, "sem duplicação com novos avisos");
      assert.ok(ids.every(id => id.startsWith("global-")));
      assert.equal((await f.call("conf1", "/api/avisos?before=2026-11-20")).status, 400);
      assert.equal((await f.call("conf1", "/api/avisos?beforeId=qualquer")).status, 400);
      assert.equal((await f.call("conf1", "/api/avisos?before=invalido&beforeId=id")).status, 400);
      const adm = await (await f.call("adm1", "/api/avisos")).json();
      assert.equal(adm.naoLidos, 64, "administrador vê direcionado, mas não evento");
      await f.call("conf1", "/api/avisos/marcar-todos", { method: "POST" });
      assert.equal((await (await f.call("conf1", "/api/avisos")).json()).naoLidos, 0);
    } finally {
      f.sqlite.close();
    }
  });

  it("conferente publica mensagem no canal; visualizador não acessa", async () => {
    const f = fixture();
    try {
      const envio = await f.call("conf1", "/api/avisos", {
        method: "POST",
        body: { mensagem: " Bom dia; a doca 1 está livre. " }
      });
      assert.equal(envio.status, 201);
      const mensagem = await envio.json();
      // Contrato: a resposta é um aviso completo de tipo chat, sem título.
      const contrato = avisoSchema.safeParse(mensagem);
      assert.equal(contrato.success, true);
      assert.equal(contrato.success && contrato.data.tipo, "chat");
      assert.equal(contrato.success && contrato.data.titulo, null);
      assert.equal(contrato.success && contrato.data.mensagem, "Bom dia; a doca 1 está livre.");
      assert.equal(contrato.success && contrato.data.autor, "Conferente 1");
      assert.equal(contrato.success && contrato.data.urgente, false);
      assert.equal(contrato.success && contrato.data.lojas, null);
      assert.equal(contrato.success && contrato.data.lido, true);
      assert.equal(contrato.success && contrato.data.proprio, true, "quem publica recebe a própria mensagem");
      assert.equal(f.auditCount("mensagem_do_canal_publicada"), 1);
      const visaoAutor = await (await f.call("conf1", "/api/avisos")).json();
      assert.equal(visaoAutor.naoLidos, 0);
      assert.equal(visaoAutor.avisos[0].lido, true);
      // Mensagem é global: entra na lista e no badge dos outros usuários.
      const visaoConf2 = await (await f.call("conf2", "/api/avisos")).json();
      assert.equal(visaoConf2.naoLidos, 1);
      assert.equal(visaoConf2.avisos[0].tipo, "chat");
      assert.equal(visaoConf2.avisos[0].titulo, null);
      assert.equal(visaoConf2.avisos[0].autor, "Conferente 1");
      assert.equal(visaoConf2.avisos[0].proprio, false, "mensagem do colega não é própria");
      const visaoAdm = await (await f.call("adm1", "/api/avisos")).json();
      assert.equal(visaoAdm.naoLidos, 1);
      assert.equal((await f.call("view1", "/api/avisos")).status, 403);
      // Visualizador não acessa nem escreve no canal.
      const negado = await f.call("view1", "/api/avisos", {
        method: "POST", body: { mensagem: "Só observando." }
      });
      assert.equal(negado.status, 403);
      assert.equal((await negado.json()).error, "SEM_PERMISSAO");
      // Corpo inválido é rejeitado sem gravar nada.
      const invalido = await f.call("conf1", "/api/avisos", {
        method: "POST", body: { mensagem: "   " }
      });
      assert.equal(invalido.status, 400);
      assert.equal(f.avisosCount(), 1, "uma única mensagem gravada");
    } finally {
      f.sqlite.close();
    }
  });

  it("canal respeita o limitador: 429 quando limitado e 503 sem limitador", async () => {
    const limitado = fixture({ limiter: { limit: async () => ({ success: false }) } });
    try {
      const resposta429 = await limitado.call("conf1", "/api/avisos", {
        method: "POST", body: { mensagem: "Mensagem demais." }
      });
      assert.equal(resposta429.status, 429);
      assert.equal((await resposta429.json()).error, "MUITAS_MENSAGENS");
      assert.equal(limitado.avisosCount(), 0);
    } finally {
      limitado.sqlite.close();
    }
    const semLimitador = fixture({ limiter: null });
    try {
      // Falha fechado: sem limitador, nada é gravado.
      const resposta503 = await semLimitador.call("conf1", "/api/avisos", {
        method: "POST", body: { mensagem: "Mensagem." }
      });
      assert.equal(resposta503.status, 503);
      assert.equal((await resposta503.json()).error, "INDISPONIVEL");
      assert.equal(semLimitador.avisosCount(), 0);
    } finally {
      semLimitador.sqlite.close();
    }
  });

  it("régua do admin mostra quem viu o aviso oficial e quem está pendente", async () => {
    const f = fixture();
    try {
      // Mensagem do canal não tem régua: leitores é só do aviso oficial.
      const envio = await f.call("conf1", "/api/avisos", { method: "POST", body: { mensagem: "Recado no canal." } });
      const mensagemId = (await envio.json()).id;
      const leitoresDaMensagem = await f.call("adm1", `/api/admin/avisos/${mensagemId}/leitores`);
      assert.equal(leitoresDaMensagem.status, 404);

      const publicacao = await f.call("adm1", "/api/admin/avisos", {
        method: "POST",
        body: { titulo: "Só loja 01", mensagem: "Recado interno.", lojas: ["01"] }
      });
      const aviso01 = (await publicacao.json()).id;
      // Antes da leitura: o conferente destinatário é o público pendente.
      const antes = await (await f.call("adm1", `/api/admin/avisos/${aviso01}/leitores`)).json();
      assert.equal(leitoresAvisoSchema.safeParse(antes).success, true);
      assert.deepEqual(antes.vistos, []);
      assert.deepEqual(antes.faltantes, [
        { id: "conf1", nome: "Conferente 1", lidoEm: null, loja: "01" }
      ]);
      // Publicação geral: os dois conferentes são o público.
      const geral = await f.call("adm1", "/api/admin/avisos", {
        method: "POST", body: { titulo: "Geral", mensagem: "Para todos." }
      });
      const avisoGeral = (await geral.json()).id;
      // Conferente abre o canal: leitura automática (marcar-todos).
      await f.call("conf2", "/api/avisos/marcar-todos", { method: "POST" });
      const meio = await (await f.call("adm1", `/api/admin/avisos/${avisoGeral}/leitores`)).json();
      assert.equal(meio.vistos.length, 1);
      assert.equal(meio.vistos[0].id, "conf2");
      assert.equal(meio.vistos[0].loja, "02");
      assert.ok(meio.vistos[0].lidoEm);
      assert.equal(meio.faltantes.length, 1);
      assert.equal(meio.faltantes[0].id, "conf1");
      // O direcionado à 01 não é visível ao conf2: marcar-todos dele não
      // gravou leitura fora do que enxerga.
      const direcionadoDepois = await (await f.call("adm1", `/api/admin/avisos/${aviso01}/leitores`)).json();
      assert.deepEqual(direcionadoDepois.faltantes.map(p => p.id), ["conf1"]);
      await f.call("conf1", "/api/avisos/marcar-todos", { method: "POST" });
      const depois = await (await f.call("adm1", `/api/admin/avisos/${aviso01}/leitores`)).json();
      assert.equal(depois.vistos.length, 1);
      assert.equal(depois.vistos[0].id, "conf1");
      assert.ok(depois.vistos[0].lidoEm);
      assert.equal(depois.faltantes.length, 0);
      // Conferente não acessa a régua: /api/admin/* exige admin.
      const negado = await f.call("conf1", `/api/admin/avisos/${aviso01}/leitores`);
      assert.equal(negado.status, 403);
    } finally {
      f.sqlite.close();
    }
  });

});


describe("Reações do canal", () => {
  it("persiste uma reação por pessoa, permite troca e remoção, sem confirmar leitura", async () => {
    const f = fixture();
    try {
      const published = await f.call("adm1", "/api/admin/avisos", { method: "POST", body: { titulo: "Reação", mensagem: "Teste" } });
      assert.equal(published.status, 201);
      const { id } = await published.json();
      const path = "/api/avisos/" + id + "/reacao";
      const react = (user, emoji) => f.call(user, path, { method: "PUT", body: { emoji } });
      assert.equal((await react("adm1", "👍")).status, 404);
      assert.equal((await react("view1", "👍")).status, 403);
      assert.equal((await react("conf1", "👏")).status, 400);
      assert.equal((await react("conf1", "👍")).status, 200);
      assert.equal((await react("conf1", "👍")).status, 200);
      const changed = await (await react("conf1", "👀")).json();
      assert.deepEqual(changed.reacoes, [{ emoji: "👀", nome: "Conferente 1", proprio: true }]);
      assert.equal((await react("conf2", "😂")).status, 200);
      const lista = await (await f.call("adm1", "/api/avisos")).json();
      assert.equal(lista.avisos[0].reacoes.length, 2);
      assert.ok(lista.avisos[0].reacoes.every(r => !r.proprio));
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM avisos_lidos").get().n, 0);
      assert.equal((await react("conf1", null)).status, 200);
      assert.equal((await react("conf1", null)).status, 200);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM avisos_reacoes").get().n, 1);
      assert.equal((await f.call("view1", "/api/avisos/" + id + "/lido", { method: "POST" })).status, 403);
      assert.equal((await f.call("view1", "/api/avisos/marcar-todos", { method: "POST" })).status, 403);
    } finally { f.sqlite.close(); }
  });
  it("bloqueia reações a avisos de outra loja, eventos e registros inexistentes", async () => {
    const f = fixture();
    try {
      const pub = await f.call("adm1", "/api/admin/avisos", { method: "POST", body: { titulo: "Direcionado", mensagem: "Teste", lojas: ["01"] } });
      assert.equal(pub.status, 201);
      const { id } = await pub.json();
      f.sqlite.prepare("INSERT INTO avisos (id, tipo, titulo, mensagem, criado_em) VALUES ('ev-reacao','evento','Evento','Teste','2026-11-12T12:00:00.000Z')").run();
      for (const target of [id, "ev-reacao", "ausente"]) {
        assert.equal((await f.call("conf2", "/api/avisos/" + target + "/reacao", { method: "PUT", body: { emoji: "👍" } })).status, 404);
      }
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM avisos_reacoes").get().n, 0);
    } finally { f.sqlite.close(); }
  });
});

describe("Identidade imutável de destino", () => {
  it("mantém visibilidade, leitores e reações depois de renomear o código da loja", async () => {
    const f = fixture();
    try {
      const res = await f.call("adm1", "/api/admin/avisos", { method: "POST", body: { titulo: "Destino", mensagem: "Teste", lojas: ["01"] } });
      assert.equal(res.status, 201);
      const { id } = await res.json();
      f.sqlite.prepare("UPDATE lojas SET codigo = '99' WHERE id = 'loja1'").run();
      f.sqlite.prepare("UPDATE lojas SET codigo = '01' WHERE id = 'loja2'").run();
      const conf1 = await (await f.call("conf1", "/api/avisos")).json();
      assert.deepEqual(conf1.avisos.map(a => a.id), [id]);
      assert.deepEqual(conf1.avisos[0].lojas, ["99"]);
      const conf2 = await (await f.call("conf2", "/api/avisos")).json();
      assert.equal(conf2.avisos.length, 0);
      assert.equal((await f.call("conf1", "/api/avisos/" + id + "/reacao", { method: "PUT", body: { emoji: "👍" } })).status, 200);
      assert.equal((await f.call("conf2", "/api/avisos/" + id + "/reacao", { method: "PUT", body: { emoji: "👍" } })).status, 404);
      const leitores = await (await f.call("adm1", "/api/admin/avisos/" + id + "/leitores")).json();
      assert.deepEqual(leitores.faltantes.map(p => p.id), ["conf1"]);
    } finally { f.sqlite.close(); }
  });
});
