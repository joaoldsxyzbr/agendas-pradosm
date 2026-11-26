declare module "@llamaindex/liteparse-wasm" {
  export default function initLiteParse(): unknown;
  export class LiteParse {
    constructor(options?: Record<string, unknown>);
    parse(bytes: Uint8Array): Promise<unknown>;
  }
}
