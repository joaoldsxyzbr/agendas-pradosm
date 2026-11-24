import type { AppEnv } from "../env.ts";
import { Hono } from "hono";
import { z } from "zod";
import { ACCESS_PROFILES, PERMISSIONS } from "../../shared/permissions.ts";
import { accessJson, findEffectiveAccess, saveAccessConfiguration, validChange, type AccessChange } from "../repositories/access.ts";
import { CreateUserInput, UpdateUserInput } from "../../shared/api.ts";
import { revokeRealtimeUser } from "../services/realtime.ts";
import { findStoreById } from "../repositories/stores.ts";
import {
  createUser,
  findUserById,
  listUsers,
  softDeleteUser,
  updateUser
} from "../repositories/users.ts";
const adminUserRoutes = new Hono<AppEnv>();
const AccessInput=z.object({
  profile:z.enum(ACCESS_PROFILES),
  scope:z.discriminatedUnion("mode",[z.object({mode:z.literal("all")}).strict(),z.object({mode:z.literal("assigned"),storeIds:z.array(z.string().uuid()).max(50)}).strict()]),
  overrides:z.array(z.object({permission:z.enum(PERMISSIONS),effect:z.enum(["allow","deny"])})).max(PERMISSIONS.length)
}).transform(value=>value as AccessChange).refine(validChange);
function integralAdmin(c){
  return c.env.ACCESS_MODE==="on"&&c.get("authUser")?.papel==="admin"&&!c.get("effectiveAccess")?.customized;
}
function accessError(c,error){
  if(error instanceof Error&&/ACESSO_|ULTIMO_ADMIN|NOT NULL|FOREIGN KEY|UNIQUE constraint/.test(error.message))
    return c.json({error:"ACESSO_CONFLITO",message:"Configuração inválida, loja indisponível ou usuário alterado. Atualize e tente novamente."},409);
  throw error;
}
adminUserRoutes.get("/:id/access",async c=>{
  if(!integralAdmin(c))return c.json({error:"ACESSO_NEGADO"},403);
  const access=await findEffectiveAccess(c.env.DB,c.req.param("id"));
  return access?c.json(accessJson(access)):c.json({error:"USUARIO_NAO_ENCONTRADO"},404);
});
adminUserRoutes.put("/:id/access",async c=>{
  if(!integralAdmin(c))return c.json({error:"ACESSO_NEGADO"},403);
  const parsed=z.object({version:z.number().int().positive(),access:AccessInput}).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:"REQUISICAO_INVALIDA",message:"Configuração de acesso inválida."},400);
  const actor=c.get("authUser");
  try{
    const result=await saveAccessConfiguration(c.env.DB,{id:actor.id,sessionVersion:c.get("sessionVersion")},c.req.param("id"),parsed.data.version,parsed.data.access);
    await revokeRealtimeUser(c.env,c.req.param("id"),"terminate");
    return c.json(accessJson(result));
  }catch(error){return accessError(c,error);}
});
function userJson(user) {
  return {
    id: user.id,
    nome: user.nome,
    login: user.login,
    papel: user.papel,
    lojaId: user.loja_id,
    ativo: user.ativo === 1
  };
}
function isDuplicateLogin(error) {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: usuarios.login");
}
function isLastAdmin(error) {
  return error instanceof Error && error.message.includes("ULTIMO_ADMIN_ATIVO");
}
async function validateStoreForRole(db, papel, lojaId) {
  if (papel !== "conferente") return { ok: true, lojaId: null };
  if (!lojaId) return { ok: false, reason: "required" };
  const store = await findStoreById(db, lojaId);
  if (!store) return { ok: false, reason: "missing" };
  return { ok: true, lojaId };
}
adminUserRoutes.get("/", async (c) => {
  const users = await listUsers(c.env.DB);
  if(c.env.ACCESS_MODE!=="on")return c.json(users.map(userJson));
  return c.json(await Promise.all(users.map(async user=>{const access=await findEffectiveAccess(c.env.DB,user.id);return {...userJson(user),...(access?{perfil:access.profile,acessoPersonalizado:access.customized}:{} )};})));
});
adminUserRoutes.post("/", async (c) => {
  const body=await c.req.json().catch(()=>null);
  const custom=body&&typeof body==="object"&&Object.hasOwn(body,"access");
  const access=custom?AccessInput.safeParse(body.access):null;
  if(custom&&(!integralAdmin(c)||!access?.success))return c.json({error:"REQUISICAO_INVALIDA",message:"Configuração de acesso inválida."},400);
  // Perfil efetivo separado do papel físico legado.
  const parsed=CreateUserInput.safeParse(custom?{...body,papel:"visualizador"}:body);
  if (!parsed.success) {
    return c.json(
      { error: "REQUISICAO_INVALIDA", message: "Dados inv\xE1lidos." },
      400
    );
  }
  const storeCheck = await validateStoreForRole(
    c.env.DB,
    parsed.data.papel,
    parsed.data.lojaId
  );
  if (!storeCheck.ok) {
    return c.json(
      {
        error: storeCheck.reason === "missing" ? "LOJA_NAO_ENCONTRADA" : "LOJA_OBRIGATORIA",
        message: storeCheck.reason === "missing" ? "Loja n\xE3o encontrada." : "Loja \xE9 obrigat\xF3ria para conferente."
      },
      400
    );
  }
  try {
    const actor = c.get("authUser");
    const user = await createUser(
      c.env.DB,
      {
        ...parsed.data,
        lojaId: storeCheck.lojaId ?? void 0
      },
      actor.id,
      access?.success?access.data:undefined,
      c.get("sessionVersion")
    );
    return c.json({...userJson(user),...(access?.success?{perfil:access.data.profile,acessoPersonalizado:true}:{})}, 201);
  } catch (error) {
    if (isDuplicateLogin(error)) {
      return c.json(
        { error: "LOGIN_EM_USO", message: "Login j\xE1 est\xE1 em uso." },
        409
      );
    }
    if(custom)return accessError(c,error);
    throw error;
  }
});
adminUserRoutes.patch("/", async (c) => {
  const parsed = UpdateUserInput.safeParse(
    await c.req.json().catch(() => null)
  );
  if (!parsed.success) {
    return c.json(
      { error: "REQUISICAO_INVALIDA", message: "Dados inv\xE1lidos." },
      400
    );
  }
  const current = await findUserById(c.env.DB, parsed.data.id);
  if (!current) {
    return c.json(
      { error: "USUARIO_NAO_ENCONTRADO", message: "Usu\xE1rio n\xE3o encontrado." },
      404
    );
  }
  if(c.env.ACCESS_MODE==="on" && (parsed.data.papel!==undefined||parsed.data.lojaId!==undefined)){
    const access=await findEffectiveAccess(c.env.DB,current.id);
    if(access?.customized&&(parsed.data.papel!==current.papel||parsed.data.lojaId!==undefined))
      return c.json({error:"ACESSO_CONFIGURADO",message:"Altere perfil e lojas na configuração de acesso."},409);
  }
  const papel = parsed.data.papel ?? current.papel;
  const requestedStore = papel === "conferente" ? parsed.data.lojaId ?? current.loja_id : null;
  const storeCheck = await validateStoreForRole(
    c.env.DB,
    papel,
    requestedStore
  );
  if (!storeCheck.ok) {
    return c.json(
      {
        error: storeCheck.reason === "missing" ? "LOJA_NAO_ENCONTRADA" : "LOJA_OBRIGATORIA",
        message: storeCheck.reason === "missing" ? "Loja n\xE3o encontrada." : "Loja \xE9 obrigat\xF3ria para conferente."
      },
      400
    );
  }
  try {
    const actor = c.get("authUser");
    const user = await updateUser(
      c.env.DB,
      current,
      {
        ...parsed.data,
        papel,
        lojaId: storeCheck.lojaId ?? void 0
      },
      actor.id
    );
    // O versionamento da sessão é decidido no repositório (senha, status, login, papel, loja).
    if (user.session_version !== current.session_version) {
      await revokeRealtimeUser(c.env, current.id, "terminate");
    }
    return c.json(userJson(user));
  } catch (error) {
    if (isDuplicateLogin(error)) {
      return c.json(
        { error: "LOGIN_EM_USO", message: "Login j\xE1 est\xE1 em uso." },
        409
      );
    }
    if (error instanceof Error && "code" in error && error.code === "CONFLITO_ESTADO") {
      return c.json({ error: "CONFLITO_ESTADO", message: "Este usuário foi alterado. Atualize a lista e tente novamente." }, 409);
    }
    if (isLastAdmin(error)) {
      return c.json(
        {
          error: "ULTIMO_ADMIN_ATIVO",
          message: "\xC9 necess\xE1rio manter pelo menos um administrador ativo."
        },
        409
      );
    }
    throw error;
  }
});
adminUserRoutes.delete("/:id", async (c) => {
  const parsedId = z.string().uuid().safeParse(c.req.param("id"));
  if (!parsedId.success) {
    return c.json(
      { error: "REQUISICAO_INVALIDA", message: "Usu\xE1rio inv\xE1lido." },
      400
    );
  }
  const current = await findUserById(c.env.DB, parsedId.data);
  if (!current) {
    return c.json(
      { error: "USUARIO_NAO_ENCONTRADO", message: "Usu\xE1rio n\xE3o encontrado." },
      404
    );
  }
  try {
    const actor = c.get("authUser");
    const deleted = await softDeleteUser(c.env.DB, current, actor.id);
    if (deleted) {
      await revokeRealtimeUser(c.env, current.id);
    }
    if (!deleted) {
      return c.json(
        { error: "USUARIO_NAO_ENCONTRADO", message: "Usu\xE1rio n\xE3o encontrado." },
        404
      );
    }
  } catch (error) {
    if (isLastAdmin(error)) {
      return c.json(
        {
          error: "ULTIMO_ADMIN_ATIVO",
          message: "\xC9 necess\xE1rio manter pelo menos um administrador ativo."
        },
        409
      );
    }
    throw error;
  }
  return c.body(null, 204);
});
export {
  adminUserRoutes
};