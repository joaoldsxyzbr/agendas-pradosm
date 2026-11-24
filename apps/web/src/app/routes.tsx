import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router";
import { AppLayout } from "./layouts";
import { useSession } from "./session-query";
// Cada área é carregada quando a rota é visitada. Evita transferir relatórios,
// exportação e conferência para quem utiliza somente outra área do sistema.
const LoginPage = lazy(() => import("@/features/auth/login-page").then(m => ({ default: m.LoginPage })));
const AgendasPage = lazy(() => import("@/features/agendas/agendas-page").then(m => ({ default: m.AgendasPage })));
const ImportPage = lazy(() => import("@/features/import/import-page").then(m => ({ default: m.ImportPage })));
const ReceivingPage = lazy(() => import("@/features/receiving/receiving-page").then(m => ({ default: m.ReceivingPage })));
const ConferencePage = lazy(() => import("@/features/conference/conference-page").then(m => ({ default: m.ConferencePage })));
const ReportsPage = lazy(() => import("@/features/reports/reports-page").then(m => ({ default: m.ReportsPage })));
const StoresPage = lazy(() => import("@/features/stores/stores-page").then(m => ({ default: m.StoresPage })));
const HistoryPage = lazy(() => import("@/features/history/history-page").then(m => ({ default: m.HistoryPage })));
const UsersPage = lazy(() => import("@/features/users/users-page").then(m => ({ default: m.UsersPage })));
const DiagnosticsPage = lazy(() => import("@/features/diagnostics/diagnostics-page").then(m => ({ default: m.DiagnosticsPage })));
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { homeForUser, ACCESS_PAGES, type Role, type SessionUser } from "@/features/auth/session";

// O Suspense fica dentro do Outlet: o menu permanece visível enquanto a tela carrega.
function DeferredPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="p-5"><Loading label="Carregando tela…" className="text-sm" /></main>}>{children}</Suspense>;
}

function Guard({ roles, path }: { roles: Role[]; path?:string }) {
  const session = useSession();
  if (session.isPending) return <main className="grid min-h-svh place-items-center"><Loading label="Verificando sessão…" className="text-sm" /></main>;
  if (session.isError) return <main className="grid min-h-svh place-items-center gap-3 p-5">
    <p role="alert">Não foi possível verificar sua sessão.</p>
    <Button onClick={() => void session.refetch()}>Tentar novamente</Button>
  </main>;
  if (!session.data) return <Navigate to="/login" replace />;
  const permission=ACCESS_PAGES.find(([p])=>p===path)?.[1];
  if(path!=="/sem-acesso" && (session.data.permissoes ? !permission||(!session.data.permissoes.includes(permission)&&!(path==="/admin/diagnostics"&&session.data.permissoes.includes("auditoria.ver"))) : !roles.includes(session.data.papel))) return <Navigate to={homeForUser(session.data)} replace />;
  return <Outlet context={session.data} />;
}

function LayoutRoute() {
  const session = useSession();
  // O Guard garante que o papel foi validado antes de renderizar a estrutura.
  return session.data ? <AppLayout user={session.data} /> : null;
}

function UnknownRoute() {
  const session = useSession();
  if (session.isPending) return <main className="grid min-h-svh place-items-center"><Loading label="Verificando sessão…" /></main>;
  return <Navigate to={session.data ? homeForUser(session.data) : "/login"} replace />;
}

export function AppRoutes() {
  return <Routes>
    <Route path="/login" element={<DeferredPage><LoginPage /></DeferredPage>} />
    <Route element={<Guard roles={["admin","visualizador"]} path="/admin" />}>
      <Route element={<LayoutRoute />}><Route path="/admin" element={<DeferredPage><ReceivingPage /></DeferredPage>} /></Route>
    </Route>
    <Route element={<Guard roles={["admin","visualizador"]} path="/admin/reports" />}>
      <Route element={<LayoutRoute />}><Route path="/admin/reports" element={<DeferredPage><ReportsPage /></DeferredPage>} /></Route>
    </Route>
    <Route element={<Guard roles={["admin"]} path="/admin/agendas" />}>
      <Route element={<LayoutRoute />}><Route path="/admin/agendas" element={<DeferredPage><AgendasPage /></DeferredPage>} /></Route>
    </Route>
    <Route element={<Guard roles={["admin"]} path="/admin/import" />}>
      <Route element={<LayoutRoute />}><Route path="/admin/import" element={<DeferredPage><ImportPage /></DeferredPage>} /></Route>
    </Route>
    <Route element={<Guard roles={["admin"]} path="/admin/history" />}>
      <Route element={<LayoutRoute />}><Route path="/admin/history" element={<DeferredPage><HistoryPage /></DeferredPage>} /></Route>
    </Route>
    <Route element={<Guard roles={["admin"]} path="/admin/stores" />}>
      <Route element={<LayoutRoute />}><Route path="/admin/stores" element={<DeferredPage><StoresPage /></DeferredPage>} /></Route>
    </Route>
    <Route element={<Guard roles={["admin"]} path="/admin/users" />}>
      <Route element={<LayoutRoute />}><Route path="/admin/users" element={<DeferredPage><UsersPage /></DeferredPage>} /></Route>
    </Route>
    <Route element={<Guard roles={["admin"]} path="/admin/diagnostics" />}>
      <Route element={<LayoutRoute />}><Route path="/admin/diagnostics" element={<DeferredPage><DiagnosticsPage /></DeferredPage>} /></Route>
    </Route>
    <Route element={<Guard roles={["conferente"]} path="/app" />}>
      <Route element={<LayoutRoute />}><Route path="/app" element={<DeferredPage><ConferencePage /></DeferredPage>} /></Route>
    </Route>
    <Route element={<Guard roles={[]} path="/sem-acesso" />}><Route element={<LayoutRoute />}><Route path="/sem-acesso" element={<p>Nenhuma área foi liberada para este usuário. Solicite acesso ao administrador.</p>} /></Route></Route>
    <Route path="*" element={<UnknownRoute />} />
  </Routes>;
}

// Mantém o contrato explícito dos três papéis durante a substituição do runtime.
export type AuthenticatedUser = SessionUser;
