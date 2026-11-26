import { performance } from "node:perf_hooks";
import { PASSWORD_HASH_ITERATIONS, verifyPassword } from "../worker/lib/password.ts";

// Benchmark local e opcional; números NÃO equivalem à latência/custo de CPU nos Workers.
const password = "SenhaSinteticaApenasBenchmark2026";
const salt = new Uint8Array(16).fill(41);
const key = await crypto.subtle.importKey(
  "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
);
// Decisão de operação: gerar/verificar somente 100 mil iterações nas medições regulares.
if (PASSWORD_HASH_ITERATIONS !== 100_000) throw Error("Política PBKDF2 não autorizada a mudar");
for (const iterations of [PASSWORD_HASH_ITERATIONS]) {
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256
  );
  const encoded = `pbkdf2_sha256$${iterations}$${Buffer.from(salt).toString("base64")}$${Buffer.from(bits).toString("base64")}`;
  const measured = [];
  for (let run = 0; run < 10; run++) {
    const started = performance.now();
    if (!await verifyPassword(password, encoded)) throw Error("Falha no fixture do benchmark");
    measured.push(performance.now() - started);
  }
  const averageMs = measured.reduce((a, b) => a + b, 0) / measured.length;
  console.log(`PBKDF2-SHA256 ${iterations} iterações: média local de ${averageMs.toFixed(1)} ms (10 execuções)`);
}
console.log("PBKDF2 fixado em 100.000 iterações por decisão operacional; não aumentar automaticamente.");