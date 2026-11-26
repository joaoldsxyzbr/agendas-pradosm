import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractPdfText, PdfExtractionError } from "../../shared/import/extractPdfText.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("Contrato de extração de texto PDF", () => {
  it("delega a extração de bytes ao motor PDF injetado", async () => {
    const file = new File(["conteudo-do-pdf"], "fixture.pdf");
    const received: Uint8Array[] = [];
    const engine = {
      async extractPdfTextFromBytes(bytes: Uint8Array) {
        received.push(bytes);
        return "TEXTO\tNORMALIZADO";
      }
    };
    const text = await extractPdfText(file, engine);
    assert.equal(text, "TEXTO\tNORMALIZADO");
    assert.equal(received.length, 1);
    assert.ok(received[0] instanceof Uint8Array);
    assert.equal(Buffer.from(received[0]).toString("utf8"), "conteudo-do-pdf");
  });

  it("mapeia qualquer falha do motor para PdfExtractionError com código PDF_INVALIDO", async () => {
    const file = new File(["x"], "fixture.pdf");
    const engine = {
      async extractPdfTextFromBytes() {
        throw new Error("wasm quebrou");
      }
    };
    await assert.rejects(
      () => extractPdfText(file, engine),
      (error) => {
        assert.ok(error instanceof PdfExtractionError);
        assert.equal(error.code, "PDF_INVALIDO");
        assert.equal(error.name, "PdfExtractionError");
        return true;
      }
    );
  });

  it("isola a dependência WASM no módulo de motor", () => {
    const facade = read("../../shared/import/extractPdfText.ts");
    const engine = read("../../shared/import/pdf-engine-liteparse.ts");
    assert.doesNotMatch(facade, /@llamaindex/);
    assert.match(facade, /import\("\.\/pdf-engine-liteparse\.ts"\)/);
    assert.ok(engine.includes('from "@llamaindex/liteparse-wasm"'));
    assert.ok(engine.includes("extractPdfTextFromBytes"));
  });
});
