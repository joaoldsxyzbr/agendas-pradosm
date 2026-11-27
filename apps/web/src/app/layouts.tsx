import { useState } from "react";
import { moveVisibleMenuItem, readMenuOrder, writeMenuOrder } from "./menu-order";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router";
import { ClipboardCheck, ClipboardList, FileBarChart, FileUp, LogOut, Megaphone, PanelLeft, Settings2, Store, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logout, ACCESS_PAGES, canUse, canUseNotice, noticePath, type SessionUser, type Role } from "@/features/auth/session";
import { AvisosMenuBadge } from "@/features/avisos/avisos-menu-badge";
import { AvisosToasts } from "@/features/avisos/avisos-toasts";
import { useReceivingRealtime } from "@/features/receiving/use-realtime";
import { PradoMark } from "@/components/operations/prado-mark";

const menu = [
  { path: "/admin", label: "Recebimento", icon: ClipboardCheck, roles: ["admin", "visualizador"] },
  { path: "/admin/reports", label: "Relatório Gerencial", icon: FileBarChart, roles: ["admin", "visualizador"] },
  { path: "/admin/agendas", label: "Agendas", icon: ClipboardList, roles: ["admin"] },
  { path: "/admin/import", label: "Importação", icon: FileUp, roles: ["admin"] },
  { path: "/admin/stores", label: "Lojas", icon: Store, roles: ["admin"] },
  { path: "/admin/users", label: "Usuários", icon: Users, roles: ["admin"] },
  { path: "/admin/diagnostics", label: "Logs e Auditoria", icon: Settings2, roles: ["admin"] },
  { path: "/app", label: "Conferência", icon: ClipboardCheck, roles: ["conferente"] },
  { path: "/admin/avisos", label: "Avisos", icon: Megaphone, roles: ["admin"] },
  { path: "/app/avisos", label: "Avisos", icon: Megaphone, roles: ["conferente"] },
] as const;
const defaultMenuOrder = menu.map(item => item.path);

const labels: Record<Role | "digitador", string> = {
  admin: "Administrador",
  digitador: "Digitador",
  visualizador: "Visualizador",
  conferente: "Conferente",
};

const SIDEBAR_STORAGE_PREFIX = "agenda-prado-sidebar-";
const AUTO_COLLAPSE_QUERY = "(max-width: 1440px)";

function sidebarKey(role: Role) {
  return SIDEBAR_STORAGE_PREFIX + (role === "conferente" ? "store" : "admin");
}

function readSidebarCollapsed(role: Role) {
  try {
    const saved = window.localStorage.getItem(sidebarKey(role));
    if (saved === "collapsed") return true;
    if (saved === "expanded") return false;
  } catch {
    // localStorage bloqueado: segue para o critério automático
  }
  return typeof window.matchMedia === "function" && window.matchMedia(AUTO_COLLAPSE_QUERY).matches;
}

function writeSidebarCollapsed(role: Role, collapsed: boolean) {
  try {
    window.localStorage.setItem(sidebarKey(role), collapsed ? "collapsed" : "expanded");
  } catch {
    // localStorage bloqueado: mantém apenas o estado em memória
  }
}

export function AppLayout({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const {pathname}=useLocation();
  const canal=pathname.endsWith("/avisos");
  const temCanal=canUseNotice(user,"avisos.ver");
  // Recebimento e Conferência possuem sua própria conexão. Nas demais
  // telas, receber invalidações do canal apenas para contas legadas.
  useReceivingRealtime(temCanal&&!user.perfil&&pathname!=="/admin"&&pathname!=="/app"?user.id:undefined,"");
  const client = useQueryClient();
  const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed(user.papel));
  const [order, setOrder] = useState(() => readMenuOrder(user.id, defaultMenuOrder));
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const signout = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // O próximo login (pode ser outra pessoa no mesmo navegador) começa
      // sem nenhum dado em cache do usuário que saiu.
      client.clear();
      client.setQueryData(["session"], null);
      navigate("/login", { replace: true });
    },
  });
  const authorized = menu.filter(item => item.path.endsWith("/avisos")?temCanal&&item.path===noticePath(user):user.permissoes ? (user.permissoes.some(p=>ACCESS_PAGES.some(([path,permission])=>path===item.path&&permission===p))||(item.path==="/admin/diagnostics"&&user.permissoes.includes("auditoria.ver"))) : (item.roles as readonly Role[]).includes(user.papel));
  const items = [...authorized].sort((a,b) => order.indexOf(a.path) - order.indexOf(b.path));
  const visible: string[] = items.map(item => item.path);
  const saveOrder = (next: string[]) => {
    setOrder(next);
    setStorageFailed(!writeMenuOrder(user.id, next));
  };
  const move = (from: string, to: string) => {
    if (from === to || !visible.includes(from) || !visible.includes(to)) return;
    saveOrder(moveVisibleMenuItem(order, visible, from, to));
    const label = items.find(item => item.path === from)?.label;
    setAnnouncement(label + " movido para a posição " + (visible.indexOf(to) + 1) + ".");
  };
  const clearDrag = () => {
    setDragging(null);
    setDropTarget(null);
  };
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeSidebarCollapsed(user.papel, next);
  };
  const renderNav = (compact: boolean) => <nav aria-label="Navegação principal" className={cn("flex min-w-0 gap-1 md:flex-col", compact && "md:items-center")}>
    {items.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} end
      data-menu-item={path}
      draggable={items.length > 1}
      onDragStart={event => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", path);
        setDragging(path);
      }}
      onDragOver={event => {
        if (!dragging || dragging === path) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(path);
      }}
      onDragLeave={event => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setDropTarget(current => current === path ? null : current);
      }}
      onDrop={event => {
        if (!dragging) return;
        event.preventDefault();
        move(dragging, path);
        clearDrag();
      }}
      onDragEnd={clearDrag}
      onClick={event => { if (dragging) event.preventDefault(); }}
      className={({ isActive }) => cn("flex shrink-0 select-none items-center gap-2.5 prado-nav-link rounded px-3 py-2.5 text-sm font-medium outline-offset-2 focus-visible:outline-2 focus-visible:outline-sky-400",
        compact && "md:justify-center md:px-2",
        isActive ? "text-slate-100" : "text-slate-300 hover:bg-slate-800 hover:text-slate-100",
        dragging === path && "opacity-50",
        dropTarget === path && "ring-1 ring-inset ring-sky-400 bg-sky-500/15")}>
      <Icon size={16} aria-hidden="true" />
      <span className={compact ? "sr-only" : undefined}>{label}</span>
      {path.endsWith("/avisos")&&<AvisosMenuBadge />}
    </NavLink>)}
  </nav>;
  return <div className={cn("flex min-h-svh w-screen min-w-0 max-w-[100vw] flex-col overflow-x-clip md:w-full md:max-w-full md:flex-row",canal&&"h-svh overflow-hidden")}>
    <aside className={cn("hidden shrink-0 flex-col prado-sidebar border-r p-3 md:sticky md:top-0 md:flex md:h-svh md:max-h-svh md:overflow-y-auto", collapsed ? "w-[76px]" : "w-60")}>
      <div className={cn("mb-7 border-b border-slate-700/70 p-3", collapsed && "flex flex-col items-center gap-2")}>
        {collapsed ? <>
          <PradoMark />
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Expandir navegação" aria-expanded={false} onClick={toggleCollapsed}>
            <PanelLeft size={16} aria-hidden="true" />
          </Button>
        </> : <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5"><PradoMark /><strong className="text-sm font-semibold tracking-tight text-white">Agenda Prado</strong></div>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Recolher navegação" aria-expanded onClick={toggleCollapsed}>
              <PanelLeft size={16} aria-hidden="true" />
            </Button>
          </div>
          <p className="mt-3 text-xs text-slate-400">Gestão de recebimentos</p>
        </>}
      </div>
      <div className="flex-1">{renderNav(collapsed)}</div>
      <div className={cn("border-t border-slate-700/70 px-2 pt-3 text-xs text-slate-400", collapsed && "truncate text-center")}>{labels[user.perfil??user.papel]}</div>
    </aside>
    <div className="flex w-screen min-h-0 min-w-0 max-w-[100vw] flex-1 flex-col md:w-full md:max-w-full">
      <header className="prado-topbar flex min-h-16 flex-wrap items-center justify-between gap-3 border-b px-4 py-2 md:px-6">
        <span className="text-sm font-semibold text-slate-200">Painel operacional</span>
        <div className="flex items-center gap-3">
          {user.lojasDisponiveis && user.lojasDisponiveis.length>1 && canUse(user,"conferencia.ver",false) && <select aria-label="Loja de conferência" className="max-w-40 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white" value={user.lojaId??""}
            onChange={event=>{sessionStorage.setItem("agenda-store",event.target.value);window.location.reload();}}>
            {user.lojasDisponiveis.map(store=><option key={store.id} value={store.id}>{store.codigo} — {store.nome}</option>)}
          </select>}
          <span className="max-w-40 truncate text-xs text-slate-400">{user.nome}</span>
          <Button variant="ghost" size="sm" disabled={signout.isPending} onClick={() => signout.mutate()}>
            <LogOut size={14} aria-hidden="true" /> Sair
          </Button>
        </div>
      </header>
      <div data-testid="mobile-navigation" className="w-screen min-w-0 max-w-[100vw] overflow-x-auto overscroll-x-contain prado-sidebar border-b p-2 md:hidden">{renderNav(false)}</div>
      <span className="sr-only" aria-live="polite">{announcement}</span>
      {storageFailed && <p className="px-5 pt-2 text-xs text-amber-300" role="status">Não foi possível salvar a ordem neste navegador.</p>}
      {signout.isError && <p role="alert" className="px-5 pt-2 text-xs text-rose-300">Não foi possível encerrar a sessão.</p>}
      <main className={cn("w-full min-w-0 max-w-full flex-1",canal?"flex min-h-0 flex-col overflow-hidden":"overflow-x-clip p-4 md:p-7")}><Outlet /></main>
      {temCanal&&<AvisosToasts key={user.id} userId={user.id} canalPath={noticePath(user)} />}
    </div>
  </div>;
}
