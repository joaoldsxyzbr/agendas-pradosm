import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, CheckCheck, Megaphone, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { useSession } from "@/app/session-query";
import { enviarMensagem, getAvisos, getLeitores, markAvisoLido } from "./api";
import {
  formatAvisoDia,
  formatAvisoHora,
  rotuloLojasAviso,
  type Aviso,
  type AvisosResponse,
  type LeitoresAviso,
} from "./model";
import { Reacoes } from "./reacoes";
import type { Reacao, AvisoCursor } from "./model";
import { PublishAvisoDialog } from "./publish-aviso-dialog";

// Canal de comunicação: mensagens comuns e avisos oficiais. Eventos operacionais ficam na auditoria.
function DiaSeparador({ dia }: { dia: string }) {
  return <div role="separator" aria-label={dia}
    className="my-2 flex items-center gap-3 text-center text-xs font-medium text-slate-400 before:h-px before:flex-1 before:bg-slate-700/60 after:h-px after:flex-1 after:bg-slate-700/60">
    {dia}
  </div>;
}

function BolhaChat({ aviso }: { aviso: Aviso }) {
  const propria = aviso.proprio === true;
  return <div className={`flex w-full flex-col ${propria ? "items-end" : "items-start"}`}>
    {!propria && <span className="mb-0.5 px-1 text-[11px] font-semibold text-slate-400">{aviso.autor}</span>}
    <div data-testid={propria ? "chat-proprio" : "chat-outro"}
      className={`max-w-[85%] md:max-w-[72%] whitespace-pre-wrap break-words px-3.5 py-2 text-sm ${
        propria
          ? "rounded-2xl rounded-br-sm bg-sky-600/80 text-white"
          : "rounded-2xl rounded-bl-sm bg-[#1c2f47] text-slate-100"}`}
      aria-label={`${propria ? "Sua mensagem" : "Mensagem de " + aviso.autor}`}>
      {aviso.mensagem}
      <span className="ml-2 align-bottom text-[11px] text-slate-300">{formatAvisoHora(aviso.criadoEm)}</span>
    </div>
  </div>;
}

// Régua do admin: só o aviso oficial tem acompanhamento de leitura
// (GET /api/admin/avisos/:id/leitores). Consulta preguiçosa: dispara quando
// o <details> é aberto pela primeira vez e fica em cache 30s.
function LeitoresDoAviso({ avisoId }: { avisoId: string }) {
  const [aberto, setAberto] = useState(false);
  const leitores = useQuery({
    queryKey: ["avisos", "leitores", avisoId],
    queryFn: () => getLeitores(avisoId),
    enabled: aberto,
    staleTime: 30_000,
    retry: false,
  });
  const dados: LeitoresAviso | undefined = leitores.data;
  const vistos = dados?.vistos ?? [];
  const faltantes = dados?.faltantes ?? [];
  const total = vistos.length + faltantes.length;
  return <details className="text-xs" onToggle={event => setAberto((event.target as HTMLDetailsElement).open)}
    data-testid={`leitores-${avisoId}`}>
    <summary className="cursor-pointer select-none text-[11px] font-semibold text-sky-300">
      {leitores.isError ? "Consultar leitores novamente" : dados ? `Visto por ${vistos.length} de ${total}` : aberto ? "Consultando quem viu…" : "Consultar leituras"}
    </summary>
    <div className="mt-1 space-y-1 text-[11px] text-slate-300">
      {leitores.isError && <p className="text-rose-300">Não foi possível carregar a lista de leitores. <button type="button" className="underline" onClick={() => void leitores.refetch()}>Tentar novamente</button></p>}
      {vistos.length > 0 && <ul className="space-y-0.5">
        {vistos.map(pessoa => <li key={pessoa.id}>
          {pessoa.nome} ({pessoa.loja ?? "sem loja"}) — visto às {formatAvisoHora(pessoa.lidoEm ?? "")}
        </li>)}
      </ul>}
      {faltantes.length > 0 && <p className="text-slate-400">
        Aguardando: {faltantes.map(pessoa => pessoa.nome).join(", ")}
      </p>}
    </div>
  </details>;
}

function CartaoAviso({ aviso, isAdmin, onRead, reading }: { aviso: Aviso; isAdmin: boolean; onRead: () => void; reading: boolean }) {
  return <article aria-label={aviso.titulo ?? "Aviso"}
    className={`w-full min-w-0 rounded-md border-l-4 px-4 py-3 ${
      aviso.lido
        ? "border-amber-500/50 bg-amber-500/5"
        : aviso.urgente
          ? "border-rose-500 bg-rose-500/10"
          : "border-amber-500/80 bg-amber-500/10"}`}>
    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-300">Aviso</span>
      {aviso.urgente && <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-semibold text-rose-200">Urgente</span>}
      <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-slate-300">{rotuloLojasAviso(aviso.lojas)}</span>
      {formatAvisoHora(aviso.criadoEm)} · por {aviso.autor}
    </p>
    <h3 className="mt-1 text-sm font-bold text-slate-100">{aviso.titulo}</h3>
    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-200">{aviso.mensagem}</p>
    <div className="mt-2 flex flex-wrap items-start gap-3">
      {aviso.lido ? <span className="inline-flex items-center gap-1 text-xs text-slate-400"><CheckCheck size={14} /> Lido</span>
        : <Button size="sm" variant="secondary" disabled={reading} onClick={onRead}>{reading ? "Confirmando…" : "Confirmar leitura"}</Button>}
      {isAdmin && <LeitoresDoAviso avisoId={aviso.id} />}
    </div>
  </article>;
}

export function AvisosPage() {
  const user = useSession().data;
  const client = useQueryClient();
  const isAdmin = user?.papel === "admin";
  const podeEscrever = isAdmin || user?.papel === "conferente";
  const [publishing, setPublishing] = useState(false);
  const [texto, setTexto] = useState("");
  const [buscaInput, setBuscaInput] = useState("");
  const [busca, setBusca] = useState("");
  const [olderPages, setOlderPages] = useState<AvisosResponse[]>([]);
  const olderCursors = useRef<AvisoCursor[]>([]);
  const lastOlderRefresh = useRef(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [readingIds, setReadingIds] = useState<Set<string>>(new Set());
  const [readError, setReadError] = useState("");
  const [newMessages, setNewMessages] = useState(false);
  const readInFlight = useRef(new Set<string>());
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const prependHeight = useRef<number | null>(null);
  const generation = useRef(0);
  const previousLatest = useRef<string | undefined>(undefined);
  const filtros = { busca };
  const avisos = useQuery({
    queryKey: busca ? ["avisos", "filtro", busca] : ["avisos"],
    queryFn: () => getAvisos(null, filtros),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Reconciliar também as páginas antigas já abertas quando chegam alterações.
  useEffect(() => {
    if (!avisos.dataUpdatedAt || !olderCursors.current.length || Date.now() - lastOlderRefresh.current < 60_000) return;
    lastOlderRefresh.current = Date.now();
    let cancelled = false;
    const cursors = [...olderCursors.current];
    void Promise.all(cursors.map(cursor => getAvisos(cursor, { busca }))).then(pages => {
      if (cancelled) return;
      const fresh = new Map(pages.flatMap(page => page.avisos).map(aviso => [aviso.id, aviso]));
      setOlderPages(current => current.map(page => ({ ...page, avisos: page.avisos.map(aviso => {
        const next = fresh.get(aviso.id);
        return next ? { ...aviso, reacoes: next.reacoes, lido: aviso.lido || next.lido } : aviso;
      }) })));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [avisos.dataUpdatedAt, busca]);

  const updateReacoes = (id: string, reacoes: Reacao[]) => {
    const update = (page: AvisosResponse) => ({ ...page, avisos: page.avisos.map(aviso => aviso.id === id ? { ...aviso, reacoes } : aviso) });
    setOlderPages(current => current.map(update));
    client.setQueriesData<AvisosResponse>({ predicate: q => q.queryKey[0] === "avisos" && (q.queryKey.length === 1 || q.queryKey[1] === "filtro") }, current => current ? update(current) : current);
    void client.invalidateQueries({ queryKey: ["avisos"] });
  };

  const markRead = async (id: string) => {
    if (readInFlight.current.has(id)) return;
    readInFlight.current.add(id);
    setReadingIds(current => new Set(current).add(id));
    setReadError("");
    try {
      await markAvisoLido(id);
      setOlderPages(current => current.map(page => ({ ...page, avisos: page.avisos.map(a => a.id === id ? { ...a, lido: true } : a) })));
      client.setQueriesData<AvisosResponse>({ predicate: q => q.queryKey[0] === "avisos" && (q.queryKey.length === 1 || q.queryKey[1] === "filtro") }, current =>
        current ? { ...current, avisos: current.avisos.map(a => a.id === id ? { ...a, lido: true } : a) } : current);
      void client.invalidateQueries({ queryKey: ["avisos"] });
    } catch {
      setReadError("Não foi possível registrar a leitura. Tente novamente.");
    } finally {
      readInFlight.current.delete(id);
      setReadingIds(current => { const next = new Set(current); next.delete(id); return next; });
    }
  };

  const enviar = useMutation({
    mutationFn: enviarMensagem,
    onSuccess: () => {
      setTexto(""); setBuscaInput(""); trocarBusca("");
      nearBottom.current = true; setNewMessages(false);
      scrollEnd();
    },
    onSettled: () => { void client.invalidateQueries({ queryKey: ["avisos"] }); },
  });
  const enviarTexto = (mensagem: string) => {
    if (!mensagem || enviar.isPending) return;
    enviar.mutate({ mensagem });
  };

  const trocarBusca = (nextBusca: string) => {
    if (nextBusca === busca) return;
    generation.current++;
    olderCursors.current = [];
    lastOlderRefresh.current = 0;
    setBusca(nextBusca); setOlderPages([]); setLoadingMore(false); setOlderError(false);
    prependHeight.current = null; previousLatest.current = undefined; nearBottom.current = true; setNewMessages(false);
  };

  const loadMore = async () => {
    const nextCursor = (olderPages.at(-1) ?? avisos.data)?.nextCursor;
    if (!nextCursor || loadingMore) return;
    const requestGeneration = generation.current;
    setLoadingMore(true); setOlderError(false);
    try {
      const page = await getAvisos(nextCursor, filtros);
      if (generation.current !== requestGeneration) return;
      prependHeight.current = viewport.current?.scrollHeight ?? null;
      olderCursors.current.push(nextCursor);
      setOlderPages(current => [...current, page]);
    } catch {
      if (generation.current === requestGeneration) setOlderError(true);
    } finally {
      if (generation.current === requestGeneration) setLoadingMore(false);
    }
  };

  // A página mais recente vence duplicatas e preserva o estado atual de leitura.
  const listaDesc = [...olderPages.flatMap(page => page.avisos), ...(avisos.data?.avisos ?? [])];
  const lista = [...new Map(listaDesc.map(aviso => [aviso.id, aviso] as const)).values()]
    .filter(aviso => aviso.tipo !== "evento")
    .sort((a, b) => a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const lastPage = olderPages.at(-1) ?? avisos.data;
  const hasMore = Boolean(lastPage?.hasMore && lastPage?.nextCursor);
  const ultimoId = lista.at(-1)?.id;
  const scrollEnd = () => {
    const el = viewport.current;
    if (el) el.scrollTop = el.scrollHeight;
    nearBottom.current = true; setNewMessages(false);
  };
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    if (prependHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prependHeight.current;
      prependHeight.current = null;
    } else if (ultimoId !== previousLatest.current) {
      if (nearBottom.current) scrollEnd();
      else if (previousLatest.current) setNewMessages(true);
    }
    previousLatest.current = ultimoId;
  }, [ultimoId, olderPages.length]);

  // Chat: leitura individual das bolhas visíveis, somente com a página visível.
  // Avisos oficiais exigem confirmação explícita.
  useEffect(() => {
    const root = viewport.current;
    if (!root || !("IntersectionObserver" in window)) return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!active || document.visibilityState !== "visible") return;
      for (const entry of entries) if (entry.isIntersecting) {
        const id = (entry.target as HTMLElement).dataset.unreadChat;
        if (id) { observer.unobserve(entry.target); void markRead(id); }
      }
    }, { root, threshold: 0.25 });
    const observe = () => { if (document.visibilityState === "visible") root.querySelectorAll("[data-unread-chat]").forEach(el => observer.observe(el)); else observer.disconnect(); };
    observe();
    document.addEventListener("visibilitychange", observe);
    return () => { active = false; observer.disconnect(); document.removeEventListener("visibilitychange", observe); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avisos.data, olderPages, busca]);

  return <section aria-labelledby="avisos-heading" className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-[#2b415b] px-4 py-3 md:px-6">
      <div className="mr-auto flex min-w-0 items-center gap-3">
        <Megaphone size={22} className="shrink-0 text-sky-300" aria-hidden="true" />
        <div><h1 id="avisos-heading" className="text-lg font-bold text-slate-100">Avisos</h1><p className="text-xs text-slate-400">Canal de comunicação operacional</p></div>
      </div>
      {isAdmin && <Button size="sm" onClick={() => setPublishing(true)}><Megaphone size={14} aria-hidden="true" /> Novo aviso</Button>}
      <form className="order-last flex w-full min-w-0 items-center gap-1 lg:order-none lg:w-auto lg:flex-1 lg:max-w-sm" onSubmit={e => { e.preventDefault(); trocarBusca(buscaInput.trim()); }}>
        <input aria-label="Pesquisar mensagens e avisos" value={buscaInput} onChange={e => setBuscaInput(e.target.value)} maxLength={200} placeholder="Pesquisar no canal…" className="h-9 min-w-0 flex-1 rounded-md border border-[#3b5876] bg-[#17283d] px-3 text-sm text-slate-100" />
        <Button type="submit" size="icon" variant="secondary" aria-label="Pesquisar"><Search size={16} /></Button>
        {busca && <Button type="button" size="sm" variant="ghost" onClick={() => { setBuscaInput(""); trocarBusca(""); }}>Limpar</Button>}
      </form>
    </header>
    {busca && <p role="status" className="shrink-0 border-b border-[#2b415b] px-4 py-2 text-xs text-slate-400 md:px-6">Resultados para: <strong className="break-words text-slate-200">{busca}</strong></p>}
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={viewport} data-testid="avisos-mensagens" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6" onScroll={e => {
        const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
        if (nearBottom.current) setNewMessages(false);
      }}>
        <div className="flex w-full min-w-0 flex-col gap-3">
          {avisos.isError && <p role="alert" className="rounded-md bg-rose-500/10 p-3 text-sm text-rose-200">Não foi possível carregar o canal. <button className="underline" onClick={() => void avisos.refetch()}>Tentar novamente</button></p>}
          {avisos.isPending && <p className="py-6 text-center text-sm text-slate-400">Carregando canal…</p>}
          {!avisos.isPending && !avisos.isError && lista.length === 0 && <p className="py-6 text-center text-sm text-slate-400">{busca ? "Nenhum resultado encontrado." : "Nenhuma mensagem ou aviso no canal ainda."}</p>}
          {hasMore && <div className="text-center"><Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Carregando…" : "Carregar mensagens anteriores"}</Button></div>}
          {olderError && <p role="alert" className="text-center text-xs text-rose-300">Não foi possível carregar mensagens antigas.</p>}
          {lista.map((aviso, index) => {
            const dia = formatAvisoDia(aviso.criadoEm);
            const diaAnterior = index > 0 ? formatAvisoDia(lista[index - 1]!.criadoEm) : null;
            return <div key={aviso.id} data-aviso-id={aviso.id} className="space-y-1">
              {dia !== diaAnterior && <DiaSeparador dia={dia} />}
              {aviso.tipo === "chat" ? <div data-unread-chat={!aviso.lido && !aviso.proprio ? aviso.id : undefined}><BolhaChat aviso={aviso} /></div>
                : <CartaoAviso aviso={aviso} isAdmin={isAdmin} onRead={() => void markRead(aviso.id)} reading={readingIds.has(aviso.id)} />}
              <Reacoes aviso={aviso} onChange={reacoes => updateReacoes(aviso.id, reacoes)} />
            </div>;
          })}
        </div>
      </div>
      {newMessages && <div className="absolute bottom-3 right-5"><Button size="sm" onClick={scrollEnd}><ArrowDown size={14} /> Novas mensagens</Button></div>}
    </div>
    <footer className="shrink-0 border-t border-[#2b415b] bg-[#142337] px-4 py-3 md:px-6">
      {readError && <p role="alert" className="mb-2 text-xs text-rose-300">{readError}</p>}
      {podeEscrever ? <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); enviarTexto(texto.trim()); }}>
        <label className="min-w-0 flex-1"><span className="sr-only">Mensagem do canal</span>
          <textarea value={texto} onChange={event => setTexto(event.target.value)} onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); enviarTexto(texto.trim()); }
          }} rows={2} maxLength={2000} aria-label="Mensagem do canal" placeholder="Escreva uma mensagem para o canal…" disabled={enviar.isPending}
            className="w-full resize-y rounded-md border border-[#3b5876] bg-[#17283d] px-3 py-2 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-400 max-h-32" />
        </label>
        <Button type="submit" disabled={enviar.isPending || !texto.trim()}><Send size={16} aria-hidden="true" /> {enviar.isPending ? "Enviando…" : "Enviar"}</Button>
      </form> : <p className="text-center text-xs text-slate-400">Canal restrito a administradores e conferentes.</p>}
      {enviar.isError && <p role="alert" className="mt-1.5 text-xs text-rose-300">{enviar.error instanceof ApiError ? enviar.error.message : "Não foi possível enviar a mensagem."}</p>}
    </footer>
    {publishing && <PublishAvisoDialog onClose={() => setPublishing(false)} />}
  </section>;
}
