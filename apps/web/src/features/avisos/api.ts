import { apiFetch } from "@/lib/api";
import {
  avisoPublicadoSchema,
  avisoSchema,
  avisosResponseSchema,
  leitoresAvisoSchema,
  publicarAvisoSchema,
  publicarMensagemSchema,
  type Aviso,
  type AvisoPublicado,
  type AvisoCursor,
  type AvisosResponse,
  type LeitoresAviso,
  type PublicarAvisoInput,
  type PublicarMensagemInput,
} from "./model";

// GET /api/avisos — canal completo (mais recentes primeiro) + contagem de
// não lidos do usuário logado. O chat da página inverte a ordem para exibir
// a mais antiga no topo e a mais recente embaixo.
export async function getAvisos(cursor?: AvisoCursor | null, filtros?: { tipo?: "aviso"; busca?: string }): Promise<AvisosResponse> {
  const params = new URLSearchParams();
  if (cursor) { params.set("before", cursor.criadoEm); params.set("beforeId", cursor.id); }
  if (filtros?.tipo) params.set("tipo", filtros.tipo);
  if (filtros?.busca) params.set("q", filtros.busca);
  const query = params.toString() ? "?" + params.toString() : "";
  return avisosResponseSchema.parse(await apiFetch<unknown>("/api/avisos" + query));
}

// POST /api/avisos — mensagem comum do canal (tipo "chat"): escrita de admin
// e conferente, sempre global. A resposta é a mensagem completa (avisoSchema)
// com "proprio" true, para o remetente já ver a bolha alinhada à direita.
export async function enviarMensagem(input: PublicarMensagemInput): Promise<Aviso> {
  return avisoSchema.parse(await apiFetch<unknown>("/api/avisos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(publicarMensagemSchema.parse(input)),
  }));
}

// POST /api/avisos/:id/lido — idempotente; o servidor responde { jaLido }.
export async function markAvisoLido(id: string): Promise<boolean> {
  const data = await apiFetch<{ jaLido?: boolean }>(`/api/avisos/${encodeURIComponent(id)}/lido`, {
    method: "POST",
  });
  return data.jaLido === true;
}

// POST /api/avisos/marcar-todos — grava a leitura de todos os avisos e
// mensagens visíveis. É o motor da leitura automática ao abrir o canal.
export async function marcarTodosLidos(): Promise<number> {
  const data = await apiFetch<{ marcados?: number }>("/api/avisos/marcar-todos", {
    method: "POST",
  });
  return data.marcados ?? 0;
}

// POST /api/admin/avisos — publica aviso oficial (urgência e lojas opcionais).
// Aviso é registro permanente: nunca é excluído.
export async function publishAviso(input: PublicarAvisoInput): Promise<AvisoPublicado> {
  return avisoPublicadoSchema.parse(await apiFetch<unknown>("/api/admin/avisos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(publicarAvisoSchema.parse(input)),
  }));
}

// GET /api/admin/avisos/:id/leitores — régua do admin para o aviso oficial:
// quem já viu (com horário) e quem ainda está aguardando.
export async function getLeitores(avisoId: string): Promise<LeitoresAviso> {
  return leitoresAvisoSchema.parse(
    await apiFetch<unknown>(`/api/admin/avisos/${encodeURIComponent(avisoId)}/leitores`)
  );
}
