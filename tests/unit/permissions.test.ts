import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCESS_PROFILES, PERMISSIONS, resolvePermissions, hasPermission, canAccessStore } from "../../shared/permissions.ts";

test("catálogo único, quatro perfis e administrador completo", () => {
  assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
  assert.equal(ACCESS_PROFILES.length, 4);
  assert.deepEqual([...resolvePermissions("admin")], [...PERMISSIONS]);
});

test("visualizador não grava negócios; marcar próprios avisos continua permitido", () => {
  const access = resolvePermissions("visualizador");
  assert.equal(hasPermission(access, "recebimento.ver"), true);
  assert.equal(hasPermission(access, "relatorios.ver"), true);
  assert.equal(hasPermission(access, "avisos.marcar_lido"), true);
  for (const p of ["recebimento.editar", "agendas.editar", "conferencia.editar", "importacao.executar", "avisos.publicar"]) {
    assert.equal(hasPermission(access, p), false, p);
  }
});

test("conferente conserva operações da conferência e não ganha painel global", () => {
  const access = resolvePermissions("conferente");
  for (const p of ["conferencia.ver", "conferencia.editar", "conferencia.manual.excluir", "conferencia.concluir", "conferencia.historico"]) {
    assert.equal(hasPermission(access, p), true, p);
  }
  assert.equal(hasPermission(access, "recebimento.ver"), false);
  assert.equal(hasPermission(access, "relatorios.ver"), false);
});

test("exceções são individuais, reversíveis e negação retira a ação padrão", () => {
  const access = resolvePermissions("digitador", [
    { permission: "recebimento.editar", effect: "deny" },
    { permission: "recebimento.manual.excluir", effect: "deny" },
  ]);
  assert.equal(hasPermission(access, "recebimento.editar"), false);
  assert.equal(hasPermission(access, "recebimento.manual.excluir"), false);
  assert.equal(hasPermission(resolvePermissions("digitador"), "recebimento.editar"), true);
  assert.equal(hasPermission(resolvePermissions("digitador"), "recebimento.manual.excluir"), true);
});

test("sem visualização não há ações dependentes", () => {
  const access = resolvePermissions("digitador", [{ permission: "recebimento.ver", effect: "deny" }]);
  assert.equal(hasPermission(access, "recebimento.editar"), false);
  assert.equal(hasPermission(access, "recebimento.manual.criar"), false);
  assert.equal(hasPermission(access, "agendas.editar"), true);
  assert.equal(resolvePermissions("visualizador", [{ permission: "usuarios.editar", effect: "allow" }]), null);
  assert.equal(hasPermission(resolvePermissions("visualizador", [
    { permission: "usuarios.ver", effect: "allow" }, { permission: "usuarios.editar", effect: "allow" },
  ]), "usuarios.editar"), true);
});

test("perfil, permissões ou overrides inválidos falham fechados", () => {
  assert.equal(resolvePermissions("constructor"), null);
  assert.equal(resolvePermissions("agendador"), null);
  assert.equal(resolvePermissions("admin", null), null);
  assert.equal(resolvePermissions("admin", [{ permission: "inexistente", effect: "allow" }]), null);
  assert.equal(resolvePermissions("admin", [{ permission: "lojas.ver", effect: true }]), null);
  assert.equal(resolvePermissions("admin", [
    { permission: "lojas.ver", effect: "deny" }, { permission: "lojas.ver", effect: "allow" },
  ]), null);
  assert.equal(hasPermission(null, "lojas.ver"), false);
  assert.equal(hasPermission(resolvePermissions("admin"), "inexistente"), false);
});

test("escopo por loja é explícito e separado da permissão", () => {
  const assigned = { mode: "assigned", storeIds: ["s1", "s2"] };
  assert.equal(canAccessStore(assigned, "s1"), true);
  assert.equal(canAccessStore(assigned, "s2"), true);
  assert.equal(canAccessStore(assigned, "s3"), false);
  assert.equal(canAccessStore({ mode: "assigned", storeIds: [] }, "s1"), false);
  assert.equal(canAccessStore({ mode: "all" }, "s3"), true);
  for (const scope of [null, {}, { mode: "other" }, { mode: "assigned" }, { mode: "assigned", storeIds: ["s1", null] }, { mode: "all", storeIds: [] }]) {
    assert.equal(canAccessStore(scope, "s1"), false);
  }
  assert.equal(canAccessStore({ mode: "all" }, ""), false);
});

test("Digitador tem todas as permissões operacionais e nenhuma administrativa restrita", () => {
  const expected = PERMISSIONS.filter(p => !/^(lojas|usuarios|auditoria|diagnosticos|retencao)\./.test(p));
  assert.deepEqual([...resolvePermissions("digitador")!], expected);
  for (const p of PERMISSIONS.filter(p => !expected.includes(p))) {
    assert.equal(hasPermission(resolvePermissions("digitador"),p),false,p);
    assert.equal(resolvePermissions("digitador",[{permission:p,effect:"allow"}]),null,p);
  }
  assert.equal(hasPermission(resolvePermissions("digitador",[{permission:"importacao.substituir",effect:"deny"}]),"importacao.substituir"),false);
});
