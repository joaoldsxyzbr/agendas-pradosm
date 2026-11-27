/** Atomic reservation using the D1 primary's clock. No external call on denial
 * or DB failure. At most one new request every four seconds through this V2.
 * Other applications using the same Nexello credential are outside this gate. */
export async function reserveNexelloRequest(db: D1Database): Promise<boolean> {
  const result = await db.prepare(`
    INSERT INTO nexello_limite_consulta(fonte,proxima_consulta_em)
    VALUES('relatorio_60',unixepoch('now')+4)
    ON CONFLICT(fonte) DO UPDATE SET proxima_consulta_em=excluded.proxima_consulta_em
    WHERE nexello_limite_consulta.proxima_consulta_em <= unixepoch('now')
  `).run();
  const changes = result.meta?.changes;
  if (!result.success || (changes !== 0 && changes !== 1)) {
    throw new Error("NEXELLO_RESERVA_FALHOU");
  }
  return changes === 1;
}
