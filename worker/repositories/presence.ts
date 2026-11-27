export interface PresenceRow {usuario_id:string;loja_id:string;ultima_interacao_em:string|null;ultimo_sinal_em:string;}
interface PresenceInput {userId:string;storeId:string;interacted:boolean;now:string;}
async function touchConferentePresence(db:D1Database, input:PresenceInput):Promise<void> {
  const interactionAt = input.interacted ? input.now : null;
  await db.prepare(
    `INSERT INTO conferente_presenca (
        usuario_id,
        loja_id,
        ultima_interacao_em,
        ultimo_sinal_em,
        atualizado_em
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(usuario_id) DO UPDATE SET
        loja_id = excluded.loja_id,
        ultima_interacao_em = CASE
          WHEN conferente_presenca.loja_id <> excluded.loja_id
            THEN excluded.ultima_interacao_em
          WHEN excluded.ultima_interacao_em IS NOT NULL
            THEN excluded.ultima_interacao_em
          ELSE conferente_presenca.ultima_interacao_em
        END,
        ultimo_sinal_em = excluded.ultimo_sinal_em,
        atualizado_em = excluded.atualizado_em`
  ).bind(
    input.userId,
    input.storeId,
    interactionAt,
    input.now,
    input.now
  ).run();
}
async function clearConferentePresence(db:D1Database, userId:string):Promise<void> {
  await db.prepare("DELETE FROM conferente_presenca WHERE usuario_id = ?").bind(userId).run();
}
async function listActiveConferentePresence(db:D1Database,custom=false):Promise<PresenceRow[]> {
  if(custom){
    const rows=await db.prepare(`SELECT p.usuario_id,p.loja_id,p.ultima_interacao_em,p.ultimo_sinal_em FROM conferente_presenca p JOIN usuarios u ON u.id=p.usuario_id LEFT JOIN usuario_acesso a ON a.usuario_id=u.id WHERE u.excluido_em IS NULL AND ((a.usuario_id IS NULL AND u.ativo=1 AND u.papel=\'conferente\' AND u.loja_id=p.loja_id) OR (a.usuario_id IS NOT NULL AND a.ativo=1 AND (a.escopo=\'todas\' OR EXISTS (SELECT 1 FROM usuario_acesso_lojas l WHERE l.usuario_id=u.id AND l.loja_id=p.loja_id))))`).all<PresenceRow>();
    if(!rows.success||!rows.results)throw new Error("PRESENCA_CONSULTA_FALHOU");
    return rows.results;
  }
  const result = await db.prepare(
    `SELECT
        p.usuario_id,
        p.loja_id,
        p.ultima_interacao_em,
        p.ultimo_sinal_em
      FROM conferente_presenca p
      INNER JOIN usuarios u
        ON u.id = p.usuario_id
       AND u.loja_id = p.loja_id
      WHERE u.papel = 'conferente'
        AND u.ativo = 1
        AND u.excluido_em IS NULL`
  ).all<PresenceRow>();
  if(!result.success||!result.results)throw new Error("PRESENCA_CONSULTA_FALHOU");
  return result.results;
}
export {
  clearConferentePresence,
  listActiveConferentePresence,
  touchConferentePresence
};