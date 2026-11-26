import { verifyPassword } from "../worker/lib/password.ts";
import { z } from "zod";
const fixture = z.object({ password: z.string(), encoded: z.string() });

// Isolado do Worker de negocio. Executado SOMENTE com wrangler dev --local
// e --ip 127.0.0.1. Nenhuma rota de benchmark e publicada na producao.
export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ready: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method !== "POST" || url.pathname !== "/verify") {
      return new Response(null, { status: 404 });
    }
    const parsed = fixture.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "Invalid synthetic fixture" }, { status: 400 });
    }
    const valid = await verifyPassword(parsed.data.password, parsed.data.encoded);
    return Response.json({ valid }, { headers: { "Cache-Control": "no-store" } });
  }
};
