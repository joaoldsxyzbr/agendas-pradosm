import type { AppEnv } from "../env.ts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { ACCESS_PROFILES, PERMISSIONS } from "../../shared/permissions.ts";
import { accessJson, findEffectiveAccess, listUsersWithAccess, saveAccessConfiguration, validChange, type AccessChange } from "../repositories/access.ts";
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
function integralAdmin(c:Context<AppEnv>){
  return c.env.ACCESS_MODE==="on"&&c.get("authUser")?.papel==="admin"&&!c.get("effectiveAccess")?.customized;
}
function accessError(c:Context<AppEnv>,error:unknown){
  if(error instanceof Error&&/ACESSO_|ULTIMO_ADMIN|LOJA_NAO_ENCONTRADA|DIGITADOR_PERMISSAO_RESTRITA|NOT NULL|FOREIGN KEY|UNIQUE constraint/.test(error.message))
    return c.json({error:"ACESSO_CONFLITO",message:"Configuração inválida, loja indisponível ou usuário alterado. Atualize e tente novamente."},409);
  throw error;
}
adminUserRoutes.get("/:id/access",async c=>{
  if(!integralAdmin(c))return c.json({error:"ACESSO_NEGADO"},403);
  const access=await findEffectiveAccess(c.env.DB,c.req.param("id"),true);
  return access?c.json(accessJson(access)):c.json({error:"USUARIO_NAO_ENCONTRADO"},404);
});
adminUserRoutes.put("/:id/access",async c=>{
  if(!integralAdmin(c))return c.json({error:"ACESSO_NEGADO"},403);
  const parsed=z.object({version:z.number().int().positive(),access:AccessInput}).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:"REQUISICAO_INVALIDA",message:"Configuração de acesso inválida."},400);
  const actor=c.get("authUser"),version=c.get("sessionVersion");
  if(!actor||version===undefined)return c.json({error:"ACESSO_NEGADO"},403);
  try{
    const result=await saveAccessConfiguration(c.env.DB,{id:actor.id,sessionVersion:version},c.req.param("id"),parsed.data.version,parsed.data.access);
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
function isDuplicateLogin(error:unknown) {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: usuarios.login");
}
function isLastAdmin(error:unknown) {
  return error instanceof Error && error.message.includes("ULTIMO_ADMIN_ATIVO");
}
async function validateStoreForRole(db:D1Database, papel:string, lojaId:string|null|undefined):Promise<{ok:true;lojaId:string|null}|{ok:false;reason:"required"|"missing"}> {
  if (papel !== "conferente") return { ok: true, lojaId: null };
  if (!lojaId) return { ok: false, reason: "required" };
  const store = await findStoreById(db, lojaId);
  if (!store) return { ok: false, reason: "missing" };
  return { ok: true, lojaId };
}
adminUserRoutes.get("/", async (c) => {
  if(c.env.ACCESS_MODE!=="on")return c.json((await listUsers(c.env.DB)).map(userJson));
  const rows=await listUsersWithAccess(c.env.DB);
  return c.json(rows.map(({user,access})=>({...userJson(user),...(access?{perfil:access.profile,acessoPersonalizado:access.customized,ativo:access.active,escopo:access.scope}:{ativo:false})})));
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
    if(!actor)return c.json({error:"ACESSO_NEGADO"},403);
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
    return c.json({...userJson(user),...(access?.success?{perfil:access.data.profile,acessoPersonalizado:true,ativo:true,escopo:access.data.scope}:{})}, 201);
  } catch (error) {
    if(error instanceof Error&&error.message.includes("LOJA_NAO_ENCONTRADA"))return c.json({error:"LOJA_NAO_ENCONTRADA",message:"A loja foi removida ou está indisponível. Atualize a lista e tente novamente."},409);
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
  const currentAccess=c.env.ACCESS_MODE==="on"?await findEffectiveAccess(c.env.DB,current.id,true):null;
  if(currentAccess?.customized && (parsed.data.papel!==undefined||parsed.data.lojaId!==undefined)){
    const access=currentAccess;
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
    if(!actor)return c.json({error:"ACESSO_NEGADO"},403);
    const user = await updateUser(
      c.env.DB,
      current,
      {
        ...parsed.data,
        papel,
        lojaId: storeCheck.lojaId ?? void 0
      },
      actor.id,
      currentAccess?.customized?currentAccess.active:undefined
    );
    // O versionamento da sessão é decidido no repositório (senha, status, login, papel, loja).
    if (user.session_version !== current.session_version) {
      await revokeRealtimeUser(c.env, current.id, "terminate");
    }
    const updatedAccess=currentAccess?.customized?await findEffectiveAccess(c.env.DB,user.id,true):null;
    return c.json({...userJson(user),...(updatedAccess?{perfil:updatedAccess.profile,acessoPersonalizado:true,ativo:updatedAccess.active,escopo:updatedAccess.scope}:{})});
  } catch (error) {
    if(error instanceof Error&&error.message.includes("LOJA_NAO_ENCONTRADA"))return c.json({error:"LOJA_NAO_ENCONTRADA",message:"A loja foi removida ou está indisponível. Atualize a lista e tente novamente."},409);
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
    if(!actor)return c.json({error:"ACESSO_NEGADO"},403);
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