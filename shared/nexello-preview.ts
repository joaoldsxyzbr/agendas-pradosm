import { z } from "zod";

const InvalidRow = z.object({ index: z.number().int().positive(), kind: z.literal("invalid"), field: z.string().max(80) });
export const NexelloComparisonSchema = z.enum(["unresolved_store","duplicate_conflict","multiple_local","not_found","protected_local","same_fields","different_fields"]);
export type NexelloComparison = z.infer<typeof NexelloComparisonSchema>;
const ObservedRow = z.object({
  index: z.number().int().positive(), kind: z.literal("observed"), protocol: z.string(),
  date: z.string(), startTime: z.string(), endTime: z.string(), storeCode: z.string().nullable(),
  supplier: z.string(), type: z.string(), nfe: z.array(z.string()), orders: z.array(z.string()),
  externalState: z.literal("unknown"),
  comparison: NexelloComparisonSchema.optional(),
});
export const NexelloPreviewRowSchema = z.discriminatedUnion("kind", [InvalidRow, ObservedRow]);
export const NexelloPreviewPageSchema = z.object({
  page: z.number().int().min(1).max(15), lastPage: z.number().int().min(1).max(15),
  total: z.number().int().nonnegative().max(1500), rows: z.array(NexelloPreviewRowSchema).max(100),
  readOnly: z.literal(true),
});
export type NexelloPreviewRow = z.infer<typeof NexelloPreviewRowSchema>;
export type NexelloPreviewPage = z.infer<typeof NexelloPreviewPageSchema>;
export const NexelloPreviewConfigSchema = z.object({ available: z.boolean(), readOnly: z.literal(true) });
