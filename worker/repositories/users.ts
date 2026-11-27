import type { UserRole } from "../../shared/auth.ts";
import { hashPassword } from "../lib/password.ts";
import { accessInsertStatements, type AccessChange } from "./access.ts";
import { auditStatement } from "./audit.ts";
export interface UserSummary {id:string;loja_id:string|null;nome:string;login:string;papel:UserRole;ativo:number;session_version:number;excluido_em:string|null;}
export interface UserRow extends UserSummary {senha_hash:string;}
interface CreateUserData {nome:string;login:string;senha:string;papel:UserRole;lojaId?:string|null;}
interface UpdateUserData {nome?:string;login?:string;senha?:string;papel?:UserRole;lojaId?:string|null;ativo?:boolean;}
type BootstrapData=Pick<CreateUserData,"nome"|"login"|"senha">;
const SUMMARY_COLUMNS = "id, loja_id, nome, login, papel, ativo, session_version, excluido_em";
const USER_COLUMNS = "id, loja_id, nome, login, senha_hash, papel, ativo, session_version, excluido_em";
async function findUserByLogin(db:D1Database,login:string):Promise<UserRow|null> {
  return db.prepare(
    `SELECT ${USER_COLUMNS} FROM usuarios WHERE login = ? COLLATE NOCASE AND excluido_em IS NULL LIMIT 1`
  ).bind(login).first<UserRow>();
}
async function findUserById(db:D1Database,id:string):Promise<UserRow|null> {
  return db.prepare(
    `SELECT ${USER_COLUMNS} FROM usuarios WHERE id = ? AND excluido_em IS NULL LIMIT 1`
  ).bind(id).first<UserRow>();
}
// A consulta autenticada verifica a revogação na mesma leitura do usuário,
// evitando uma segunda operação D1 em cada requisição.
async function findUserForSession(db:D1Database,id:string,sessionKey:string):Promise<UserRow|null> {
  return db.prepare(
    `SELECT ${USER_COLUMNS} FROM usuarios WHERE id = ? AND excluido_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM sessoes_revogadas WHERE session_key = ?) LIMIT 1`
  ).bind(id, sessionKey).first<UserRow>();
}
async function revokeSession(db:D1Database, sessionKey:string, expiresAt:number):Promise<void> {
  const result=await db.prepare(
    "INSERT INTO sessoes_revogadas (session_key, expira_em) VALUES (?, ?) ON CONFLICT(session_key) DO UPDATE SET expira_em = MAX(sessoes_revogadas.expira_em, excluded.expira_em)"
  ).bind(sessionKey, expiresAt).run();
  if(!result.success)throw new Error("SESSAO_REVOGACAO_FALHOU");
}
async function pruneRevokedSessions(db:D1Database, nowSeconds = Math.floor(Date.now() / 1000)) {
  return db.prepare("DELETE FROM sessoes_revogadas WHERE expira_em <= ?")
    .bind(nowSeconds).run();
}
async function upgradeUserPasswordHash(db:D1Database,userId:string,expectedHash:string,passwordHash:string):Promise<boolean> {
  // Não sobrescrever uma senha alterada por outra sessão/admin durante o login.
  const result = await db.prepare(
    "UPDATE usuarios SET senha_hash = ?, atualizado_em = ? WHERE id = ? AND senha_hash = ? AND excluido_em IS NULL"
  ).bind(passwordHash, new Date().toISOString(), userId, expectedHash).run();
  if(!result.success||typeof result.meta?.changes!=="number")throw new Error("USUARIO_GRAVACAO_INDETERMINADA");
  return result.meta.changes>0;
}
async function hasAdmin(db:D1Database):Promise<boolean> {
  const result = await db.prepare(
    "SELECT 1 AS presente FROM usuarios WHERE papel = 'admin' AND excluido_em IS NULL LIMIT 1"
  ).first();
  return result !== null;
}
async function createInactiveFirstAdmin(db:D1Database,input:BootstrapData):Promise<UserRow|null> {
  const id = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const passwordHash = await hashPassword(input.senha);
  const auditAfter = JSON.stringify({
    nome: input.nome,
    login: input.login,
    papel: "admin",
    ativo: false
  });
  const [insertResult,auditResult] = await db.batch([
    db.prepare(
      "INSERT INTO usuarios (id, loja_id, nome, login, senha_hash, papel, ativo, criado_em, atualizado_em) SELECT ?, NULL, ?, ?, ?, 'admin', 0, ?, ? WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE papel = 'admin' AND excluido_em IS NULL)"
    ).bind(id, input.nome, input.login, passwordHash, now, now),
    db.prepare(
      `INSERT INTO auditoria (
          id, usuario_id, acao, entidade, entidade_id, loja_id, agenda_id,
          agendamento_id, antes, depois, detalhes, criado_em
        )
        SELECT ?, NULL, 'admin_bootstrap_preparado', 'usuario', ?, NULL, NULL,
               NULL, NULL, ?, 'Primeiro administrador preparado.', ?
        WHERE EXISTS (
          SELECT 1
          FROM usuarios
          WHERE id = ?
            AND papel = 'admin'
            AND ativo = 0
            AND excluido_em IS NULL
        )`
    ).bind(auditId, id, auditAfter, now, id)
  ]);
  if(!insertResult?.success||!auditResult?.success||typeof insertResult.meta?.changes!=="number")throw new Error("USUARIO_GRAVACAO_INDETERMINADA");
  if (insertResult.meta.changes === 0) return null;
  return findUserById(db, id);
}
async function listUsers(db:D1Database):Promise<UserSummary[]> {
  const result = await db.prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM usuarios WHERE excluido_em IS NULL ORDER BY nome ASC`
  ).all<UserSummary>();
  if(!result.success||!result.results)throw new Error("USUARIOS_CONSULTA_FALHOU");
  return result.results;
}
async function createUser(db:D1Database,input:CreateUserData,actorUserId:string,access?:AccessChange,actorVersion?:number):Promise<UserRow> {
  if (input.papel === "conferente" && !input.lojaId) {
    throw new Error("LOJA_OBRIGATORIA");
  }
  const id = crypto.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const passwordHash = await hashPassword(input.senha);
  const lojaId = input.papel === "conferente" ? input.lojaId ?? null : null;
  const statements = [
    db.prepare(
      "INSERT INTO usuarios (id, loja_id, nome, login, senha_hash, papel, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      id,
      lojaId,
      input.nome,
      input.login,
      passwordHash,
      input.papel,
      access?0:1,
      now,
      now
    )
  ];
  if(access){
    // Atomicidade da criação e da autorização; não criar conta com papel legado se o acesso falhar.
    statements.unshift(db.prepare(`UPDATE usuarios SET session_version=CASE WHEN session_version=? AND papel='admin' AND ativo=1 AND excluido_em IS NULL AND NOT EXISTS (SELECT 1 FROM usuario_acesso WHERE usuario_id=?) THEN session_version ELSE NULL END WHERE id=?`).bind(actorVersion,actorUserId,actorUserId));
    statements.push(...accessInsertStatements(db,id,access));
  }
  statements.push(
    auditStatement(db, {
      userId: actorUserId,
      action: "usuario_criado",
      entity: "usuario",
      entityId: id,
      storeId: lojaId,
      after: {
        nome: input.nome,
        login: input.login,
        lojaId,
        papel: input.papel,
        ativo: true,
        senhaAlterada: true,
        ...(access?{acesso:access}:{})
      },
      details: "Usu\xE1rio criado.",
      createdAt: now
    })
  );
  const results=await db.batch(statements);
  if(results.length!==statements.length||results.some(result=>!result.success))throw new Error("USUARIO_GRAVACAO_INDETERMINADA");
  const created=await findUserById(db,id);
  if(!created)throw new Error("USUARIO_GRAVACAO_INDETERMINADA");
  return created;
}
async function updateUser(db:D1Database,current:UserRow,input:UpdateUserData,actorUserId:string,customActive?:boolean):Promise<UserRow> {
  const nome = input.nome ?? current.nome;
  const login = input.login ?? current.login;
  const papel = input.papel ?? current.papel;
  const oldActive=customActive??(current.ativo===1);
  const logicalActive=input.ativo===void 0?oldActive:input.ativo;
  const ativo=customActive===undefined?(logicalActive?1:0):0;
  const lojaId = papel === "conferente" ? input.lojaId ?? current.loja_id : null;
  if (papel === "conferente" && !lojaId) {
    throw new Error("LOJA_OBRIGATORIA");
  }
  const passwordHash = input.senha ? await hashPassword(input.senha) : current.senha_hash;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const statusChanged = logicalActive!==oldActive;
  // Mudanças de identidade ou permissão exigem uma nova autenticação.
  const identityChanged = login !== current.login || papel !== current.papel || lojaId !== current.loja_id;
  const sessionVersion = current.session_version + (input.senha || statusChanged || identityChanged ? 1 : 0);
  const accessAuditId=crypto.randomUUID();
  const statements = [
    db.prepare(
      "UPDATE usuarios SET loja_id = ?, nome = ?, login = ?, senha_hash = ?, papel = ?, ativo = ?, session_version = ?, atualizado_em = ? WHERE id = ? AND excluido_em IS NULL AND nome = ? AND login = ? AND senha_hash = ? AND papel = ? AND ativo = ? AND loja_id IS ? AND session_version = ?"
    ).bind(
      lojaId,
      nome,
      login,
      passwordHash,
      papel,
      ativo,
      sessionVersion,
      now,
      current.id,
      current.nome,
      current.login,
      current.senha_hash,
      current.papel,
      current.ativo,
      current.loja_id,
      current.session_version
    )
  ];
  statements.push(
    auditStatement(db, {
      userId: actorUserId,
      id:accessAuditId,
      action: "usuario_atualizado",
      onlyIfPreviousWrite: true,
      entity: "usuario",
      entityId: current.id,
      storeId: lojaId,
      before: {
        nome: current.nome,
        login: current.login,
        lojaId: current.loja_id,
        papel: current.papel,
        ativo: oldActive
      },
      after: {
        nome,
        login,
        lojaId,
        papel,
        ativo: logicalActive,
        senhaAlterada: Boolean(input.senha)
      },
      details: "Usu\xE1rio atualizado.",
      createdAt: now
    })
  );
  if(customActive!==undefined)statements.push(db.prepare("UPDATE usuario_acesso SET ativo=? WHERE usuario_id=? AND EXISTS (SELECT 1 FROM auditoria WHERE id=?)").bind(logicalActive?1:0,current.id,accessAuditId));
  const results=await db.batch(statements);
  const write=results[0];
  if(results.length!==statements.length||results.some(result=>!result.success))throw new Error("USUARIO_GRAVACAO_INDETERMINADA");
  if (write?.meta?.changes !== 1) {
    throw Object.assign(new Error("O usuário foi modificado por outra operação."), { code: "CONFLITO_ESTADO" });
  }
  const updated=await findUserById(db,current.id);
  if(!updated)throw new Error("USUARIO_GRAVACAO_INDETERMINADA");
  return updated;
}
async function softDeleteUser(db:D1Database,current:UserRow,actorUserId:string):Promise<boolean> {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const [result] = await db.batch([
    db.prepare(
      "UPDATE usuarios SET ativo = 0, excluido_em = ?, atualizado_em = ? WHERE id = ? AND excluido_em IS NULL"
    ).bind(now, now, current.id),
    auditStatement(db, {
      userId: actorUserId,
      action: "usuario_removido",
      onlyIfPreviousWrite: true,
      entity: "usuario",
      entityId: current.id,
      storeId: current.loja_id,
      before: {
        nome: current.nome,
        login: current.login,
        lojaId: current.loja_id,
        papel: current.papel,
        ativo: current.ativo === 1
      },
      after: {
        nome: current.nome,
        login: current.login,
        lojaId: current.loja_id,
        papel: current.papel,
        ativo: false,
        removido: true
      },
      details: "Usu\xE1rio removido logicamente.",
      createdAt: now
    })
  ]);
  if(!result?.success||typeof result.meta?.changes!=="number")throw new Error("USUARIO_GRAVACAO_INDETERMINADA");
  return result.meta.changes>0;
}
export {
  createInactiveFirstAdmin,
  createUser,
  findUserById,
  findUserForSession,
  findUserByLogin,
  revokeSession,
  pruneRevokedSessions,
  hasAdmin,
  listUsers,
  softDeleteUser,
  updateUser,
  upgradeUserPasswordHash
};