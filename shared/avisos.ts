import { z } from "zod";

// Contrato da API de avisos/notificações in-app entre Worker e frontend.
// "aviso" é publicado pelo admin; "evento" é gerado pelo sistema; "chat" é a
// mensagem comum do canal de avisos (decisão de 25/11/2026: conferentes
// escrevem, todos do canal leem). Avisos e mensagens são registro permanente
// (sem expiração e sem inativação, decisão de 12/11/2026); "lojas" null
// significa todas as lojas. O título é opcional: só o aviso oficial exige.
// Limites de texto são hardening do input (spec 2026-11-11, decisão 9).

export const avisoTipoSchema = z.enum(["aviso", "evento", "chat"]);

const avisoLojaCodigo = z
  .string()
  .trim()
  .min(1, "Código de loja inválido.")
  .max(10, "Código de loja inválido.");

export const avisoLojasSchema = z
  .array(avisoLojaCodigo)
  .max(20, "Escolha no máximo 20 lojas.");

export const avisoSchema = z.object({
  id: z.string(),
  tipo: avisoTipoSchema,
  titulo: z.string().nullable(),
  mensagem: z.string(),
  criadoEm: z.string(),
  lido: z.boolean(),
  urgente: z.boolean(),
  // Presente quando a linha vem da listagem do usuário (GET /api/avisos):
  // true quando a mensagem foi escrita pelo próprio usuário. Opcional para
  // manter respostas de publicação e mocks antigos válidos.
  proprio: z.boolean().optional(),
  autor: z.string(),
  lojas: z.array(z.string()).nullable(),
});

export const avisoCursorSchema = z.object({
  criadoEm: z.string(),
  id: z.string(),
});

export const avisosResponseSchema = z.object({
  avisos: z.array(avisoSchema),
  naoLidos: z.number().int().nonnegative(),
  // Opcionais para tolerar respostas dos mocks e da API anterior.
  hasMore: z.boolean().optional(),
  nextCursor: avisoCursorSchema.nullable().optional(),
});

// Corpo do POST /api/admin/avisos. "lojas" null (ou omitido) publica para
// todas as lojas; um array publica apenas para as lojas escolhidas.
export const publicarAvisoSchema = z.object({
  titulo: z
    .string()
    .trim()
    .min(1, "Informe o título do aviso.")
    .max(200, "Título acima do limite de 200 caracteres."),
  mensagem: z
    .string()
    .trim()
    .min(1, "Informe a mensagem do aviso.")
    .max(2000, "Mensagem acima do limite de 2000 caracteres."),
  urgente: z.boolean().optional().default(false),
  lojas: avisoLojasSchema.nullable().optional().default(null),
});

// Corpo do POST /api/avisos — mensagem comum do canal (tipo "chat"). Sem
// título, sem urgência e sempre global (sem direcionamento por loja).
// Escrita de admin e conferente; o visualizador apenas acompanha.
export const publicarMensagemSchema = z.object({
  mensagem: z
    .string()
    .trim()
    .min(1, "Informe a mensagem.")
    .max(2000, "Mensagem acima do limite de 2000 caracteres."),
});

// Resposta do GET /api/admin/avisos/:id/leitores — a régua do admin: quem
// já viu o aviso oficial (com o horário) e quem ainda está aguardando
// (conferentes ativos do público destinatário do aviso).
export const leitorCanalSchema = z.object({
  id: z.string(),
  nome: z.string(),
  lidoEm: z.string().nullable(),
  loja: z.string().nullable(),
});

export const leitoresAvisoSchema = z.object({
  vistos: z.array(leitorCanalSchema),
  faltantes: z.array(leitorCanalSchema),
});

export type AvisoCursor = z.infer<typeof avisoCursorSchema>;
export type AvisoTipo = z.infer<typeof avisoTipoSchema>;
export type Aviso = z.infer<typeof avisoSchema>;
export type AvisosResponse = z.infer<typeof avisosResponseSchema>;
export type PublicarAvisoInput = z.infer<typeof publicarAvisoSchema>;
export type PublicarMensagemInput = z.infer<typeof publicarMensagemSchema>;
export type LeitorCanal = z.infer<typeof leitorCanalSchema>;
export type LeitoresAviso = z.infer<typeof leitoresAvisoSchema>;
