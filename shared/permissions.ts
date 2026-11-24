// Catálogo puro de autorização (etapa preparatória da issue #248).
// Ainda não substitui a autorização vigente; não importar em rotas antes de
// integrar persistência, escopo por loja e revogação de sessões.
export const ACCESS_PROFILES = ["admin", "agendador", "visualizador", "conferente"] as const;
export type AccessProfile = typeof ACCESS_PROFILES[number];

export const PERMISSIONS = [
  "recebimento.ver", "recebimento.editar", "recebimento.manual.criar",
  "recebimento.manual.editar", "recebimento.manual.excluir",
  "recebimento.concluir", "recebimento.reabrir", "recebimento.exportar",
  "conferencia.ver", "conferencia.editar", "conferencia.manual.criar",
  "conferencia.manual.editar", "conferencia.manual.excluir",
  "conferencia.concluir", "conferencia.historico", "conferencia.exportar",
  "agendas.ver", "agendas.editar", "agendas.historico",
  "importacao.ver", "importacao.executar", "importacao.substituir",
  "relatorios.ver", "lojas.ver", "lojas.criar", "lojas.editar", "lojas.excluir",
  "usuarios.ver", "usuarios.criar", "usuarios.editar", "usuarios.excluir",
  "usuarios.permissoes", "auditoria.ver", "diagnosticos.ver",
  "retencao.ver", "retencao.executar", "avisos.ver", "avisos.marcar_lido",
  "avisos.publicar",
] as const;
export type Permission = typeof PERMISSIONS[number];
export type PermissionOverride = { permission: Permission; effect: "allow" | "deny" };

const profiles = new Set<string>(ACCESS_PROFILES);
const permissions = new Set<string>(PERMISSIONS);
export function isAccessProfile(value: unknown): value is AccessProfile {
  return typeof value === "string" && profiles.has(value);
}
export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && permissions.has(value);
}

const defaults: Record<AccessProfile, readonly Permission[]> = {
  admin: PERMISSIONS,
  agendador: [
    "recebimento.ver", "recebimento.editar", "recebimento.manual.criar",
    "recebimento.manual.editar", "agendas.ver", "agendas.editar",
    "agendas.historico", "importacao.ver", "importacao.executar",
    "relatorios.ver", "avisos.ver", "avisos.marcar_lido",
  ],
  visualizador: ["recebimento.ver", "relatorios.ver", "avisos.ver", "avisos.marcar_lido"],
  conferente: [
    "conferencia.ver", "conferencia.editar", "conferencia.manual.criar",
    "conferencia.manual.editar", "conferencia.manual.excluir",
    "conferencia.concluir", "conferencia.historico", "conferencia.exportar",
    "avisos.ver", "avisos.marcar_lido",
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function prerequisite(permission: Permission): Permission | null {
  const view = permission.split(".")[0] + ".ver";
  return permission !== view && isPermission(view) ? view : null;
}

// Ausência de override significa herança; negação explícita vence o padrão.
// Retirar a visualização retira também as ações dependentes herdadas.
// Configurações malformadas ou concessões explícitas incoerentes falham fechadas.
export function resolvePermissions(profile: unknown, overrides: unknown = []): ReadonlySet<Permission> | null {
  if (!isAccessProfile(profile) || !Array.isArray(overrides)) return null;
  const effective = new Set<Permission>(defaults[profile]);
  const seen = new Set<Permission>();
  const granted = new Set<Permission>();
  for (const item of overrides) {
    if (!isRecord(item) || !isPermission(item.permission) ||
        (item.effect !== "allow" && item.effect !== "deny") ||
        seen.has(item.permission)) return null;
    seen.add(item.permission);
    if (item.effect === "deny") effective.delete(item.permission);
    else {
      granted.add(item.permission);
      effective.add(item.permission);
    }
  }
  for (const permission of effective) {
    const required = prerequisite(permission);
    if (required && !effective.has(required)) {
      if (granted.has(permission)) return null;
      effective.delete(permission);
    }
  }
  return new Set(PERMISSIONS.filter(permission => effective.has(permission)));
}

export function hasPermission(effective: ReadonlySet<Permission> | null, permission: unknown): boolean {
  return isPermission(permission) && effective?.has(permission) === true;
}

// O escopo é independente do perfil e das permissões de ação. IDs devem vir
// de lojas validadas pelo servidor; não aceitar valores enviados pelo cliente.
export type StoreScope = { mode: "all" } | { mode: "assigned"; storeIds: readonly string[] };
export function canAccessStore(scope: unknown, storeId: unknown): boolean {
  if (!isRecord(scope) || typeof storeId !== "string" || !storeId.trim() || storeId !== storeId.trim()) return false;
  if (scope.mode === "all") return scope.storeIds === undefined;
  if (scope.mode !== "assigned" || !Array.isArray(scope.storeIds)) return false;
  if (scope.storeIds.some(id => typeof id !== "string" || !id.trim() || id !== id.trim())) return false;
  return scope.storeIds.includes(storeId);
}
