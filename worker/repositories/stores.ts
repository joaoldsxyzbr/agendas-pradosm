import type { z } from "zod";
import type { CreateStoreInput, UpdateStoreInput } from "../../shared/api.ts";
import { auditStatement } from "./audit.ts";
export interface StoreRow {
  id: string;
  codigo: string;
  nome: string;
  ativo: number;
  excluido_em: string | null;
  criado_em: string;
  atualizado_em: string;
  tem_conferente_ativo: number;
}
type StoreCreate = z.infer<typeof CreateStoreInput>;
type StoreUpdate = Omit<z.infer<typeof UpdateStoreInput>, "id">;
const STORE_COLUMNS = "id, codigo, nome, ativo, excluido_em, criado_em, atualizado_em, CASE WHEN EXISTS (SELECT 1 FROM usuarios u WHERE u.loja_id = lojas.id AND u.papel = 'conferente' AND u.ativo = 1 AND u.excluido_em IS NULL) THEN 1 ELSE 0 END AS tem_conferente_ativo";
async function listStores(db: D1Database): Promise<StoreRow[]> {
  const result = await db.prepare(
    `SELECT ${STORE_COLUMNS} FROM lojas WHERE excluido_em IS NULL ORDER BY codigo ASC`
  ).all<StoreRow>();
  return result.results ?? [];
}
async function findStoreById(db: D1Database, id: string): Promise<StoreRow | null> {
  return db.prepare(
    `SELECT ${STORE_COLUMNS} FROM lojas WHERE id = ? AND excluido_em IS NULL LIMIT 1`
  ).bind(id).first<StoreRow>();
}
async function findActiveStoreById(db: D1Database, id: string): Promise<StoreRow | null> {
  return db.prepare(
    `SELECT ${STORE_COLUMNS} FROM lojas WHERE id = ? AND ativo = 1 AND excluido_em IS NULL LIMIT 1`
  ).bind(id).first<StoreRow>();
}
async function createStore(db: D1Database, input: StoreCreate, actorUserId: string): Promise<StoreRow | null> {
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
  return await findStoreById(db, id);
}
async function updateStore(db: D1Database, current: StoreRow, input: StoreUpdate, actorUserId: string): Promise<StoreRow | null> {
  const codigo = input.codigo ?? current.codigo;
  const nome = input.nome ?? current.nome;
  const ativo = input.ativo === void 0 ? current.ativo : input.ativo ? 1 : 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const [write] = await db.batch([
    db.prepare(
      "UPDATE lojas SET codigo = ?, nome = ?, ativo = ?, atualizado_em = ? WHERE id = ? AND excluido_em IS NULL AND codigo = ? AND nome = ? AND ativo = ? AND atualizado_em = ?"
    ).bind(codigo, nome, ativo, now, current.id, current.codigo, current.nome, current.ativo, current.atualizado_em),
    auditStatement(db, {
      userId: actorUserId,
      action: "loja_atualizada",
      onlyIfPreviousWrite: true,
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
  if (write?.meta?.changes !== 1) throw Object.assign(new Error("Loja modificada por outra operação."), { code: "CONFLITO_ESTADO" });
  return await findStoreById(db, current.id);
}
async function hasStoreUsers(db: D1Database, storeId: string): Promise<boolean> {
  const result = await db.prepare(
    "SELECT 1 AS presente FROM usuarios WHERE loja_id = ? AND papel = 'conferente' AND excluido_em IS NULL LIMIT 1"
  ).bind(storeId).first();
  return result !== null;
}
async function softDeleteStore(db: D1Database, current: StoreRow, actorUserId: string): Promise<boolean> {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const [result] = await db.batch([
    db.prepare(
      "UPDATE lojas SET ativo = 0, excluido_em = ?, atualizado_em = ? WHERE id = ? AND excluido_em IS NULL AND codigo = ? AND nome = ? AND ativo = ? AND atualizado_em = ? AND NOT EXISTS (SELECT 1 FROM usuarios WHERE loja_id = lojas.id AND papel = 'conferente' AND excluido_em IS NULL)"
    ).bind(now, now, current.id, current.codigo, current.nome, current.ativo, current.atualizado_em),
    auditStatement(db, {
      userId: actorUserId,
      action: "loja_removida",
      onlyIfPreviousWrite: true,
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
  return Number(result.meta?.changes ?? 0) > 0;
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