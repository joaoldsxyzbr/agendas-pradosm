import { ACCESS_PROFILES, PERMISSIONS, type Permission } from "../../../../../shared/permissions.ts";
import { z } from "zod";
import { apiFetch, ApiError } from "@/lib/api";

export const roleSchema = z.enum(["admin", "visualizador", "conferente"]);
export const userSchema = z.object({
  id: z.string(),
  nome: z.string(),
  // O Worker atual não retorna login em /me nem no POST /login.
  login: z.string().optional(),
  papel: roleSchema,
  lojaId: z.string().nullable().optional(),
  lojaNome: z.string().nullable().optional(),
  lojaCodigo: z.string().nullable().optional(),
  acessoConfiguravel:z.boolean().optional(),
  perfil:z.enum(ACCESS_PROFILES).optional(),
  permissoes:z.array(z.enum(PERMISSIONS)).optional(),
  escopo:z.discriminatedUnion("mode",[z.object({mode:z.literal("all")}),z.object({mode:z.literal("assigned"),storeIds:z.array(z.string())})]).optional(),
  lojasDisponiveis:z.array(z.object({id:z.string(),codigo:z.string(),nome:z.string()})).optional(),
});
export type SessionUser = z.infer<typeof userSchema>;
export type Role = z.infer<typeof roleSchema>;

export function homeForRole(role: Role): string {
  return role === "conferente" ? "/app" : "/admin";
}

export const ACCESS_PAGES = [
  ["/admin","recebimento.ver"],["/admin/reports","relatorios.ver"],["/admin/agendas","agendas.ver"],
  ["/admin/import","importacao.ver"],["/admin/history","agendas.historico"],["/admin/stores","lojas.ver"],
  ["/admin/users","usuarios.ver"],["/admin/diagnostics","diagnosticos.ver"],["/app","conferencia.ver"],
] as const;
export function canUse(user:SessionUser|null|undefined,permission:Permission,legacy:boolean):boolean{
  return !!user&&(user.permissoes?user.permissoes.includes(permission):legacy);
}
export function homeForUser(user:SessionUser):string{
  if(!user.permissoes)return homeForRole(user.papel);
  return ACCESS_PAGES.find(([,p])=>user.permissoes?.includes(p))?.[0]??"/sem-acesso";
}
export async function loadSession(): Promise<SessionUser | null> {
  try {
    const raw = await apiFetch<unknown>("/api/auth/me");
    const user=userSchema.parse(raw);
    if(user.perfil){const selected=sessionStorage.getItem("agenda-store");if(selected&&!user.lojasDisponiveis?.some(s=>s.id===selected))sessionStorage.removeItem("agenda-store");}
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
export async function login(login: string, senha: string): Promise<SessionUser> {
  sessionStorage.removeItem("agenda-store");
  const raw = await apiFetch<unknown>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, senha }),
  });
  return userSchema.parse(raw);
}
export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
  sessionStorage.removeItem("agenda-store");
}

const quickAccountsSchema = z.object({
  accounts: z.array(z.object({ login: z.string(), label: z.string() })),
});
export function isLocalMockOrigin(): boolean {
  return window.location.origin === "http://127.0.0.1:8787";
}
export async function loadQuickAccounts() {
  if (!isLocalMockOrigin()) return [];
  try {
    const raw = await apiFetch<unknown>("/api/local-mock/accounts");
    return quickAccountsSchema.parse(raw).accounts;
  } catch {
    // Wrangler local e servidor publicado não oferecem esse endpoint.
    return [];
  }
}
export async function quickLogin(login: string): Promise<SessionUser> {
  sessionStorage.removeItem("agenda-store");
  if (!isLocalMockOrigin()) throw new Error("Acesso rápido indisponível.");
  const raw = await apiFetch<unknown>("/api/local-mock/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login }),
  });
  return userSchema.parse(raw);
}
