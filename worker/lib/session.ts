import { z } from "zod";

const sessionPayloadSchema = z.object({
  userId: z.string(),
  sessionVersion: z.number().int().min(1),
  sessionId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).optional(),
  exp: z.number().int(),
});
export type SessionPayload = Omit<z.infer<typeof sessionPayloadSchema>, "sessionId"> & { sessionId: string | null };

const SESSION_SECONDS = 30 * 24 * 60 * 60;
const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;
function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
function fromBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function hmac(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  );
}
function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}
async function createSessionToken(userId: string, sessionVersion: number, secret: string, nowMs = Date.now(), sessionId: string = crypto.randomUUID()): Promise<string> {
  const payload = {
    userId,
    sessionVersion,
    sessionId,
    exp: Math.floor(nowMs / 1e3) + SESSION_SECONDS
  };
  const encodedPayload = toBase64Url(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const signature = await hmac(secret, encodedPayload);
  return `${encodedPayload}.${toBase64Url(signature)}`;
}
async function verifySessionToken(token: string, secret: string, nowMs = Date.now()): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) return null;
  try {
    const expected = await hmac(secret, encodedPayload);
    const actual = fromBase64Url(encodedSignature);
    // Exige a representação canônica emitida pelo servidor. Cookies legados
    // são revogados pelo hash do token exato, portanto padding/aliases não
    // podem criar outra representação válida da mesma assinatura.
    if (toBase64Url(actual) !== encodedSignature || !constantTimeEqual(actual, expected)) return null;
    const decoded: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
    const parsed = sessionPayloadSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.exp <= Math.floor(nowMs / 1e3)) return null;
    const payload = parsed.data;
    return {
      userId: payload.userId,
      sessionVersion: payload.sessionVersion,
      sessionId: payload.sessionId ?? null,
      exp: payload.exp
    };
  } catch {
    return null;
  }
}
// Tokens anteriores à versão de sessionId ainda podem autenticar durante a
// transição. Para eles, o logout revoga o token exato sem armazenar seu valor.
async function sessionKey(token: string, payload: SessionPayload): Promise<string> {
  if (payload.sessionId) return "sid:" + payload.sessionId;
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return "legacy:" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
function shouldRenewSession(payload: SessionPayload, nowMs = Date.now()): boolean {
  const nowSeconds = Math.floor(nowMs / 1e3);
  const remainingSeconds = payload.exp - nowSeconds;
  return remainingSeconds > 0 && remainingSeconds <= SESSION_SECONDS - SESSION_RENEW_AFTER_SECONDS;
}
const SESSION_MAX_AGE = SESSION_SECONDS;
export {
  SESSION_MAX_AGE,
  createSessionToken,
  sessionKey,
  shouldRenewSession,
  verifySessionToken
};