import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMockSql } from "../../scripts/mock-data.mjs";

function create(dir: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    for (const file of readdirSync(dir).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort())
      db.exec(readFileSync(join(dir, file), "utf8"));
    return db;
  } catch (error) { db.close(); throw error; }
}

test("V2 starts empty, preserves V1 tables/columns/constraints and supports the synthetic seed", async () => {
  const legacy = create("migrations");
  const v2 = create("migrations-v2");
  try {
    const objects = legacy.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','index','trigger')").all();
    for (const {name,type} of objects) {
      assert.ok(v2.prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type=?").get(name,type), String(name));
      if (type === "table") {
        const cols = (db: DatabaseSync) => db.prepare("SELECT name FROM pragma_table_info(?) ORDER BY name").all(name);
        assert.deepEqual(cols(v2), cols(legacy), String(name));
      }
    }
    assert.equal(v2.prepare("SELECT COUNT(*) AS n FROM usuarios").get()?.n, 0);
    v2.exec(await buildMockSql("senha-ficticia-longa-e-exclusiva", new Date("2026-11-27T15:00:00Z"), {access:true,v2:true}));
    assert.equal(v2.prepare("SELECT COUNT(*) AS n FROM agendamentos").get()?.n, 126);
    assert.equal(v2.prepare("SELECT COUNT(*) AS n FROM usuario_acesso WHERE perfil='digitador'").get()?.n, 1);
    assert.throws(() => v2.exec("UPDATE usuario_acesso SET perfil='agendador' WHERE perfil='digitador'"), /CHECK constraint/);
    assert.equal(v2.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
    assert.deepEqual(v2.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { legacy.close(); v2.close(); }
});

test("V2 protects external state, manual entries, CD and referential integrity", () => {
  const db = create("migrations-v2");
  try {
    db.exec(`
      INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('l','F01','Teste','t','t');
      INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('u','Admin','admin','hash','admin','t','t');
      INSERT INTO agendas(id,loja_id,data_agenda,arquivo_original,criado_por,criado_em,atualizado_em) VALUES('a','l','2026-11-27','sintetico','u','t','t'),('b','l','2026-11-28','sintetico','u','t','t');
      INSERT INTO agendamentos(id,agenda_id,protocolo,horario_inicio,horario_fim,fornecedor,origem,criado_em,atualizado_em) VALUES
        ('p','a','123456','08:00','09:00','Ficticio','importado','t','t'),
        ('q','b','123456','08:00','09:00','Ficticio','importado','t','t'),
        ('m','a','654321','08:00','09:00','Ficticio','manual','t','t');
    `);
    const h = "a".repeat(64);
    const sync = db.prepare("INSERT INTO sincronizacoes_nexello(id,usuario_id,data_inicio,data_fim,situacao,hash_conteudo,linhas_lidas,criado_em) VALUES('s','u','2026-11-27','2026-11-28','em_revisao',?,2,'t')");
    sync.run(h);
    const link = db.prepare("INSERT INTO agendamento_nexello(agendamento_id,sincronizacao_id,estado_externo,evidencia,observado_em,hash_conteudo) VALUES(?,'s',?,?,'t',?)");
    assert.throws(() => link.run("p","confirmado","relatorio_60",h), /CHECK constraint/);
    assert.throws(() => link.run("m","desconhecido","relatorio_60",h), /NEXELLO_VINCULO_MANUAL/);
    assert.throws(() => link.run("inexistente","desconhecido","relatorio_60",h), /FOREIGN KEY/);
    link.run("p","desconhecido","relatorio_60",h);
    assert.throws(() => db.exec("UPDATE agendamentos SET origem='manual' WHERE id='p'"), /NEXELLO_VINCULO_MANUAL/);
    assert.throws(() => db.exec("UPDATE agendamento_nexello SET agendamento_id='q' WHERE agendamento_id='p'"), /NEXELLO_VINCULO_IMUTAVEL/);
    assert.throws(() => db.exec("INSERT INTO nexello_destinos(filial_externa,loja_id,criado_por,criado_em) VALUES('CD','l','u','t')"), /CHECK constraint/);
    db.exec("INSERT INTO nexello_destinos(filial_externa,doca_externa,loja_id,criado_por,criado_em) VALUES('CD','01','l','u','t')");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agendamentos WHERE protocolo='123456'").get()?.n,2);
    assert.throws(() => db.exec("UPDATE usuarios SET ativo=0 WHERE id='u'"), /ULTIMO_ADMIN_ATIVO/);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});
