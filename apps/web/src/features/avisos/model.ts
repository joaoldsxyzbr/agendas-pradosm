import {
  avisoSchema,
  avisosResponseSchema,
  leitoresAvisoSchema,
  publicarAvisoSchema,
  publicarMensagemSchema,
  type Aviso,
  type AvisoCursor,
  type AvisosResponse,
  type LeitorCanal,
  type LeitoresAviso,
  type PublicarAvisoInput,
  type PublicarMensagemInput,
} from "../../../../../shared/avisos.ts";

// Contratos de avisos reaproveitados do shared entre Worker e frontend
// (mesmo padrão do import-model). O zod continua sendo a fonte da verdade.
export { avisoSchema, avisosResponseSchema, leitoresAvisoSchema, publicarAvisoSchema, publicarMensagemSchema };
export type { Aviso, AvisoCursor, AvisosResponse, LeitorCanal, LeitoresAviso, PublicarAvisoInput, PublicarMensagemInput };

export const avisoPublicadoSchema = avisoSchema;
export type AvisoPublicado = Aviso;

// Carimbo de criação no fuso de Brasília (sem DST).
export function formatAvisoStamp(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
  }).format(date);
}

// Dia (cabeçalho do agrupamento do chat) e hora (carimbo das bolhas).
export function formatAvisoDia(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long", timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function formatAvisoHora(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeStyle: "short", timeZone: "America/Sao_Paulo",
  }).format(date);
}

// Rótulo curto do público do aviso: null = todas as lojas.
export function rotuloLojasAviso(lojas: string[] | null) {
  if (!lojas) return "Todas as lojas";
  return (lojas.length === 1 ? "Loja " : "Lojas ") + lojas.join(", ");
}
