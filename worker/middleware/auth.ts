import type { AppEnv } from "../env.ts";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import {
  createSessionToken,
  sessionKey,
  SESSION_MAX_AGE,
  shouldRenewSession,
  verifySessionToken
} from "../lib/session.ts";
import { sessionIdentity } from "../services/access-session.ts";
import { findUserForSession } from "../repositories/users.ts";
const COOKIE_NAME = "agenda_session";
function unauthorized() {
  return {
    error: "NAO_AUTENTICADO",
    message: "Sess\xE3o inv\xE1lida ou expirada."
  };
}
function forbidden() {
  return {
    error: "ACESSO_NEGADO",
    message: "Acesso n\xE3o permitido."
  };
}
const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return c.json(unauthorized(), 401);
  const payload = await verifySessionToken(token, c.env.SESSION_SECRET);
  if (!payload) return c.json(unauthorized(), 401);
  const key = await sessionKey(token, payload);
  const user = await findUserForSession(c.env.DB, payload.userId, key);
  if (!user || user.session_version !== payload.sessionVersion || (user.ativo!==1&&c.env.ACCESS_MODE!=="on")) {
    return c.json(unauthorized(), 401);
  }
  const identity=await sessionIdentity(c.env,user,c.req.header("X-Agenda-Store"));
  if(!identity)return c.json(unauthorized(),401);
  const authUser=identity.user;
  if(identity.access)c.set("effectiveAccess",identity.access);
  c.set("sessionVersion",user.session_version);
  c.set("sessionKey",key);
  // Cookies legados não têm identidade estável para revogar a renovação.
  // Permanecem válidos até expirar, mas exigem novo login para renovação.
  if (payload.sessionId && shouldRenewSession(payload)) {
    const refreshedToken = await createSessionToken(
      user.id,
      user.session_version,
      c.env.SESSION_SECRET,
      Date.now(),
      payload.sessionId
    );
    setCookie(c, COOKIE_NAME, refreshedToken, {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === "https:",
      sameSite: "Strict",
      path: "/",
      maxAge: SESSION_MAX_AGE
    });
  }
  c.set("authUser", authUser);
  c.set("sessionExpiresAt", payload.exp);
  await next();
});
const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("authUser");
  if (!user) return c.json(unauthorized(), 401);
  if (c.get("effectiveAccess")?.customized) { await next(); return; }
  if (user.papel !== "admin" && user.papel !== "visualizador") {
    return c.json(forbidden(), 403);
  }
  await next();
});
const restrictDashboardViewer = createMiddleware<AppEnv>(
  async (c, next) => {
    const user = c.get("authUser");
    if (!user) return c.json(unauthorized(), 401);
    if (c.get("effectiveAccess")?.customized) { await next(); return; }
    if (user.papel !== "visualizador") {
      await next();
      return;
    }
    if (c.req.method !== "GET") {
      return c.json(forbidden(), 403);
    }
    const path = c.req.path;
    const allowed = path === "/api/admin/stores" || path === "/api/admin/agendas" || path === "/api/admin/presence" || path === "/api/admin/reports" || path === "/api/admin/reports/occurrences" || /^\/api\/admin\/agendas\/[^/]+$/.test(path) || /^\/api\/admin\/appointments\/[^/]+$/.test(path);
    if (!allowed) {
      return c.json(forbidden(), 403);
    }
    await next();
  }
);
export {
  requireAdmin,
  requireAuth,
  restrictDashboardViewer
};