import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runRetention, retentionStatus
} from "../../worker/services/retention.ts";

const migrationsDir = fileURLToPath(new URL("../../migrations-v2/", import.meta.url));
const AGORA = new Date("2026-11-05T12:00:00.000Z");
const DIA_MS = 86400000;

/** Executa o schema real (todas as migrations) contra um banco em memória. */
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrationNames = readdirSync(migrationsDir).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
  for (const name of migrationNames) {
    sqlite.exec(readFileSync(join(migrationsDir, name), "utf8"));
  }
  const agora = AGORA.toISOString();
  sqlite.prepare(
    "INSERT INTO lojas (id,codigo,nome,criado_em,atualizado_em) VALUES (?,?,?,?,?)"
  ).run("loja1", "F01", "Loja sintética", agora, agora);
  sqlite.prepare(
    "INSERT INTO usuarios (id,loja_id,nome,login,senha_hash,papel,ativo,session_version,criado_em,atualizado_em) VALUES (?,?,?,?,?,'admin',1,1,?,?)"
  ).run("adm", null, "Admin sintético", "adm", "hash-sintetico", agora, agora);
  sqlite.prepare(
    "INSERT INTO agendas (id,loja_id,data_agenda,arquivo_original,criado_por,status_dia,criado_em,atualizado_em) VALUES (?,?,?,'agenda.csv','adm','aberto',?,?)"
  ).run("agenda1", "loja1", "2026-10-30", agora, agora);
  sqlite.prepare(
    "INSERT INTO agendamentos (id,agenda_id,protocolo,horario_inicio,horario_fim,fornecedor,ativo,status,origem,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).run("apto1", "agenda1", "P-1", "08:00", "09:00", "Fornecedor Sintético", 1, "aguardando", "importado", agora, agora);
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      let params = [];
      const request = {
        bind(...values) { params = values; return request; },
        async first() { return stmt.get(...params) ?? null; },
        async all() { return { results: stmt.all(...params) }; },
        async run() {
          const result = stmt.run(...params);
          return { meta: { changes: Number(result.changes) } };
        }
      };
      return request;
    }
  };
  return { sqlite, db };
}


function iso(diasAtras) {
  return new Date(AGORA.getTime() - diasAtras * DIA_MS).toISOString();
}

function inserirHistoricoStatus(sqlite, id, diasAtras) {
  sqlite.prepare(
    "INSERT INTO historico_status (id,agendamento_id,usuario_id,status_anterior,status_novo,alterado_em) VALUES (?,?,?,?,?,?)"
  ).run(id, "apto1", "adm", "pendente", "recebido", iso(diasAtras));
}

function inserirHistoricoAgenda(sqlite, id, diasAtras) {
  sqlite.prepare(
    "INSERT INTO historico_agenda (id,agenda_id,usuario_id,acao,detalhes,alterado_em) VALUES (?,?,?,?,?,?)"
  ).run(id, "agenda1", "adm", "concluido", null, iso(diasAtras));
}

function inserirAuditoria(sqlite, id, diasAtras) {
  sqlite.prepare(
    "INSERT INTO auditoria (id,usuario_id,acao,entidade,entidade_id,criado_em) VALUES (?,?,?,?,?,?)"
  ).run(id, "adm", "acao_sintetica", "agenda", "agenda1", iso(diasAtras));
}

describe("Monitoramento V2 sem exclusão de dados", () => {
  it("preserva todos os registros, inclusive os além do corte", async () => {
    const { sqlite, db } = fixture();
    inserirHistoricoStatus(sqlite, "hs-antigo", 400);
    inserirHistoricoAgenda(sqlite, "ha-antigo", 400);
    inserirAuditoria(sqlite, "au-antiga", 800);

    const resumo = await runRetention(db, { now: AGORA, runId: "run-sempBucket" });

    assert.equal(resumo.exportacaoPulada, true);
    const hs = resumo.tabelas.find((t) => t.tabela === "historico_status");
    assert.equal(hs.motivo, "PRESERVACAO_SEM_ARQUIVAMENTO");
    assert.equal(hs.pendentes, 1);
    assert.equal(hs.purgados, 0);
    assert.ok(resumo.tabelas.every(t=>t.exportados===0&&t.purgados===0));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM historico_agenda").get().n, 1);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM historico_status WHERE id='hs-antigo'").get().n, 1
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE id='au-antiga'").get().n, 1
    );
  });

  it("status expõe contagem e expiradas por tabela", async () => {
    const { sqlite, db } = fixture();
    inserirHistoricoStatus(sqlite, "hs-antigo", 400);
    inserirHistoricoStatus(sqlite, "hs-recente", 10);
    const status = await retentionStatus(db, AGORA);
    const hs = status.tabelas.find((t) => t.tabela === "historico_status");
    assert.equal(hs.total, 2);
    assert.equal(hs.expiradas, 1);
    assert.equal(hs.retencaoDias, 365);
    const au = status.tabelas.find((t) => t.tabela === "auditoria");
    assert.equal(au.retencaoDias, 730);
  });

  it("alerta de tamanho dispara acima do limite configurado", async () => {
    const { db } = fixture();
    const resumo = await runRetention(db, {
      now: AGORA, runId: "run-alerta", rowWarningThreshold: 1
    });
    assert.ok(resumo.alertaTamanhoBanco);
    assert.equal(resumo.alertaTamanhoBanco.nivel, "warning");
    assert.ok(resumo.alertaTamanhoBanco.limite === 1);
    assert.ok(resumo.totalLinhas >= 1);
    assert.ok(resumo.contagemTabelas.agendamentos >= 1);
  });
});
