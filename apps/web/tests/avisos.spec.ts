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

async function setup(page, { role = "admin", paginated = false } = {}) {
  const user = role === "admin" ? admin : role === "visualizador" ? visualizador : conferente;
  const state = { data: buildCanal(), nextId: 0 };
  const requests = [];
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;
    const body = method === "GET" ? null : route.request().postDataJSON();
    requests.push({ path, method, body, search: url.search });
    if (path === "/api/auth/me") return route.fulfill({ json: user });
    if (path === "/api/realtime/config") return route.fulfill({ json: { mode: "off", protocolVersion: 1 } });
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
      return route.fulfill({ json: state.data });
    }
    if (path === "/api/avisos" && method === "POST") {
      // Mensagem comum do canal (tipo "chat"): sempre global e do próprio autor.
      const created = {
        id: "msg-nova-" + ++state.nextId, tipo: "chat", titulo: null, mensagem: body.mensagem,
        criadoEm: "2026-11-11T12:00:00.000Z", lido: false, urgente: false,
        autor: user.nome, lojas: null, proprio: true,
      };
      state.data = { ...state.data, avisos: [created, ...state.data.avisos], naoLidos: state.data.naoLidos + 1 };
      return route.fulfill({ status: 201, json: created });
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
  return requests;
}

test("Conferente vê o badge no menu, abre o canal com leitura automática e escreve", async ({ page }) => {
  const requests = await setup(page, { role: "conferente" });
  const linkAvisos = page.getByRole("link", { name: "Avisos (Desenvolvimento)" });
  await expect(linkAvisos).toBeVisible();
  // Badge da migração do sino: conta TODAS as pendências e pulsa vermelho
  // enquanto houver urgente não lido.
  const badge = page.getByTestId("avisos-badge");
  await expect(badge).toHaveText("2");
  await expect(badge).toHaveClass(/bg-red-500/);
  await linkAvisos.click();
  await expect(page).toHaveURL(/\/app\/avisos$/);
  await expect(page.getByRole("heading", { name: "Avisos" })).toBeVisible();
  // Leitura automática estilo WhatsApp: abrir o canal dispara o marcar-todos
  // e zera o badge do menu.
  await expect.poll(() =>
    requests.filter(x => x.path === "/api/avisos/marcar-todos" && x.method === "POST").length
  ).toBeGreaterThanOrEqual(1);
  await expect(badge).toHaveCount(0);
  // Canal cronológico: evento antigo, mensagem do colega e aviso urgente.
  const canal = page.getByTestId("avisos-mensagens");
  await expect(canal.getByRole("heading", { name: "Dia concluído" })).toBeVisible();
  await expect(canal.getByText("Bom dia! Doca 2 liberada para descarregamento.")).toBeVisible();
  const urgente = page.getByRole("article", { name: "Doca 3 fechada" });
  await expect(urgente).toBeVisible();
  await expect(urgente.getByText("Urgente")).toBeVisible();
  await expect(urgente.getByText("Todas as lojas")).toBeVisible();
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

test("Visualizador acompanha o canal sem escrever", async ({ page }) => {
  await setup(page, { role: "visualizador" });
  await expect(page.getByRole("heading", { name: "Avisos" })).toBeVisible();
  // Sem compositor e sem publicação: o visualizador só lê.
  await expect(page.getByRole("textbox", { name: "Mensagem do canal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Novo aviso" })).toHaveCount(0);
  await expect(page.getByText(/Somente leitura/)).toBeVisible();
  // Visualizador também vê os eventos do sistema no canal.
  await expect(page.getByRole("heading", { name: "Dia concluído" })).toBeVisible();
});

test("Admin publica aviso urgente direcionado e acompanha quem viu", async ({ page }) => {
  const requests = await setup(page, { role: "admin" });
  // Leitura automática limpa as pendências antes da publicação.
  const badge = page.getByTestId("avisos-badge");
  await expect(badge).toHaveCount(0);
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
