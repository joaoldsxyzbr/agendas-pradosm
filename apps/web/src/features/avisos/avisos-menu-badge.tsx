import { useQuery } from "@tanstack/react-query";
import { getAvisos } from "./api";

// Badge de não lidos do item "Avisos" do menu (decisão de 25/11/2026): o sino
// saiu do cabeçalho e a contagem migrou para a navegação. Pulsante em
// vermelho enquanto houver aviso urgente não lido — a leitura automática da
// página do canal zera a contagem. Consulta a mesma chave ["avisos"] da
// página do canal: uma única requisição serve os dois componentes.
//
// Melhoria de 26/11/2026: o badge deixou de ser aria-hidden — um span
// oculto ao leitor de tela escondia da pessoa que existem pendências. Agora
// o link é anunciado como "Avisos, N não lidos" (e "aviso urgente não lido"
// quando for o caso), sem poluição visual para quem enxerga.
export function AvisosMenuBadge() {
  const avisos = useQuery({
    queryKey: ["avisos"],
    queryFn: () => getAvisos(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const naoLidos = avisos.data?.naoLidos ?? 0;
  if (naoLidos <= 0) return null;
  const urgenteNaoLido = (avisos.data?.avisos ?? []).some(aviso => aviso.urgente && !aviso.lido);
  return <span data-testid="avisos-badge"
    className={`ml-auto grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 text-[10px] font-bold leading-4 text-white ${
      urgenteNaoLido ? "animate-pulse bg-red-500" : "bg-rose-500"}`}>
    <span className="sr-only">{`${naoLidos} não lidos${urgenteNaoLido ? ", incluindo aviso urgente" : ""}`}</span>
    <span aria-hidden="true">{naoLidos > 99 ? "99+" : naoLidos}</span>
  </span>;
}
