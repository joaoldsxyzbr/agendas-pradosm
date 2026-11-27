// Adaptador de desenvolvimento local. Nunca é importado pelo Worker publicado.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** @param {string} filename @param {string} migrationsDir @returns {{DB:D1Database,seed:(sql:string)=>void,close:()=>void}} */
export function openLocalDatabase(filename, migrationsDir) {
  const sqlite=new DatabaseSync(filename);
  try {
    sqlite.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    sqlite.exec("CREATE TABLE IF NOT EXISTS local_mock_migrations (name TEXT PRIMARY KEY)");
    for(const name of readdirSync(migrationsDir).filter(n=>/^\d{4}_[\w-]+\.sql$/.test(n)).sort()){
      if(sqlite.prepare("SELECT 1 FROM local_mock_migrations WHERE name=?").get(name))continue;
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        sqlite.exec(readFileSync(join(migrationsDir,name),"utf8"));
        sqlite.prepare("INSERT INTO local_mock_migrations(name) VALUES (?)").run(name);
        sqlite.exec("COMMIT");
      }catch(error){sqlite.exec("ROLLBACK");throw error;}
    }
    if(sqlite.prepare("PRAGMA foreign_key_check").all().length)throw Error("Integridade referencial local inválida.");
    /** @type {WeakMap<D1PreparedStatement, () => D1Result>} */
    const executions=new WeakMap();
    /** @param {unknown} value @returns {import("node:sqlite").SQLInputValue} */
    function sqliteValue(value) {
      if(value===null||typeof value==="string"||typeof value==="number"||typeof value==="bigint")return value;
      if(value instanceof ArrayBuffer)return value;
      if(ArrayBuffer.isView(value))return new Uint8Array(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
      throw new TypeError("Parâmetro SQLite incompatível.");
    }
    /** @param {string} sql @param {import("node:sqlite").SQLInputValue[]} [values=[]] */
    function prepare(sql,values=[]){
      // Prepare na execução, como D1; bind retorna um statement independente.
      function execute(){
        const stmt=sqlite.prepare(sql);
        if(stmt.columns().length){
          return {success:true,results:stmt.all(...values),meta:{changes:0}};
        }
        const result=stmt.run(...values);
        return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};
      }
      /** @type {D1PreparedStatement} */
      const statement={
        bind(...args){return prepare(sql,args.map(sqliteValue));},
        /** @template [T=Record<string, unknown>] @param {string} [columnName] @returns {Promise<T|null>} */
        async first(columnName){
          const row=sqlite.prepare(sql).get(...values);
          if(!row)return null;
          if(columnName===undefined)return row;
          if(!Object.hasOwn(row,columnName))throw new Error(`Coluna inexistente: ${columnName}`);
          return /** @type {T} */ (row[columnName]??null);
        },
        async all(){return execute();},
        async run(){return execute();},
        async raw(){const stmt=sqlite.prepare(sql);stmt.setReturnArrays(true);return stmt.all(...values);}
      };
      executions.set(statement,execute);
      return statement;
    }
    /** @type {D1Database} */
    const DB={
      prepare,
      async batch(statements){
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const results=statements.map(stmt=>{
            const execute=executions.get(stmt);
            if(!execute)throw Error("Statement não pertence ao banco local.");
            return execute();
          });
          sqlite.exec("COMMIT");
          return results;
        }catch(error){sqlite.exec("ROLLBACK");throw error;}
      }
    };
    return {DB,seed(sql){sqlite.exec("BEGIN IMMEDIATE");try{sqlite.exec(sql);sqlite.exec("COMMIT");}catch(error){sqlite.exec("ROLLBACK");throw error;}},close(){sqlite.close();}};
  }catch(error){sqlite.close();throw error;}
}
