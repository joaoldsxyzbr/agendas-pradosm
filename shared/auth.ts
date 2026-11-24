import type { AccessProfile, Permission, StoreScope } from "./permissions.ts";
// Contratos de autenticacao compartilhados entre Worker e UI.
export type UserRole = "admin" | "conferente" | "visualizador";
export interface AuthUser {
  id: string;
  nome: string;
  papel: UserRole;
  lojaId: string | null;
  lojaCodigo: string | null;
  lojaNome: string | null;
  acessoConfiguravel?: boolean;
  perfil?: AccessProfile;
  permissoes?: Permission[];
  escopo?: StoreScope;
  lojasDisponiveis?: {id:string;codigo:string;nome:string}[];
}
export interface SessionPayload {
  userId: string;
  sessionVersion: number;
  exp: number;
}
