import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { useSession } from "@/app/session-query";
import { enviarMensagem, getAvisos, getLeitores, marcarTodosLidos } from "./api";
import {
  formatAvisoDia,
  formatAvisoHora,
  rotuloLojasAviso,
  type Aviso,
  type AvisosResponse,
  type LeitoresAviso,
} from "./model";
import { PublishAvisoDialog } from "./publish-aviso-dialog";

// Página do canal de Avisos (decisão do João, 25/11/2026): um chat único em
// lugar do sino do cabeçalho. Mensagens comuns (tipo "chat") de admin e
// conferente em bolhas — as próprias à direita — e aviso oficial do admin em
// cartão destacado com a régua "quem viu". Leitura automática estilo
// WhatsApp: abrir o canal marca tudo como visto via marcar-todos. O
// visualizador acompanha sem escrever. O rodapé do compositor é sticky e
// alinhado à coluna do feed.
//
// Mudanças de 26/11/2026 (decisão do João):
// 1. O canal é só conversa humana: eventos do sistema ("Dia concluído",
//    "Agendas importadas em lote") não aparecem mais — o backend já entrega
//    a lista sem eventos; esta página também filtra por defesa, para o caso
//    de resposta antiga em cache.
// 2. Rodapé sticky alinhado à coluna do feed: em vez de -mx-* que estica o
//    footer além do max-w-3xl do conteúdo (o campo "sobrava pros lados"),
//    o footer herda a largura da seção.
// 3. Contador de caracteres (2000) visível quando o texto se aproxima do
//    limite.
// 4. Erro de envio restaura o texto no campo: 429/503 não pode apagar a
//    mensagem que o usuário digitou.

function DiaSeparador({ dia }: { dia: string }) {
  return <div role="separator" aria-label={dia}
    className="my-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
    {dia}
  </div>;
}

function BolhaChat({ aviso }: { aviso: Aviso }) {
  const propria = aviso.proprio === true;
  return <div className={`flex w-full flex-col ${propria ? "items-end" : "items-start"}`}>
    {!propria && <span className="mb-0.5 px-1 text-[11px] font-semibold text-slate-400">{aviso.autor}</span>}
    <div data-testid={propria ? "chat-proprio" : "chat-outro"}
      className={`max-w-[85%] whitespace-pre-wrap break-words px-3.5 py-2 text-sm ${
        propria
          ? "rounded-2xl rounded-br-sm bg-sky-600/80 text-white"
          : "rounded-2xl rounded-bl-sm bg-[#1c2f47] text-slate-100"}`}
      aria-label={`${propria ? "Sua mensagem" : "Mensagem de " + aviso.autor}`}>
      {aviso.mensagem}
      <span className="ml-2 align-bottom text-[10px] text-slate-400">{formatAvisoHora(aviso.criadoEm)}</span>
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
  return <details className="mt-1.5" onToggle={event => setAberto((event.target as HTMLDetailsElement).open)}
    data-testid={`leitores-${avisoId}`}>
    <summary className="cursor-pointer select-none text-[11px] font-semibold text-sky-300">
      {leitores.isPending && aberto ? "Consultando quem viu…" : `Aberto por ${vistos.length} de ${total}`}
    </summary>
    <div className="mt-1 space-y-1 text-[11px] text-slate-300">
      {leitores.isError && <p className="text-rose-300">Não foi possível carregar a lista de leitores.</p>}
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

function CartaoAviso({ aviso, isAdmin }: { aviso: Aviso; isAdmin: boolean }) {
  return <article aria-label={aviso.titulo ?? "Aviso"}
    className={`w-full max-w-xl self-stretch rounded-lg border-l-2 px-3.5 py-2.5 ${
      aviso.lido
        ? "border-amber-500/50 bg-amber-500/5"
        : aviso.urgente
          ? "animate-pulse border-rose-500 bg-rose-500/10"
          : "border-amber-500/80 bg-amber-500/10"}`}>
    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-300">Aviso</span>
      {aviso.urgente && <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-semibold text-rose-200">Urgente</span>}
      <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-slate-300">{rotuloLojasAviso(aviso.lojas)}</span>
      {formatAvisoHora(aviso.criadoEm)} · por {aviso.autor}
    </p>
    <h3 className="mt-1 text-sm font-bold text-slate-100">{aviso.titulo}</h3>
    <p className="mt-0.5 break-words text-sm text-slate-300">{aviso.mensagem}</p>
    {isAdmin && <LeitoresDoAviso avisoId={aviso.id} />}
  </article>;
}

const LIMITE_MENSAGEM = 2000;

export function AvisosPage() {
  // Sessão pelo hook canônico do app (o mesmo do LayoutRoute): a página não
  // depende mais do contexto do Outlet do Guard — nenhuma outra tela do
  // sistema consome esse contexto e a sessão em cache evita nova chamada.
  const session = useSession();
  const user = session.data;
  const client = useQueryClient();
  const isAdmin = user?.papel === "admin";
  const podeEscrever = user?.papel === "admin" || user?.papel === "conferente";
  const [publishing, setPublishing] = useState(false);
  const [texto, setTexto] = useState("");
  const [olderPages, setOlderPages] = useState<AvisosResponse[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const avisos = useQuery({
    queryKey: ["avisos"],
    queryFn: () => getAvisos(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Leitura automática estilo WhatsApp (25/11): abrir o canal marca como
  // visto tudo o que o usuário enxerga. Otimista: zera o badge na hora.
  const marcarTodos = useMutation({
    mutationFn: marcarTodosLidos,
    onMutate: async () => {
      await client.cancelQueries({ queryKey: ["avisos"] });
      const previous = client.getQueryData<AvisosResponse>(["avisos"]) ?? null;
      client.setQueryData<AvisosResponse>(["avisos"], current =>
        current ? { ...current, naoLidos: 0, avisos: current.avisos.map(aviso => ({ ...aviso, lido: true })) } : current);
      return { previous };
    },
    onError: (_error, _void, context) => {
      if (context?.previous) client.setQueryData(["avisos"], context.previous);
    },
    onSettled: () => { void client.invalidateQueries({ queryKey: ["avisos"] }); },
  });

  // Dispara a leitura automática sempre que a listagem trouxer pendências —
  // na abertura da página e nas novas mensagens que chegam pelo polling.
  const pendentes = avisos.data?.naoLidos ?? 0;
  useEffect(() => {
    if (pendentes > 0 && !marcarTodos.isPending) marcarTodos.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avisos.data]);

  const enviar = useMutation({
    mutationFn: enviarMensagem,
    onSettled: () => { void client.invalidateQueries({ queryKey: ["avisos"] }); },
  });

  const enviarTexto = (mensagem: string) => {
    if (!mensagem || enviar.isPending) return;
    setTexto("");
    enviar.mutate({ mensagem }, {
      // Erro de envio (429, 503, rede): devolve o texto ao campo — a
      // mensagem não pode se perder porque o servidor recusou.
      onError: () => setTexto(mensagem),
    });
  };

  // Carregar mensagens antigas é opt-in: o polling segue consultando só os
  // 50 itens mais recentes, sem multiplicar leituras no D1.
  const loadMore = async () => {
    const nextCursor = (olderPages.at(-1) ?? avisos.data)?.nextCursor;
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setOlderError(false);
    try {
      const page = await getAvisos(nextCursor);
      setOlderPages(current => [...current, page]);
    } catch {
      setOlderError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  // Ordem de exibição: o canal chega do mais recente para o mais antigo; o
  // chat inverte para a mensagem mais nova ficar embaixo. Sem eventos: o
  // backend já não os entrega, e o filtro defensivo cobre cache antigo.
  const listaDesc = [...(avisos.data?.avisos ?? []), ...olderPages.flatMap(page => page.avisos)]
    .filter(aviso => aviso.tipo !== "evento");
  const lista = [...new Map(listaDesc.map(aviso => [aviso.id, aviso] as const)).values()].reverse();
  const lastPage = olderPages.at(-1) ?? avisos.data;
  const hasMore = Boolean(lastPage?.hasMore && Boolean(lastPage?.nextCursor));

  // Rola para o fim quando entra uma mensagem nova (não ao carregar antigas).
  const ultimoId = lista.at(-1)?.id;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [ultimoId]);

  const restante = LIMITE_MENSAGEM - texto.length;

  return <section aria-labelledby="avisos-heading" className="mx-auto flex w-full max-w-3xl flex-col">
    <div className="flex flex-wrap items-end justify-between gap-2 pb-2">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-400">Canal</p>
        <h1 id="avisos-heading" className="text-lg font-bold text-slate-100">Avisos</h1>
      </div>
      {isAdmin && <Button size="sm" variant="secondary" onClick={() => setPublishing(true)}>
        <Megaphone size={14} aria-hidden="true" /> Novo aviso
      </Button>}
    </div>

    <div data-testid="avisos-mensagens" className="flex flex-col gap-2 pb-2">
      {avisos.isError && <p role="alert" className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
        Não foi possível carregar o canal de avisos.
      </p>}
      {!avisos.isError && lista.length === 0 && (
        <p className="py-6 text-center text-xs text-slate-400">Nenhuma mensagem ou aviso no canal ainda.</p>
      )}
      {hasMore && <div className="text-center">
        <Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => { void loadMore(); }}>
          {loadingMore ? "Carregando…" : "Carregar mensagens anteriores"}
        </Button>
      </div>}
      {olderError && <p role="alert" className="text-center text-xs text-rose-300">Não foi possível carregar mensagens antigas.</p>}
      {lista.map((aviso, index) => {
        const dia = formatAvisoDia(aviso.criadoEm);
        const anterior = lista[index - 1];
        const diaAnterior = anterior ? formatAvisoDia(anterior.criadoEm) : null;
        return <div key={aviso.id} className="contents">
          {dia !== diaAnterior && <DiaSeparador dia={dia} />}
          {aviso.tipo === "chat" ? <BolhaChat aviso={aviso} /> : <CartaoAviso aviso={aviso} isAdmin={isAdmin} />}
        </div>;
      })}
      <div ref={bottomRef} aria-hidden="true" />
    </div>

    <footer className="sticky bottom-0 z-10 border-t border-[#2b415b] bg-[#142337]/95 py-3 backdrop-blur">
      {podeEscrever ? <form className="flex items-end gap-2" onSubmit={event => {
        event.preventDefault();
        enviarTexto(texto.trim());
      }}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Mensagem do canal</span>
          <textarea
            value={texto}
            onChange={event => setTexto(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                enviarTexto(texto.trim());
              }
            }}
            rows={1}
            maxLength={LIMITE_MENSAGEM}
            aria-label="Mensagem do canal"
            placeholder="Escreva uma mensagem para o canal…"
            disabled={enviar.isPending}
            className="max-h-32 w-full resize-none rounded-md border border-[#3b5876] bg-[#17283d] px-3 py-2 text-sm text-slate-100 outline-offset-2 focus-visible:outline-2 focus-visible:outline-sky-400"
          />
          {restante < 200 && <span className="mt-1 block text-right text-[10px] text-slate-400" aria-live="polite">
            {restante < 0 ? `${Math.abs(restante)} caracteres acima do limite` : `${restante} caracteres restantes`}
          </span>}
        </label>
        <Button type="submit" size="sm" disabled={enviar.isPending || texto.trim().length === 0}>
          <Send size={14} aria-hidden="true" /> Enviar
        </Button>
      </form>
      : <p className="text-center text-[11px] text-slate-400">
        Somente leitura: visualizadores acompanham o canal; a escrita é de administradores e conferentes.
      </p>}
      {enviar.isError && <p role="alert" className="mt-1.5 text-xs text-rose-300">
        {enviar.error instanceof ApiError ? enviar.error.message : "Não foi possível enviar a mensagem."}
      </p>}
    </footer>

    {publishing && <PublishAvisoDialog onClose={() => setPublishing(false)} />}
  </section>;
}
