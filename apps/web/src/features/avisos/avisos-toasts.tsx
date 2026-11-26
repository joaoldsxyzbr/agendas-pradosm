import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Megaphone, MessageSquare, X } from "lucide-react";
import { getAvisos } from "./api";
import type { Aviso } from "./model";

type Toast = { id: string; titulo: string; mensagem: string; urgente: boolean; tipo: "aviso" | "chat" };

// O storage guarda somente IDs recentes, não o conteúdo. Uma aba em foco
// assume a notificação; o histórico inicial nunca vira toast.
function claim(userId: string, id: string) {
  try {
    const key = "agenda-prado-toasts-" + userId;
    const ids: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (ids.includes(id)) return false;
    localStorage.setItem(key, JSON.stringify([...ids.slice(-99), id]));
  } catch { /* modo privado: o controle em memória ainda evita repetição local */ }
  return true;
}

function visibleInChannel(id: string) {
  const root = document.querySelector('[data-testid="avisos-mensagens"]');
  if (!root) return false;
  const bounds = root.getBoundingClientRect();
  for (const item of root.querySelectorAll<HTMLElement>("[data-aviso-id]")) {
    if (item.dataset.avisoId !== id) continue;
    const rect = item.getBoundingClientRect();
    return Math.min(rect.bottom, bounds.bottom) > Math.max(rect.top, bounds.top);
  }
  return false;
}

function ToastCard({ toast, dismiss, open }: { toast: Toast; dismiss: (id: string) => void; open: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), toast.urgente ? 10_000 : 6_000);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.urgente, dismiss]);
  const Icon = toast.tipo === "chat" ? MessageSquare : Megaphone;
  return <div data-testid="aviso-toast" role="status" className={`pointer-events-auto flex items-start gap-2 rounded-lg border p-3 shadow-xl ${toast.urgente ? "border-rose-500/80 bg-[#36232f]" : "border-sky-700 bg-[#1c2f47]"}`}>
    <Icon size={20} className={toast.urgente ? "mt-1 shrink-0 text-rose-300" : "mt-1 shrink-0 text-sky-300"} aria-hidden="true" />
    <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-sky-400" onClick={open}>
      <span className={`block text-xs font-medium ${toast.urgente ? "text-rose-300" : "text-sky-300"}`}>{toast.urgente ? "Novo aviso urgente" : toast.tipo === "chat" ? "Nova mensagem" : "Novo aviso"}</span>
      <strong className="block break-words text-sm text-slate-100">{toast.titulo}</strong>
      <span className="line-clamp-2 break-words text-xs text-slate-300">{toast.mensagem}</span>
      <span className="mt-1 block text-xs text-sky-300">Abrir canal</span>
    </button>
    <button type="button" aria-label="Fechar notificação" className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white" onClick={() => dismiss(toast.id)}><X size={16} /></button>
  </div>;
}

export function AvisosToasts({ userId, canalPath }: { userId: string; canalPath: string }) {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["avisos"], queryFn: () => getAvisos(), refetchInterval: 60_000, refetchOnWindowFocus: true });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const baseline = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!query.data) return;
    const items = query.data.avisos.filter(a => a.tipo !== "evento");
    const newest = items.reduce((date, a) => a.criadoEm > date ? a.criadoEm : date, "");
    if (baseline.current === null) {
      baseline.current = newest;
      items.forEach(a => seen.current.add(a.id));
      return;
    }
    const fresh = items.filter(a => !seen.current.has(a.id) && a.criadoEm >= baseline.current!);
    const frame = requestAnimationFrame(() => {
      // Um refetch que cancela o frame não deve descartar publicações ainda não processadas.
      items.forEach(a => seen.current.add(a.id));
      if (baseline.current !== null && newest > baseline.current) baseline.current = newest;
      if (seen.current.size > 500) seen.current = new Set(items.map(a => a.id));
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      const incoming = fresh.filter(a => !a.proprio && !a.lido && !visibleInChannel(a.id) && claim(userId, a.id));
      if (!incoming.length) return;
      const cards = incoming.slice(0, 3).map((a: Aviso): Toast => ({
        id: a.id, titulo: a.titulo ?? a.autor, mensagem: a.mensagem,
        urgente: a.urgente, tipo: a.tipo === "aviso" ? "aviso" : "chat",
      }));
      if (incoming.length > 3) cards[2] = { ...cards[2]!, titulo: `${incoming.length - 2} novas publicações`, mensagem: "Abra o canal para consultar." };
      setToasts(current => [...cards, ...current].slice(0, 3));
    });
    return () => cancelAnimationFrame(frame);
  }, [query.data, userId]);
  // Callback estável para que a duração de cada card não reinicie em outra atualização.
  const dismiss = useRef((id: string) => setToasts(current => current.filter(t => t.id !== id))).current;
  return <div className="pointer-events-none fixed right-3 top-16 z-40 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2" aria-label="Notificações do canal">
    {toasts.map(toast => <ToastCard key={toast.id} toast={toast} dismiss={dismiss} open={() => { dismiss(toast.id); navigate(canalPath); }} />)}
  </div>;
}
