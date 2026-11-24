import { test, expect } from "@playwright/test";

const admin = { id: "adm", nome: "ADM Teste", papel: "admin" };
const viewer = { id: "view", nome: "Visualizador", papel: "visualizador" };
const conference = { id: "conf", nome: "Doca 01", papel: "conferente", lojaId: "1" };

async function sessionMocks(page, initialUser = null) {
  let current = initialUser;
  await page.route("**/api/realtime/config", route => route.fulfill({ json: { mode: "off", protocolVersion: 1 } }));
  await page.route("**/api/avisos", route => route.fulfill({ json: { avisos: [], naoLidos: 0 } }));
  await page.route("**/api/store/today", route => route.fulfill({ json: { agenda: null, appointments: [] } }));
  await page.route("**/api/store/presence", route => route.request().method() === "DELETE"
    ? route.fulfill({ status: 204, body: "" })
    : route.fulfill({ json: { ok: true, recordedAt: "2026-10-30T09:00:00.000Z" } }));
  await page.route("**/api/admin/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/admin/stores") return route.fulfill({ json: [] });
    if (path === "/api/admin/users") return route.fulfill({ json: [] });
    if (path === "/api/admin/audit") return route.fulfill({ json: [] });
    if (path === "/api/admin/diagnostics") return route.fulfill({ json: [] });
    if (path === "/api/admin/reports") return route.fulfill({ json: { start: new URL(route.request().url()).searchParams.get("start"), end: new URL(route.request().url()).searchParams.get("end"), storeCodes: [], rows: [], suppliers: [], semAgendaSuppliers: [] } });
    if (path === "/api/admin/reports/occurrences") return route.fulfill({ json: { total: 0, offset: Number(new URL(route.request().url()).searchParams.get("offset") || 0), limit: 50, rows: [] } });
    if (path === "/api/admin/agendas") return route.fulfill({ json: [] });
    if (path === "/api/admin/presence") return route.fulfill({ json: [] });
    throw new Error("Endpoint administrativo não previsto: " + path);
  });
  await page.route("**/api/auth/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/auth/me") {
      if (!current) return route.fulfill({ status: 401, json: { error: "SEM_SESSAO" } });
      return route.fulfill({ json: current });
    }
    if (path === "/api/auth/login" && method === "POST") {
      const body = route.request().postDataJSON();
      if (body.login !== "adm" || body.senha !== "senha-de-teste") {
        return route.fulfill({ status: 401, json: { error: "CREDENCIAIS_INVALIDAS", message: "Login ou senha inválidos." } });
      }
      current = admin;
      return route.fulfill({ json: current });
    }
    if (path === "/api/auth/logout" && method === "POST") {
      current = null;
      return route.fulfill({ status: 204 });
    }
    throw new Error("Endpoint não previsto: " + method + " " + path);
  });
}

test("React: login usa API e redireciona corretamente, sem frontend legado", async ({ page }) => {
  await sessionMocks(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await page.getByRole("textbox", { name: "Login" }).fill("adm");
  await page.locator('input[name="senha"]').fill("senha-de-teste");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Recebimento", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recebimento por loja" })).toBeVisible();
  await expect(page.locator(".prado-admin")).toHaveCount(0);
});
test("React: login inválido exibe erro sem trocar de página", async ({ page }) => {
  await sessionMocks(page);
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Login" }).fill("adm");
  await page.locator('input[name="senha"]').fill("senha-errada");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toContainText("Login ou senha inválidos.");
  await expect(page).toHaveURL(/\/login$/);
});
test("React: visualizador mantém somente as duas rotas permitidas", async ({ page }) => {
  await sessionMocks(page, viewer);
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("link", { name: "Usuários" })).toHaveCount(0);
  await page.getByRole("link", { name: "Relatório Gerencial" }).click();
  await expect(page.getByRole("heading", { name: "Relatório Gerencial" })).toBeVisible();
});
test("React: conferente fica na conferência e não acessa rotas administrativas", async ({ page }) => {
  await sessionMocks(page, conference);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Conferência de recebimentos" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Usuários" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tags" })).toHaveCount(0);
});
test("React: administrador pode navegar nas rotas sem dados operacionais falsos", async ({ page }) => {
  await sessionMocks(page, admin);
  for (const [path, heading] of [
    ["/admin", "Recebimento"],
    ["/admin/history", "Histórico"],
    ["/admin/stores", "Lojas"],
    ["/admin/users", "Usuários"],
    ["/admin/reports", "Relatório Gerencial"],
    ["/admin/agendas", "Agendas"],
    ["/admin/diagnostics", "Logs e Auditoria"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    if (path === "/admin") {
      await expect(page.getByRole("heading", { name: "Recebimento por loja" })).toBeVisible();
    } else if (path === "/admin/history") {
      await expect(page.getByRole("form", { name: "Filtros do histórico" })).toBeVisible();
    } else if (path === "/admin/reports") {
      await expect(page.locator('summary[aria-label="Editar período e lojas"]')).toBeVisible();
    } else if (path === "/admin/agendas") {
      await expect(page.getByText("Nenhuma agenda importada nesta data.")).toBeVisible();
    } else if (path === "/admin/stores") {
      await expect(page.getByRole("table", { name: "Lojas cadastradas" })).toBeVisible();
    } else if (path === "/admin/users") {
      await expect(page.getByRole("table", { name: "Usuários cadastrados" })).toBeVisible();
    } else if (path === "/admin/diagnostics") {
      await expect(page.getByRole("tablist", { name: "Categoria de registros" })).toBeVisible();
    } else {
      await expect(page.getByText("Esta tela ainda funciona somente na versão atual")).toBeVisible();
    }
  }
});
test("React: logout desautoriza navegação", async ({ page }) => {
  await sessionMocks(page, admin);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
});
test("React: layout compacto não cria rolagem lateral em celular", async ({ page }) => {
  await sessionMocks(page, viewer);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Recebimento", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
test("React: sidebar colapsa e persiste o estado entre recarregamentos", async ({ page }) => {
  await sessionMocks(page, admin);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/admin");
  const collapse = page.getByRole("button", { name: "Recolher navegação" });
  await expect(collapse).toBeVisible();
  await collapse.click();
  const expand = page.getByRole("button", { name: "Expandir navegação" });
  await expect(expand).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expandir navegação" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recolher navegação" })).toHaveCount(0);
  await page.getByRole("button", { name: "Expandir navegação" }).click();
  await expect(page.getByRole("button", { name: "Recolher navegação" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Recolher navegação" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Recebimento" })).toBeVisible();
});


test("React: agendador personalizado recebe menu autorizado e bloqueio de rota direta", async ({ page }) => {
  await sessionMocks(page,{...viewer,perfil:"agendador",permissoes:["recebimento.ver","recebimento.editar","agendas.ver","agendas.historico","importacao.ver","relatorios.ver"]});
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("link",{name:"Agendas",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"Histórico",exact:true})).toHaveCount(0);
  await expect(page.getByRole("link",{name:"Importação",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"Usuários",exact:true})).toHaveCount(0);
  await expect(page.getByRole("link",{name:"Lojas",exact:true})).toHaveCount(0);
});


test("React: administrador configura perfil, escopo e exceções no cadastro",async({page})=>{
  await sessionMocks(page,{...admin,acessoConfiguravel:true});
  await page.goto("/admin/users");
  await page.getByRole("button",{name:"Novo usuário"}).click();
  await page.getByLabel("Configurar perfil, lojas e permissões").check();
  await expect(page.getByLabel("Perfil base")).toHaveValue("agendador");
  await page.getByLabel("Recebimento — Editar",{exact:true}).selectOption("deny");
  await expect(page.getByLabel("Recebimento — Editar",{exact:true})).toHaveValue("deny");
  await page.getByRole("button",{name:"Restaurar permissões do perfil"}).click();
  await expect(page.getByLabel("Recebimento — Editar",{exact:true})).toHaveValue("inherit");
  await page.getByLabel("Escopo de lojas").selectOption("assigned");
  await expect(page.getByRole("button",{name:"Cadastrar usuário",exact:true})).toBeDisabled();
});


test("React: organiza menu por arraste e setas, persiste por usuário e restaura padrão", async ({page}) => {
  await page.setViewportSize({width:1600,height:900});
  await sessionMocks(page,admin);
  await page.goto("/admin");
  const aside=page.locator("aside");
  const nav=aside.getByRole("navigation",{name:"Navegação principal"});
  await expect(nav.getByRole("link",{name:"Agendas",exact:true})).toBeVisible();
  const order=()=>nav.getByRole("link").allTextContents();
  const original=await order();
  expect(original).toContain("Agendas");
  expect(original).not.toContain("Histórico");
  await aside.getByRole("button",{name:"Organizar menu"}).click();
  await expect(nav.getByRole("link")).toHaveCount(0);
  await nav.locator('[data-menu-item="/admin/agendas"]').dragTo(nav.locator('[data-menu-item="/admin/users"]'));
  await aside.getByRole("button",{name:"Concluir"}).click();
  expect(await order()).toEqual(["Recebimento","Relatório Gerencial","Importação","Lojas","Usuários","Agendas","Logs e Auditoria"]);
  await page.reload();
  await expect(nav.getByRole("link",{name:"Agendas",exact:true})).toBeVisible();
  expect(await order()).toEqual(["Recebimento","Relatório Gerencial","Importação","Lojas","Usuários","Agendas","Logs e Auditoria"]);
  await aside.getByRole("button",{name:"Organizar menu"}).click();
  await aside.getByRole("button",{name:"Mover Agendas para cima"}).click();
  await aside.getByRole("button",{name:"Concluir"}).click();
  const custom=await order();
  expect(custom.indexOf("Agendas")).toBeLessThan(custom.indexOf("Usuários"));
  await nav.getByRole("link",{name:"Usuários"}).click();
  await expect(page.getByRole("heading",{name:"Usuários",exact:true})).toBeVisible();
  expect(await order()).toEqual(custom);
  await sessionMocks(page,viewer);
  await page.goto("/admin");
  await expect(nav.getByRole("link",{name:"Recebimento"})).toBeVisible();
  expect(await order()).toEqual(["Recebimento","Relatório Gerencial"]);
  await sessionMocks(page,admin);
  await page.goto("/admin");
  await expect(nav.getByRole("link",{name:"Agendas",exact:true})).toBeVisible();
  expect(await order()).toEqual(custom);
  await aside.getByRole("button",{name:"Organizar menu"}).click();
  await aside.getByRole("button",{name:"Restaurar ordem padrão"}).click();
  await aside.getByRole("button",{name:"Concluir"}).click();
  expect(await order()).toEqual(original);
});

test("React: menu móvel permite reordenar por setas sem ampliar a página",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await sessionMocks(page,viewer);
  await page.goto("/admin");
  const mobile=page.getByTestId("mobile-navigation");
  await mobile.getByRole("button",{name:"Organizar menu"}).click();
  await mobile.getByRole("button",{name:"Mover Relatório Gerencial para cima"}).click();
  await mobile.getByRole("button",{name:"Concluir"}).click();
  expect(await mobile.getByRole("link").allTextContents()).toEqual(["Relatório Gerencial","Recebimento"]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(2);
});

test("React: preferência antiga não exibe itens não autorizados nem histórico",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("agenda-prado-menu-order-v1:view",JSON.stringify(["/admin/history","/admin/users","/admin/reports","/admin/reports","/admin","/desconhecido"])));
  await sessionMocks(page,viewer);
  await page.setViewportSize({width:1600,height:900});
  await page.goto("/admin");
  const nav=page.locator("aside").getByRole("navigation");
  await expect(nav.getByRole("link",{name:"Recebimento"})).toBeVisible();
  expect(await nav.getByRole("link").allTextContents()).toEqual(["Relatório Gerencial","Recebimento"]);
});
