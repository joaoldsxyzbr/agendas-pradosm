import { test, expect } from "@playwright/test";

const admin = { id: "admin-sintetico", nome: "Administrador Teste", papel: "admin" };
const conferente = { id: "c1", nome: "Conferente Doca", papel: "conferente", lojaId: "s1", lojaCodigo: "F03", lojaNome: "Loja Central" };
const visualizador = { id: "v1", nome: "Visualizador Teste", papel: "visualizador" };
const stores = [
  { id: "s1", codigo: "F03", nome: "Loja Central", ativo: true },
  { id: "s2", codigo: "F07", nome: "Loja Norte", ativo: true },
];

// A API entrega o canal do mais recente para o mais antigo; a página do chat
// inverte a ordem. "proprio" alinha a bolha do próprio autor à direita.
function buildCanal() {
  return {
    avisos: [
      { id: "av1", tipo: "aviso", titulo: "Doca 3 fechada", mensagem: "A doca 3 fica fechada nesta semana.", criadoEm: "2026-11-11T11:00:00.000Z", lido: false, urgente: true, autor: "Administrador Teste", lojas: null, proprio: false },
      { id: "msg1", tipo: "chat", titulo: null, mensagem: "Bom dia! Doca 2 liberada para descarregamento.", criadoEm: "2026-11-11T10:30:00.000Z", lido: false, urgente: false, autor: "Conferente Doca", lojas: null, proprio: false },
      { id: "av2", tipo: "evento", titulo: "Dia concluído", mensagem: "Dia de conferência concluído: Loja Central em 11/11/2026.", criadoEm: "2026-11-11T09:00:00.000Z", lido: true, urgente: false, autor: "Sistema", lojas: null, proprio: false },
    ],
    naoLidos: 2,
    hasMore: false,
    nextCursor: null,
  };
}

async function setup(page, { role = "admin", paginated = false, realtime = false } = {}) {
  const user = role === "admin" ? admin : role === "visualizador" ? visualizador : conferente;
  const state = { data: buildCanal(), nextId: 0 };
  const requests = [];
  // Erros não tratados do app aparecem no log do job do CI; o boundary de erro
  // reporta o erro de render via POST /api/diagnostics/events — o mock no
  // handler imprime o corpo no log para diagnóstico.
  page.on("pageerror", error => console.log("PAGEERROR:", error.message));
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;
    const body = method === "GET" ? null : route.request().postDataJSON();
    requests.push({ path, method, body, search: url.search });
    // Diagnóstico do AppErrorBoundary: logar o corpo no job e responder 204.
    if (path === "/api/diagnostics/events") {
      console.log("DIAGNOSTICS-BODY:", route.request().postData() ?? "(vazio)");
      return route.fulfill({ status: 204, body: "" });
    }
    if (path === "/api/auth/me") return route.fulfill({ json: user });
    if (path === "/api/realtime/config") return route.fulfill({ json: { mode: realtime ? "on" : "off", protocolVersion: 1 } });
    if (path === "/api/avisos" && method === "GET") {
      if (paginated && url.searchParams.has("before")) {
        return route.fulfill({ json: {
          avisos: [{ id: "av-antigo", tipo: "aviso", titulo: "Aviso histórico", mensagem: "Registro antigo do canal.", criadoEm: "2026-11-10T08:00:00.000Z", lido: true, urgente: false, autor: "Administrador Teste", lojas: null, proprio: false }],
          naoLidos: state.data.naoLidos, hasMore: false, nextCursor: null,
        } });
      }
      if (paginated) return route.fulfill({ json: {
        ...state.data, hasMore: true,
        nextCursor: { criadoEm: "2026-11-11T09:00:00.000Z", id: "av2" },
      } });
      const tipo = url.searchParams.get("tipo");
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return route.fulfill({ json: { ...state.data, avisos: state.data.avisos.filter(a => (!tipo || a.tipo === tipo) && (!q || [a.titulo, a.mensagem, a.autor].join(" ").toLowerCase().includes(q))) } });
    }
    if (path === "/api/avisos" && method === "POST") {
      // Mensagem comum do canal (tipo "chat"): sempre global e do próprio autor.
      const created = {
        id: "msg-nova-" + ++state.nextId, tipo: "chat", titulo: null, mensagem: body.mensagem,
        criadoEm: "2026-11-11T12:00:00.000Z", lido: true, urgente: false,
        autor: user.nome, lojas: null, proprio: true,
      };
      state.data = { ...state.data, avisos: [created, ...state.data.avisos] };
      return route.fulfill({ status: 201, json: created });
    }
    if (/^\/api\/avisos\/([^/]+)\/reacao$/.test(path) && method === "PUT") {
      const id = path.split("/")[3]!;
      const alvo = state.data.avisos.find(a => a.id === id);
      if (!alvo) return route.fulfill({ status: 404, json: {} });
      const reacoes = [...(alvo.reacoes ?? []).filter(r => !r.proprio), ...(body.emoji ? [{ emoji: body.emoji, nome: user.nome, proprio: true }] : [])];
      state.data = { ...state.data, avisos: state.data.avisos.map(a => a.id === id ? { ...a, reacoes } : a) };
      return route.fulfill({ json: { reacoes } });
    }
    if (/^\/api\/avisos\/([^/]+)\/lido$/.test(path) && method === "POST") {
      const id = path.split("/")[3]!;
      state.data = {
        ...state.data,
        avisos: state.data.avisos.map(a => (a.id === id ? { ...a, lido: true } : a)),
        naoLidos: Math.max(0, state.data.naoLidos - 1),
      };
      return route.fulfill({ json: { jaLido: false } });
    }
    if (path === "/api/avisos/marcar-todos" && method === "POST") {
      const naoLidos = state.data.naoLidos;
      state.data = {
        ...state.data,
        avisos: state.data.avisos.map(a => ({ ...a, lido: true })),
        naoLidos: 0,
      };
      return route.fulfill({ json: { ok: true, marcados: naoLidos } });
    }
    if (path === "/api/admin/avisos" && method === "POST") {
      const created = {
        id: "av-novo-" + ++state.nextId, tipo: "aviso", titulo: body.titulo, mensagem: body.mensagem,
        criadoEm: "2026-11-11T12:00:00.000Z", lido: false, urgente: body.urgente ?? false,
        autor: "Administrador Teste", lojas: body.lojas ?? null, proprio: false,
      };
      state.data = { ...state.data, avisos: [created, ...state.data.avisos], naoLidos: state.data.naoLidos + 1 };
      return route.fulfill({ status: 201, json: created });
    }
    if (/^\/api\/admin\/avisos\/(.+)\/leitores$/.test(path) && method === "GET") {
      return route.fulfill({ json: {
        vistos: [{ id: "c1", nome: "Conferente Doca", lidoEm: "2026-11-11T11:30:00.000Z", loja: "F03" }],
        faltantes: [],
      } });
    }
    // Mocks mínimos das páginas hospedeiras e do diálogo de publicação.
    if (role === "admin" || role === "visualizador") {
      if (path === "/api/admin/presence") return route.fulfill({ json: [] });
      if (path === "/api/admin/stores") return route.fulfill({ json: stores });
      if (path === "/api/admin/users" && method === "GET") return route.fulfill({ json: [] });
      if (path === "/api/admin/agendas") return route.fulfill({ json: [] });
      if (path === "/api/admin/audit") return route.fulfill({ json: [] });
    } else {
      if (path.startsWith("/api/store/tags/agenda/")) return route.fulfill({ json: { tags: [], assignments: {} } });
      if (path === "/api/store/today" || path.startsWith("/api/store/history/")) return route.fulfill({ json: { agenda: null, appointments: [] } });
      if (path === "/api/store/presence") {
        if (method === "DELETE") return route.fulfill({ status: 204, body: "" });
        return route.fulfill({ json: { ok: true, recordedAt: "2026-11-11T09:00:00.000Z" } });
      }
    }
    throw Error("Endpoint inesperado no teste de avisos: " + method + " " + path);
  });
  await page.goto(role === "conferente" ? "/app" : "/admin/avisos");
  return Object.assign(requests, { state });
}

test("Conferente lê mensagens, confirma aviso oficial e escreve", async ({ page }) => {
  const requests = await setup(page, { role: "conferente" });
  // O menu renderiza duas cópias (aside desktop e navegação móvel): os
  // locators do link e do badge ficam escopados no aside visível.
  const linkAvisos = page.locator("aside").getByRole("link", { name: "Avisos" });
  await expect(linkAvisos).toBeVisible();
  // Badge da migração do sino: conta TODAS as pendências e pulsa vermelho
  // enquanto houver urgente não lido.
  const badge = page.locator("aside").getByTestId("avisos-badge");
  await expect(badge).toHaveText("2");
  await expect(badge).toHaveClass(/bg-red-500/);
  await linkAvisos.click();
  await expect(page).toHaveURL(/\/app\/avisos$/);
  await expect(page.getByRole("heading", { name: "Avisos" })).toBeVisible();
  // Mensagens visíveis são lidas automaticamente; aviso oficial exige confirmação.
  await expect(badge).toHaveText("1");
  // Canal único: mensagem do colega e aviso urgente, sem eventos automáticos.
  const canal = page.getByTestId("avisos-mensagens");
  await expect(canal.getByRole("heading", { name: "Dia concluído" })).toHaveCount(0);
  await expect(canal.getByText("Bom dia! Doca 2 liberada para descarregamento.")).toBeVisible();
  const urgente = page.getByRole("article", { name: "Doca 3 fechada" });
  await expect(urgente).toBeVisible();
  await expect(urgente.getByText("Urgente")).toBeVisible();
  await expect(urgente.getByText("Todas as lojas")).toBeVisible();
  await urgente.getByRole("button", { name: "Confirmar leitura" }).click();
  await expect(badge).toHaveCount(0);
  // Conferente escreve mensagem no canal, mas não publica aviso oficial.
  await expect(page.getByRole("button", { name: "Novo aviso" })).toHaveCount(0);
  await page.getByLabel("Mensagem do canal").fill("Chegando na doca 4.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("Chegando na doca 4.")).toBeVisible();
  const enviada = requests.find(x => x.path === "/api/avisos" && x.method === "POST");
  expect(enviada?.body).toEqual({ mensagem: "Chegando na doca 4." });
  // A própria mensagem vem alinhada à direita ("proprio" do servidor).
  await expect(page.getByTestId("chat-proprio").filter({ hasText: "Chegando na doca 4." })).toBeVisible();
});

test("Visualizador não acessa o canal nem consulta notificações", async ({ page }) => {
  const requests = await setup(page, { role: "visualizador" });
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("link", { name: "Avisos", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Avisos", exact: true })).toHaveCount(0);
  expect(requests.some(r => r.path === "/api/avisos")).toBe(false);
});

test("Admin publica aviso urgente direcionado e acompanha quem viu", async ({ page }) => {
  const requests = await setup(page, { role: "admin" });
  await expect(page.getByRole("article", { name: "Doca 3 fechada" })).toBeVisible();
  await page.getByRole("button", { name: "Novo aviso" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo aviso" });
  await dialog.getByLabel("Título do aviso").fill("Inventário loja Central");
  await dialog.getByLabel("Mensagem do aviso").fill("Inventário geral amanhã às 7h; recebimentos a partir das 9h.");
  // Sem expiração: o aviso é registro permanente.
  await expect(dialog.getByLabel(/expira/i)).toHaveCount(0);
  await dialog.getByLabel("Aviso urgente").check();
  await dialog.getByRole("button", { name: "Escolher lojas" }).click();
  await dialog.getByRole("button", { name: "F03", exact: true }).click();
  await dialog.getByRole("button", { name: "Publicar aviso" }).click();
  await expect(dialog).not.toBeVisible();
  const publicado = page.getByRole("article", { name: "Inventário loja Central" });
  await expect(publicado).toBeVisible();
  await expect(publicado.getByText("Urgente")).toBeVisible();
  await expect(publicado.getByText("Loja F03")).toBeVisible();
  await expect(publicado.getByText(/por Administrador Teste/)).toBeVisible();
  const publish = requests.find(x => x.path === "/api/admin/avisos" && x.method === "POST");
  expect(publish?.body).toEqual({ titulo: "Inventário loja Central", mensagem: "Inventário geral amanhã às 7h; recebimentos a partir das 9h.", urgente: true, lojas: ["F03"] });
  // Registro permanente: ninguém inativa aviso.
  await expect(page.getByRole("button", { name: /Inativar aviso/ })).toHaveCount(0);
  // Régua do admin: expande e consulta quem já viu o aviso.
  const leitores = publicado.locator("details").first();
  await expect(leitores.locator("summary")).toHaveText("Consultar leituras");
  await leitores.locator("summary").click();
  await expect(leitores.locator("summary")).toHaveText("Visto por 1 de 1");
  await expect(leitores.getByText(/Conferente Doca \(F03\) — visto às/)).toBeVisible();
});

test("Canal carrega mensagens anteriores sem substituir as recentes", async ({ page }) => {
  const requests = await setup(page, { role: "admin", paginated: true });
  await expect(page.getByRole("article", { name: "Doca 3 fechada" })).toBeVisible();
  await page.getByRole("button", { name: "Carregar mensagens anteriores" }).click();
  await expect(page.getByRole("article", { name: "Aviso histórico" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Doca 3 fechada" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Carregar mensagens anteriores" })).toHaveCount(0);
  expect(requests.some(request => request.path === "/api/avisos" && request.search.includes("before="))).toBe(true);
});

test("Canal único pesquisa avisos e mensagens e preserva texto quando o envio falha", async ({ page }) => {
  const requests = await setup(page, { role: "admin" });
  const canal = page.getByTestId("avisos-mensagens");
  await expect(canal.getByText("Bom dia! Doca 2 liberada para descarregamento.")).toBeVisible();
  await expect(canal.getByRole("article", { name: "Doca 3 fechada" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Conversas|Avisos oficiais)$/ })).toHaveCount(0);
  await page.getByLabel("Pesquisar mensagens e avisos").fill("Doca");
  await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
  await expect.poll(() => requests.some(r => r.path === "/api/avisos" && r.method === "GET" && r.search === "?q=Doca")).toBe(true);
  await expect(canal.getByText("Bom dia! Doca 2 liberada para descarregamento.")).toBeVisible();
  await expect(canal.getByRole("article", { name: "Doca 3 fechada" })).toBeVisible();
  await page.getByLabel("Pesquisar mensagens e avisos").fill("Doca 3");
  await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
  await expect(page.getByRole("article", { name: "Doca 3 fechada" })).toBeVisible();
  await expect(canal.getByText("Bom dia! Doca 2 liberada para descarregamento.")).toHaveCount(0);
  await expect(page.getByLabel("Mensagem do canal")).toBeVisible();
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  await expect(canal.getByText("Bom dia! Doca 2 liberada para descarregamento.")).toBeVisible();
  await page.route("**/api/avisos", async route => {
    if (route.request().method() === "POST") return route.fulfill({ status: 503, json: { message: "Envio indisponível." } });
    return route.fallback();
  });
  await page.getByLabel("Mensagem do canal").fill("Texto preservado");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Mensagem do canal")).toHaveValue("Texto preservado");
});


test("Enviar durante a pesquisa volta ao canal completo", async ({ page }) => {
  await setup(page, { role: "admin" });
  await page.getByLabel("Pesquisar mensagens e avisos").fill("Doca 3");
  await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
  await expect(page.getByText("Bom dia! Doca 2 liberada para descarregamento.")).toHaveCount(0);
  await page.getByLabel("Mensagem do canal").fill("Nova mensagem do canal");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("Nova mensagem do canal")).toBeVisible();
  await expect(page.getByLabel("Pesquisar mensagens e avisos")).toHaveValue("");
  await expect(page.getByText("Bom dia! Doca 2 liberada para descarregamento.")).toBeVisible();
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 740 }]) {
  test(`Canal integrado ocupa a área útil em ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await setup(page, { role: "admin", paginated: true });
    const canal = page.getByTestId("avisos-mensagens");
    const section = page.getByRole("region", { name: "Avisos", exact: true });
    const heading = page.getByRole("heading", { name: "Avisos", exact: true });
    const composer = page.getByLabel("Mensagem do canal");
    await expect(heading).toBeInViewport();
    await expect(composer).toBeInViewport();
    await expect(canal.getByRole("article", { name: "Doca 3 fechada" })).toBeVisible();
    const area = await section.boundingBox();
    const main = await page.getByRole("main").boundingBox();
    expect(area).not.toBeNull();
    expect(main).not.toBeNull();
    expect(Math.abs(area!.width - main!.width)).toBeLessThan(1);
    expect(Math.abs(area!.height - main!.height)).toBeLessThan(1);
    await expect(page.getByRole("button", { name: /^(Conversas|Avisos oficiais)$/ })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
}


test("Reage, troca e remove reação sem marcar aviso como lido", async ({ page }) => {
  const requests = await setup(page, { role: "admin" });
  const aviso = page.getByTestId("reacoes-av1");
  await aviso.getByRole("button", { name: "Reagir" }).click();
  await aviso.getByRole("button", { name: "De acordo" }).click();
  await expect(aviso.getByText("👍 1")).toBeVisible();
  await aviso.getByRole("button", { name: "Reagir" }).click();
  await aviso.getByRole("button", { name: "Acompanhando" }).click();
  await expect(aviso.getByText("👀 1")).toBeVisible();
  await expect(aviso.getByText("👍 1")).toHaveCount(0);
  await aviso.locator("summary").click();
  await expect(aviso.getByText("Administrador Teste (você)")).toBeVisible();
  await aviso.getByRole("button", { name: "Reagir" }).click();
  await aviso.getByRole("button", { name: "Acompanhando" }).click();
  await expect(aviso.getByText("👀 1")).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Doca 3 fechada" }).getByRole("button", { name: "Confirmar leitura" })).toBeVisible();
  expect(requests.filter(r => r.path === "/api/avisos/av1/reacao").map(r => r.body.emoji)).toEqual(["👍", "👀", null]);
});

test("Toast realtime aparece uma vez para novo aviso fora da área visível", async ({ page }) => {
  let socket;
  await page.routeWebSocket("**/api/realtime", ws => {
    socket = ws;
    ws.onMessage(message => { if (message === "ping") ws.send("pong"); });
    ws.send(JSON.stringify({ version: 1, type: "realtime.ready" }));
  });
  const requests = await setup(page, { realtime: true });
  await expect(page.getByRole("article", { name: "Doca 3 fechada" })).toBeVisible();
  await expect.poll(() => Boolean(socket)).toBe(true);
  await expect(page.getByTestId("aviso-toast")).toHaveCount(0);
  await page.getByLabel("Pesquisar mensagens e avisos").fill("Doca 3");
  await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
  await expect(page.getByText("Resultados para:")).toBeVisible();
  await expect(page.getByText("Bom dia! Doca 2 liberada para descarregamento.")).toHaveCount(0);
  const aviso = { id: "av-realtime", tipo: "aviso", titulo: "Entrega urgente", mensagem: "Nova publicação operacional.", criadoEm: "2026-11-11T13:00:00.000Z", lido: false, urgente: true, autor: "Outro administrador", lojas: null, proprio: false };
  requests.state.data = { ...requests.state.data, avisos: [aviso, ...requests.state.data.avisos], naoLidos: 2 };
  const signal = JSON.stringify({ version: 1, type: "avisos.changed" });
  socket.send(signal);
  const toast = page.getByTestId("aviso-toast");
  await expect(toast).toHaveCount(1);
  await expect(toast.getByText("Novo aviso urgente")).toBeVisible();
  await expect(toast.getByText("Entrega urgente")).toBeVisible();
  await toast.getByRole("button", { name: "Fechar notificação" }).click();
  const count = requests.filter(r => r.path === "/api/avisos" && r.method === "GET").length;
  socket.send(signal);
  await expect.poll(() => requests.filter(r => r.path === "/api/avisos" && r.method === "GET").length).toBeGreaterThan(count);
  await expect(toast).toHaveCount(0);
  // Uma atualização exclusiva das reações não é uma nova publicação.
  requests.state.data = { ...requests.state.data, avisos: requests.state.data.avisos.map(a => a.id === aviso.id ? { ...a, reacoes: [{ emoji: "👀", nome: "Conferente", proprio: false }] } : a) };
  socket.send(signal);
  await expect(toast).toHaveCount(0);
});
