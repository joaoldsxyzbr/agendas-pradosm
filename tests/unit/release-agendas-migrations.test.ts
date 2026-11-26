import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Somente SQLite em memória: nunca consulta ou escreve no D1 de produção.
describe("Release candidata: migrations sobre schema de produção", () => {
  it("aplica a sequência 0001–0025 mais 0029–0030 sem remover campos operacionais", () => {
    const files = readdirSync("migrations")
      .filter(name => /^\d{4}_[\w-]+\.sql$/.test(name))
      .sort();
    // 0026–0028 são reservadas ao #248 na preview: chegam à main depois,
    // sem colisão em d1_migrations (que registra por nome de arquivo).
    const expected = Array.from({ length: 25 }, (_, i) => String(i + 1).padStart(4, "0"));
    expected.push("0029", "0030");
    assert.deepEqual(files.map(name => name.slice(0, 4)), expected,
      "A candidata deve conter migrations 0001–0025 e 0029–0030 (0026–0028 reservadas à #248)");

    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      for (const file of files) {
        const sql = readFileSync(join("migrations", file), "utf8");
        assert.doesNotThrow(() => db.exec(sql), "Migration inválida: " + file);
      }
      const names = (table: string) => db.prepare("PRAGMA table_info(" + table + ")").all().map(r => r.name);
      const agenda = names("agendas");
      const appointments = names("agendamentos");
      const checks = names("agenda_digitacao_fornecedor");
      assert.ok(agenda.includes("status_dia"), "Status operacional da agenda ausente");
      assert.ok(appointments.includes("status"), "Status do agendamento ausente");
      assert.ok(appointments.includes("pedidos") && appointments.includes("nfe"));
      assert.ok(agenda.includes("digitado_em") && agenda.includes("digitado_por"));
      assert.ok(agenda.includes("versao_importacao"), "Versão de importação ausente");
      assert.deepEqual(names("sessoes_revogadas"), ["session_key", "expira_em"]);
      const agendaSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'agendas'").get()?.sql;
      assert.ok(typeof agendaSql === "string");
      assert.match(agendaSql, /ck_agenda_versao_importacao/);
      assert.ok(appointments.includes("csv_campos"));
      for (const field of ["agenda_id", "fornecedor_chave", "fornecedor_nome", "dados_hash", "digitado_em", "digitado_por"])
        assert.ok(checks.includes(field), "Coluna de digitação ausente: " + field);
      const fks = db.prepare("PRAGMA foreign_key_list(agenda_digitacao_fornecedor)").all().map(row => row.table);
      assert.ok(fks.includes("agendas") && fks.includes("usuarios"));
      // Migration 0022: avisos in-app com leitura por usuário.
      const avisos = names("avisos");
      const avisosLidos = names("avisos_lidos");
      for (const field of ["id", "tipo", "titulo", "mensagem", "criado_por", "criado_em", "expira_em", "inativo_em", "urgente", "autor"])
        assert.ok(avisos.includes(field), "Coluna de aviso ausente: " + field);
      for (const field of ["aviso_id", "usuario_id", "lido_em"])
        assert.ok(avisosLidos.includes(field), "Coluna de leitura ausente: " + field);
      const lidoPk = db.prepare("PRAGMA table_info(avisos_lidos)").all().filter(row => Number(row.pk) > 0);
      assert.deepEqual(lidoPk.map(row => row.name).sort(), ["aviso_id", "usuario_id"],
        "A leitura de aviso deve ter PK composta por aviso e usuário");
      // Migration 0023: urgência, autor e direcionamento por loja.
      const urgente = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'avisos'").get();
      assert.ok(urgente && typeof urgente.sql === "string");
      assert.match(urgente.sql, /urgente INTEGER NOT NULL DEFAULT 0 CHECK \(urgente IN \(0, 1\)\)/);
      assert.match(urgente.sql, /autor TEXT NOT NULL DEFAULT 'Sistema'/);
      const avisosLojas = names("avisos_lojas");
      for (const field of ["aviso_id", "loja"])
        assert.ok(avisosLojas.includes(field), "Coluna de direcionamento ausente: " + field);
      const lojaPk = db.prepare("PRAGMA table_info(avisos_lojas)").all().filter(row => Number(row.pk) > 0);
      assert.deepEqual(lojaPk.map(row => row.name).sort(), ["aviso_id", "loja"],
        "O direcionamento deve ter PK composta por aviso e loja");
      // Migration 0029: canal em chat — tipos ampliados e título opcional,
      // preservando o restante do contrato da tabela reconstruída.
      assert.match(urgente.sql, /CHECK \(tipo IN \('aviso', 'evento', 'chat'\)\)/);
      assert.deepEqual(names("avisos_reacoes"), ["aviso_id", "usuario_id", "emoji", "atualizado_em"]);
      assert.deepEqual(db.prepare("PRAGMA table_info(avisos_reacoes)").all().filter(row => Number(row.pk) > 0).map(row => row.name), ["aviso_id", "usuario_id"]);
      const tituloRow = db.prepare("PRAGMA table_info(avisos)").all().find(row => row.name === "titulo");
      assert.equal(tituloRow?.notnull, 0, "titulo deve ser opcional para mensagens do canal");
    } finally {
      db.close();
    }
  });
});
