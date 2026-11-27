import { z } from "zod";
const REALTIME_PROTOCOL_VERSION = 1;
const AGENDA_CHANGE_REASONS = Object.freeze([
  "status", "exchanges", "manual", "day-status", "import", "observation"
] as const);
function isAgendaChangedReason(value: string): boolean {
  return AGENDA_CHANGE_REASONS.some(reason => reason === value);
}
export {
  REALTIME_PROTOCOL_VERSION,
  AGENDA_CHANGE_REASONS,
  isAgendaChangedReason
};
export const realtimeConfigSchema = z.object({ mode: z.enum(["on", "shadow", "off"]), protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION) });
export const realtimePresenceSchema = z.object({ storeId: z.string(), status: z.enum(["online", "away", "offline"]) });
export const realtimeEventSchema = z.discriminatedUnion("type", [
  z.object({ version: z.literal(REALTIME_PROTOCOL_VERSION), type: z.literal("agenda.changed"),
    agendaId: z.string(), storeId: z.string(), date: z.iso.date(), reason: z.enum(AGENDA_CHANGE_REASONS) }),
  z.object({ version: z.literal(REALTIME_PROTOCOL_VERSION), type: z.literal("presence.snapshot"), stores: z.array(realtimePresenceSchema) }),
  z.object({ version: z.literal(REALTIME_PROTOCOL_VERSION), type: z.literal("presence.changed"), ...realtimePresenceSchema.shape }),
  z.object({ version: z.literal(REALTIME_PROTOCOL_VERSION), type: z.literal("avisos.changed") }),
  z.object({ version: z.literal(REALTIME_PROTOCOL_VERSION), type: z.literal("realtime.ready") }),
]);
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
export type RealtimeMode = z.infer<typeof realtimeConfigSchema>["mode"];
