// Classificação fechada: não envia message, stack, URL, headers, IDs de
// usuário, cookies nem dados de negócio ao log. Valores externos não passam.
export function realtimeFailureKind(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  switch(error.name) {
    case "TypeError": return "type_error";
    case "RangeError": return "range_error";
    case "AbortError": return "aborted";
    case "TimeoutError": return "timeout";
    default: return "error";
  }
}
