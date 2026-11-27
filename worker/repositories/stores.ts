import type { z } from "zod";
import type { CreateStoreInput, UpdateStoreInput } from "../../shared/api.ts";
import { auditStatement } from "./audit.ts";
export interface StoreRow {
  id:string; codigo:string; nome:string; ativo:number; excluido_em:string|null;
  criado_em:string; atualizado_em:string; tem_conferente_ativo:number;
}
const STORE_COLUMNS = "id, codigo, nome, ativo, excluido_em, criado_em, atualizado_em, CASE WHEN EXISTS (SELECT 1 FROM usuarios u WHERE u.loja_id = lojas.id AND u.papel = 'conferente' AND u.ativo = 1 AND u.excluido_em IS NULL) THEN 1 ELSE 0 END AS tem_conferente_ativo";
async function listStores(db:D1Database):Promise<StoreRow[]> {
  const result = await db.prepare(
    `SELECT ${STORE_COLUMNS} FROM lojas WHERE excluido_em IS NULL ORDER BY codigo ASC`
  ).all<StoreRow>();
  if(!result.success||!result.results)throw new Error("LOJAS_CONSULTA_FALHOU");
  return result.results;
}
async function findStoreById(db:D1Database, id:string):Promise<StoreRow|null> {
  return db.prepare(
    `SELECT ${STORE_COLUMNS} FROM lojas WHERE id = ? AND excluido_em IS NULL LIMIT 1`
  ).bind(id).first<StoreRow>();
}
async function findActiveStoreById(db:D1Database, id:string):Promise<StoreRow|null> {
  return db.prepare(
    `SELECT ${STORE_COLUMNS} FROM lojas WHERE id = ? AND ativo = 1 AND excluido_em IS NULL LIMIT 1`
  ).bind(id).first<StoreRow>();
}
async function createStore(db:D1Database, input:z.output<typeof CreateStoreInput>, actorUserId:string):Promise<StoreRow> {
  const id = crypto.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await db.batch([
    db.prepare(
      "INSERT INTO lojas (id, codigo, nome, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, 1, ?, ?)"
    ).bind(id, input.codigo, input.nome, now, now),
    auditStatement(db, {
      userId: actorUserId,
      action: "loja_criada",
      entity: "loja",
      entityId: id,
      storeId: id,
      after: {
        codigo: input.codigo,
        nome: input.nome,
        ativo: true
      },
      details: "Loja criada.",
      createdAt: now
    })
  ]);
  const created=await findStoreById(db,id);
  if(!created)throw new Error("LOJA_GRAVACAO_INDETERMINADA");
  return created;
}
async function updateStore(db:D1Database, current:StoreRow, input:Omit<z.output<typeof UpdateStoreInput>,"id">, actorUserId:string):Promise<StoreRow> {
  const codigo = input.codigo ?? current.codigo;
  const nome = input.nome ?? current.nome;
  const ativo = input.ativo === void 0 ? current.ativo : input.ativo ? 1 : 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const [write,audit]=await db.batch([
    db.prepare(
      "UPDATE lojas SET codigo = ?, nome = ?, ativo = ?, atualizado_em = ? WHERE id = ? AND excluido_em IS NULL AND codigo = ? COLLATE BINARY AND nome = ? AND ativo = ? AND atualizado_em = ?"
    ).bind(codigo, nome, ativo, now, current.id,current.codigo,current.nome,current.ativo,current.atualizado_em),
    auditStatement(db, {
      userId: actorUserId,
      action: "loja_atualizada",
      onlyIfPreviousWrite:true,
      entity: "loja",
      entityId: current.id,
      storeId: current.id,
      before: {
        codigo: current.codigo,
        nome: current.nome,
        ativo: current.ativo === 1
      },
      after: {
        codigo,
        nome,
        ativo: ativo === 1
      },
      details: "Loja atualizada.",
      createdAt: now
    })
  ]);
  if(!write?.success||!audit?.success)throw new Error("LOJA_GRAVACAO_INDETERMINADA");
  if(write.meta?.changes!==1)throw Object.assign(new Error("LOJA_CONFLITO_ESTADO"),{code:"CONFLITO_ESTADO"});
  const updated=await findStoreById(db,current.id);
  if(!updated)throw new Error("LOJA_GRAVACAO_INDETERMINADA");
  return updated;
}
async function hasStoreUsers(db:D1Database, storeId:string, custom=false):Promise<boolean> {
  if(custom){const linked=await db.prepare("SELECT 1 AS presente FROM usuario_acesso_lojas a JOIN usuarios u ON u.id=a.usuario_id WHERE a.loja_id=? AND u.excluido_em IS NULL LIMIT 1").bind(storeId).first();if(linked)return true;}
  const result = await db.prepare(
    "SELECT 1 AS presente FROM usuarios WHERE loja_id = ? AND papel = 'conferente' AND excluido_em IS NULL LIMIT 1"
  ).bind(storeId).first();
  return result !== null;
}
async function softDeleteStore(db:D1Database, current:StoreRow, actorUserId:string):Promise<boolean> {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const [result,audit] = await db.batch([
    db.prepare(
      "UPDATE lojas SET ativo = 0, excluido_em = ?, atualizado_em = ? WHERE id = ? AND excluido_em IS NULL AND codigo = ? COLLATE BINARY AND nome = ? AND ativo = ? AND atualizado_em = ?"
    ).bind(now, now, current.id,current.codigo,current.nome,current.ativo,current.atualizado_em),
    auditStatement(db, {
      userId: actorUserId,
      action: "loja_removida",
      onlyIfPreviousWrite:true,
      entity: "loja",
      entityId: current.id,
      storeId: current.id,
      before: {
        codigo: current.codigo,
        nome: current.nome,
        ativo: current.ativo === 1
      },
      after: {
        codigo: current.codigo,
        nome: current.nome,
        ativo: false,
        removida: true
      },
      details: "Loja removida logicamente.",
      createdAt: now
    })
  ]);
  if(!result?.success||!audit?.success||typeof result.meta?.changes!=="number")throw new Error("LOJA_GRAVACAO_INDETERMINADA");
  if(result.meta.changes!==1)throw new Error("LOJA_CONFLITO_ESTADO");
  return true;
}
export {
  createStore,
  findActiveStoreById,
  findStoreById,
  hasStoreUsers,
  listStores,
  softDeleteStore,
  updateStore
};