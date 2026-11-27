import type { AppEnv } from "../env.ts";
import { scopedStoreIds } from "../middleware/enforce-access.ts";
import { Hono } from "hono";
import { z } from "zod";
import { LinkNexelloDestinationSchema } from "../../shared/nexello-destinations.ts";
import { listNexelloDestinations, linkSameCodeDestination } from "../repositories/nexello-destinations.ts";
import { CreateStoreInput, UpdateStoreInput } from "../../shared/api.ts";
import {
  type StoreRow,
  createStore,
  findStoreById,
  hasStoreUsers,
  listStores,
  softDeleteStore,
  updateStore
} from "../repositories/stores.ts";
const adminStoreRoutes = new Hono<AppEnv>();
function storeJson(store:StoreRow) {
  return {
    id: store.id,
    codigo: store.codigo,
    nome: store.nome,
    ativo: store.ativo === 1,
    temConferenteAtivo: store.tem_conferente_ativo === 1,
    criadoEm: store.criado_em,
    atualizadoEm: store.atualizado_em
  };
}
function isDuplicateCode(error:unknown) {
  return error instanceof Error && (error.message.includes("UNIQUE constraint failed: lojas.codigo") || error.message.includes("idx_lojas_codigo_nocase"));
}
adminStoreRoutes.get("/nexello-destinos", async c=>{
  const user=c.get("authUser"),version=c.get("sessionVersion");
  if(!user||user.papel!=="admin"||c.get("effectiveAccess")?.customized||version===undefined)
    return c.json({error:"ACESSO_NEGADO",message:"Configuração exclusiva do administrador integral."},403);
  c.header("Cache-Control","no-store");
  return c.json(await listNexelloDestinations(c.env.DB,{id:user.id,sessionVersion:version}));
});
adminStoreRoutes.post("/nexello-destinos",async c=>{
  const user=c.get("authUser"),version=c.get("sessionVersion");
  if(!user||user.papel!=="admin"||c.get("effectiveAccess")?.customized||version===undefined)
    return c.json({error:"ACESSO_NEGADO",message:"Configuração exclusiva do administrador integral."},403);
  const input=LinkNexelloDestinationSchema.safeParse(await c.req.json().catch(()=>null));
  if(!input.success)return c.json({error:"REQUISICAO_INVALIDA",message:"Loja inválida."},400);
  try{
    const result=await linkSameCodeDestination(c.env.DB,{id:user.id,sessionVersion:version},input.data.storeId);
    return c.json(result,result.created?201:200);
  }catch(error:unknown){
    if(error instanceof Error&&error.message==="NEXELLO_DESTINO_INVALIDO")
      return c.json({error:"NEXELLO_DESTINO_INVALIDO",message:"Apenas filiais ativas com código F podem ser vinculadas. O CD exige doca comprovada."},422);
    if(error instanceof Error&&(error.message==="NEXELLO_DESTINO_CONFLITO"||error.message.includes("UNIQUE constraint failed: nexello_destinos")))
      return c.json({error:"NEXELLO_DESTINO_CONFLITO",message:"Vínculo já existente ou alterado. Atualize a tela."},409);
    if(error instanceof Error&&error.message==="NEXELLO_AUTORIDADE_INVALIDA")
      return c.json({error:"ACESSO_NEGADO",message:"Autorização alterada."},403);
    throw error;
  }
});
adminStoreRoutes.get("/", async (c) => {
  const stores = await listStores(c.env.DB);
  const ids=scopedStoreIds(c);
  return c.json(stores.filter(store=>ids===undefined||ids.includes(store.id)).map(storeJson));
});
adminStoreRoutes.post("/", async (c) => {
  const parsed = CreateStoreInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "REQUISICAO_INVALIDA", message: "Dados inv\xE1lidos." }, 400);
  }
  try {
    const actor = c.get("authUser");
    if(!actor)return c.json({error:"ACESSO_NEGADO"},403);
    const store = await createStore(c.env.DB, parsed.data, actor.id);
    return c.json(storeJson(store), 201);
  } catch (error) {
    if(error instanceof Error&&error.message==="LOJA_CONFLITO_ESTADO")return c.json({error:"LOJA_CONFLITO_ESTADO",message:"A loja foi alterada por outra operação. Atualize a lista e tente novamente."},409);
    if(error instanceof Error&&error.message.includes("NEXELLO_LOJA_CODIGO_PROTEGIDO"))return c.json({error:"NEXELLO_LOJA_CODIGO_PROTEGIDO",message:"O código desta loja possui vínculo Nexello. A troca foi bloqueada para preservar a identidade da unidade."},409);
    if (isDuplicateCode(error)) {
      return c.json(
        { error: "CODIGO_LOJA_EM_USO", message: "C\xF3digo de loja j\xE1 est\xE1 em uso." },
        409
      );
    }
    throw error;
  }
});
adminStoreRoutes.patch("/", async (c) => {
  const parsed = UpdateStoreInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "REQUISICAO_INVALIDA", message: "Dados inv\xE1lidos." }, 400);
  }
  const current = await findStoreById(c.env.DB, parsed.data.id);
  if (!current) {
    return c.json({ error: "LOJA_NAO_ENCONTRADA", message: "Loja n\xE3o encontrada." }, 404);
  }
  try {
    const actor = c.get("authUser");
    if(!actor)return c.json({error:"ACESSO_NEGADO"},403);
    const store = await updateStore(c.env.DB, current, parsed.data, actor.id);
    return c.json(storeJson(store));
  } catch (error) {
    if(error instanceof Error&&error.message.includes("NEXELLO_LOJA_CODIGO_PROTEGIDO"))return c.json({error:"NEXELLO_LOJA_CODIGO_PROTEGIDO",message:"O código desta loja possui vínculo Nexello. A troca foi bloqueada para preservar a identidade da unidade."},409);
    if (isDuplicateCode(error)) {
      return c.json(
        { error: "CODIGO_LOJA_EM_USO", message: "C\xF3digo de loja j\xE1 est\xE1 em uso." },
        409
      );
    }
    throw error;
  }
});
adminStoreRoutes.delete("/:id", async (c) => {
  const parsedId = z.string().uuid().safeParse(c.req.param("id"));
  if (!parsedId.success) {
    return c.json(
      { error: "REQUISICAO_INVALIDA", message: "Loja inv\xE1lida." },
      400
    );
  }
  const current = await findStoreById(c.env.DB, parsedId.data);
  if (!current) {
    return c.json(
      { error: "LOJA_NAO_ENCONTRADA", message: "Loja n\xE3o encontrada." },
      404
    );
  }
  if (await hasStoreUsers(c.env.DB, current.id,c.env.ACCESS_MODE==="on")) {
    return c.json(
      {
        error: "LOJA_POSSUI_USUARIOS",
        message: "Mova ou exclua os usu\xE1rios vinculados antes de excluir a loja."
      },
      409
    );
  }
  const actor = c.get("authUser");
  if(!actor)return c.json({error:"ACESSO_NEGADO"},403);
  let deleted:boolean;
  try{deleted=await softDeleteStore(c.env.DB,current,actor.id);}
  catch(error:unknown){
    if(error instanceof Error&&error.message.includes("LOJA_POSSUI_USUARIOS"))return c.json({error:"LOJA_POSSUI_USUARIOS",message:"Há usuários vinculados à loja. Atualize a lista."},409);
    if(error instanceof Error&&error.message==="LOJA_CONFLITO_ESTADO")return c.json({error:"LOJA_CONFLITO_ESTADO",message:"A loja foi alterada por outra operação. Atualize a lista e tente novamente."},409);
    throw error;
  }
  if (!deleted) {
    return c.json(
      { error: "LOJA_NAO_ENCONTRADA", message: "Loja n\xE3o encontrada." },
      404
    );
  }
  return c.body(null, 204);
});
export {
  adminStoreRoutes
};