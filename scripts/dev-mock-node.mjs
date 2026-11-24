// Servidor exclusivamente local usando as rotas Hono reais e SQLite nativo do Node.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "../worker/app.ts";
import { openLocalDatabase } from "./local-sqlite.mjs";
import { mockStatePath } from "./mock-state.mjs";
import { buildMockSql, MOCK_ACCOUNTS, mockImportCsv } from "./mock-data.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const state=join(mockStatePath(root),"node");
const base="http://127.0.0.1:8787";
const args=process.argv.slice(2);
if(args.length>1||args.some(a=>!["--open-browser","--seed-only"].includes(a)))throw Error("Argumento local inválido.");
mkdirSync(state,{recursive:true});
const credentials=join(state,"credentials.json");
try{
  writeFileSync(credentials,JSON.stringify({password:randomBytes(18).toString("base64url"),sessionSecret:randomBytes(48).toString("hex")}),{flag:"wx",mode:0o600});
}catch(error){if(error?.code!=="EEXIST")throw error;}
const {password,sessionSecret}=JSON.parse(readFileSync(credentials,"utf8"));
if(typeof password!=="string"||!/^[A-Za-z0-9_-]{24}$/.test(password)||typeof sessionSecret!=="string"||!/^[a-f0-9]{96}$/.test(sessionSecret))throw Error("Credenciais locais inválidas.");
console.log("Modo Node "+process.version+" | SQLite local (sem Wrangler/Workerd)");
const local=openLocalDatabase(join(state,"mock.sqlite"),join(root,"migrations"));
local.seed(await buildMockSql(password));
writeFileSync(join(state,"importacao-mock.csv"),mockImportCsv(),"utf8");
console.log("Estado local: "+state);
for(const user of MOCK_ACCOUNTS)console.log(user.login+" - "+user.name);
console.log("Senha inicial comum: "+password);
if(args.includes("--seed-only")){local.close();}
else{
  const files=new Map();
  const types={html:"text/html; charset=utf-8",js:"text/javascript; charset=utf-8",css:"text/css; charset=utf-8",wasm:"application/wasm",svg:"image/svg+xml",png:"image/png",json:"application/json",ico:"image/x-icon",woff2:"font/woff2",webp:"image/webp"};
  // Arquivos lidos exclusivamente do build, nunca de caminhos vindos da URL.
  function load(dir,prefix=""){
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      const name=prefix+"/"+entry.name;
      const path=join(dir,entry.name);
      if(entry.isDirectory())load(path,name);
      else if(entry.isFile()&&!entry.name.startsWith("_")){
        files.set(name,{data:readFileSync(path),type:types[entry.name.split(".").pop()]??"application/octet-stream"});
      }
    }
  }
  load(join(root,"dist"));
  if(!files.has("/index.html"))throw Error("Build local ausente.");
  const limits=new Map();
  const env={DB:local.DB,SESSION_SECRET:sessionSecret,REALTIME_MODE:"off",
    LOGIN_RATE_LIMITER:{async limit({key}){
      const now=Date.now();let record=limits.get(key);
      if(!record||record.until<=now){record={until:now+60000,count:0};limits.set(key,record);}
      record.count++;
      if(limits.size>1000)for(const [k,v] of limits)if(v.until<=now)limits.delete(k);
      return {success:record.count<=10};
    }},
    REALTIME_HUB:{idFromName(){return "local";},get(){return {fetch:async()=>new Response("Realtime desativado no modo local",{status:503})};}}
  };
  function staticResponse(path){
    const asset=files.get(path)||(path.startsWith("/assets/")?null:files.get("/index.html"));
    if(!asset)return new Response("Not found",{status:404});
    return new Response(asset.data,{headers:{"Content-Type":asset.type,"X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:"}});
  }
  const server=createServer(async(req,res)=>{
    try{
      if(req.headers.host!=="127.0.0.1:8787"){res.writeHead(403).end();return;}
      if(!req.url?.startsWith("/")||req.url.startsWith("//")){res.writeHead(400).end();return;}
      const url=new URL(base+req.url);
      const headers=new Headers();
      for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(", "):value);
      const method=req.method??"GET";
      let response;
      if(url.pathname.startsWith("/api/")){
        const chunks=[];let size=0;
        for await(const chunk of req){
          size+=chunk.length;
          if(size>2*1024*1024){res.writeHead(413).end();return;}
          chunks.push(chunk);
        }
        const body=method==="GET"||method==="HEAD"?undefined:Buffer.concat(chunks);
        response=await app.fetch(new Request(url,{method,headers,body}),env);
      }else if(method==="GET"||method==="HEAD"){response=staticResponse(url.pathname);}
      else{response=new Response("Method not allowed",{status:405});}
      for(const [key,value] of response.headers)if(key!=="set-cookie")res.setHeader(key,value);
      const cookies=response.headers.getSetCookie();
      if(cookies.length)res.setHeader("Set-Cookie",cookies);
      res.statusCode=response.status;
      res.end(method==="HEAD"?undefined:Buffer.from(await response.arrayBuffer()));
    }catch(error){console.error("Erro local:",error?.name??"Error");if(!res.headersSent)res.writeHead(500);res.end();}
  });
  server.once("error",error=>{console.error("Servidor local:",error.message);local.close();process.exitCode=1;});
  server.listen(8787,"127.0.0.1",()=>{
    console.log("Abra "+base);
    if(args.includes("--open-browser")&&process.platform==="win32"){
      const browser=spawn("explorer.exe",[base],{stdio:"ignore",windowsHide:true,detached:true});
      browser.once("error",()=>console.log("Abra "+base+" manualmente."));
      browser.unref();
    }
  });
  function stop(){server.close(()=>local.close());server.closeAllConnections();}
  process.once("SIGINT",stop);
  process.once("SIGTERM",stop);
}
