// Estado local separado do OneDrive no Windows. Cada checkout tem seu próprio D1.
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
export function mockStatePath(root, platform=process.platform, localAppData=process.env.LOCALAPPDATA) {
  if (platform !== "win32") return join(root,".wrangler","mock-state");
  const key=createHash("sha256").update(resolve(root).toLowerCase()).digest("hex").slice(0,20);
  return join(localAppData || join(homedir(),"AppData","Local"),"AgendasPradoMock",key);
}
