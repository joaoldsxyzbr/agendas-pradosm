import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../migrations/", import.meta.url));
const name = "0026_usuario_acesso.sql";
const now = "2026-11-24T12:00:00.000Z";

function fixture() {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    for (const file of readdirSync(dir).filter(file => /^\d{4}_.*\.sql$/.test(file) && file < name).sort()) {
      db.exec(readFileSync(join(dir, file), "utf8"));
    }
    const store = db.prepare("INSERT INTO lojas (id,codigo,nome,criado_em,atualizado_em) VALUES (?,?,?,?,?)");
    store.run("s1","T01","Loja sintética 1",now,now);
    store.run("s2","T02","Loja sintética 2",now,now);
    const user = db.prepare("INSERT INTO usuarios (id,loja_id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?)");
    user.run("a",null,"Admin","admin-teste","hash-sintetico","admin",now,now);
    user.run("v",null,"Viewer","viewer-teste","hash-sintetico","visualizador",now,now);
    user.run("c","s1","Conferente","conf-teste","hash-sintetico","conferente",now,now);
    db.prepare("INSERT INTO agendas (id,loja_id,data_agenda,arquivo_original,criado_por,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?)").run("g","s1","2026-11-24","teste.csv","a",now,now);
    db.prepare("INSERT INTO agendamentos (id,agenda_id,protocolo,horario_inicio,horario_fim,fornecedor,status,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)").run("p","g","P1","08:00","09:00","Fornecedor teste","recebido",now,now);
    db.prepare("INSERT INTO historico_status (id,agendamento_id,usuario_id,status_anterior,status_novo,alterado_em) VALUES (?,?,?,?,?,?)").run("h","p","c","aguardando","recebido",now);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

test("0026 é aditiva: preserva dados, papéis, sessões e histórico existentes", () => {
  const db = fixture();
  try {
    const tables = ["usuarios", "lojas", "agendas", "agendamentos", "historico_status", "auditoria", "sessoes_revogadas"];
    const before = tables.map(table => db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all());
    db.exec(readFileSync(join(dir, name), "utf8"));
    const after = tables.map(table => db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all());
    assert.deepEqual(after, before);
    for (const table of ["usuario_acesso", "usuario_acesso_lojas", "usuario_acesso_excecoes"]) {
      assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM " + table).get()?.n ?? 0), 0);
    }
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.throws(() => db.exec("UPDATE usuarios SET ativo=0 WHERE id='a'"), /ULTIMO_ADMIN_ATIVO/);
  } finally {
    db.close();
  }
});

test("0026 restringe perfil, escopo, vínculos e exceções sem tocar no papel legado", () => {
  const db = fixture();
  try {
    db.exec(readFileSync(join(dir, name), "utf8"));
    const access = db.prepare("INSERT INTO usuario_acesso (usuario_id,perfil,escopo) VALUES (?,?,?)");
    const link = db.prepare("INSERT INTO usuario_acesso_lojas (usuario_id,loja_id) VALUES (?,?)");
    const exception = db.prepare("INSERT INTO usuario_acesso_excecoes (usuario_id,permissao,efeito) VALUES (?,?,?)");
    assert.throws(() => access.run("v","desconhecido","todas"));
    assert.throws(() => access.run("v","agendador","desconhecido"));
    assert.throws(() => access.run("nao-existe","agendador","todas"));
    access.run("v","agendador","vinculadas");
    access.run("a","admin","todas");
    link.run("v","s1");
    link.run("v","s2");
    assert.throws(() => link.run("v","s1"));
    assert.throws(() => link.run("v","nao-existe"));
    assert.throws(() => link.run("a","s1"));
    assert.throws(() => link.run("c","s1"));
    exception.run("v","agendas.editar","deny");
    exception.run("v","recebimento.reabrir","allow");
    assert.throws(() => exception.run("v","agendas.editar","allow"));
    assert.throws(() => exception.run("v","relatorios.ver","invalido"));
    assert.throws(() => exception.run("v"," ","allow"));
    assert.throws(() => exception.run("c","relatorios.ver","allow"));
    assert.equal(db.prepare("SELECT papel FROM usuarios WHERE id='v'").get()?.papel, "visualizador");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    db.close();
  }
});
