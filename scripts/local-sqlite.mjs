// Adaptador de desenvolvimento local. Nunca é importado pelo Worker publicado.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
    const executions=new WeakMap();
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
      const statement={
        bind(...args){return prepare(sql,args);},
        async first(column){const row=sqlite.prepare(sql).get(...values);return row?(column===undefined?row:row[column]??null):null;},
        async all(){return execute();},
        async run(){return execute();},
        async raw(options={}){const stmt=sqlite.prepare(sql);const cols=stmt.columns().map(c=>c.name);stmt.setReturnArrays(true);const rows=stmt.all(...values);return options.columnNames?[cols,...rows]:rows;}
      };
      executions.set(statement,execute);
      return statement;
    }
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
