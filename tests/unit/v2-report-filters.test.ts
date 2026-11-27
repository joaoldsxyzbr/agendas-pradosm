import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openLocalDatabase } from "../../scripts/local-sqlite.mjs";
import { storeFilter, occurrenceCondition, occurrenceSearch, type OccurrenceType } from "../../worker/repositories/report-filters.ts";

test("report scope, literal search and occurrence classifications with real SQLite", async () => {
  const fixture = openLocalDatabase(":memory:", fileURLToPath(new URL("../../migrations-v2/", import.meta.url)));
  try {
    fixture.seed(`INSERT INTO lojas(id,codigo,nome,criado_em,atualizado_em) VALUES('l1','F01','Uma','t','t'),('l2','F02','Duas','t','t');
      INSERT INTO usuarios(id,nome,login,senha_hash,papel,criado_em,atualizado_em) VALUES('u','Admin','admin','hash','admin','t','t');
      INSERT INTO agendas(id,loja_id,data_agenda,arquivo_original,criado_por,status_dia,criado_em,atualizado_em) VALUES('g1','l1','2026-11-27','a.csv','u','concluido','t','t'),('g2','l2','2026-11-27','b.csv','u','aberto','t','t');
      INSERT INTO agendamentos(id,agenda_id,protocolo,horario_inicio,horario_fim,fornecedor,status,observacao,ativo,criado_em,atualizado_em) VALUES
      ('p1','g1','123451','08:00','09:00','Alfa%_','aguardando',NULL,1,'t','t'),
      ('p2','g1','123452','08:00','09:00','Alfa','nao_chegou','Não compareceu',1,'t','t'),
      ('p3','g1','123453','08:00','09:00','Beta','nao_chegou','Produto incorreto',1,'t','t'),
      ('p4','g1','123454','08:00','09:00','Gama','recusado',NULL,1,'t','t'),
      ('p5','g1','123455','08:00','09:00','Inativo','recusado',NULL,0,'t','t'),
      ('p6','g2','123456','08:00','09:00','Alfa','aguardando',NULL,1,'t','t'),
      ('p7','g2','123457','08:00','09:00','Alfa%_','recusado',NULL,1,'t','t'),
      ('p8','g1','123458','08:00','09:00','Recebido','recebido',NULL,1,'t','t');`);
    const find = async (scope: readonly string[] | undefined, codes: string[] = [], type: OccurrenceType = "todos", q?: string) => {
      const filter = storeFilter({ start: "2026-11-27", end: "2026-11-27", storeCodes: codes }, scope);
      const search = occurrenceSearch(q);
      const result = await fixture.DB.prepare(`SELECT ag.id FROM agendamentos ag JOIN agendas a ON a.id=ag.agenda_id JOIN lojas l ON l.id=a.loja_id WHERE ${filter.where} AND ag.ativo=1 AND ${occurrenceCondition(type)}${search.clause} ORDER BY ag.id`).bind(...filter.args, ...search.args).all();
      return result.results.map((r: { id: string }) => r.id);
    };
    assert.deepEqual(await find(undefined), ["p1", "p2", "p3", "p4", "p7"]);
    assert.deepEqual(await find([]), []);
    assert.deepEqual(await find(["l1"]), ["p1", "p2", "p3", "p4"]);
    assert.deepEqual(await find(["l1"], ["F02"]), []);
    assert.deepEqual(await find(["l1", "l2"], ["f01", "F02", "F01"]), ["p1", "p2", "p3", "p4", "p7"]);
    assert.deepEqual(await find(["l1"], [], "nao_compareceu"), ["p1", "p2"]);
    assert.deepEqual(await find(["l1"], [], "nao_recebido"), ["p3"]);
    assert.deepEqual(await find(["l1"], [], "recusado"), ["p4"]);
    assert.deepEqual(await find(undefined, [], "todos", "%_"), ["p1", "p7"]);
    assert.deepEqual(await find(["l1"], [], "todos", "ALFA"), ["p1", "p2"]);
    assert.deepEqual(await find(undefined, [], "todos", "123453"), ["p3"]);
    assert.deepEqual(await find(undefined, [], "todos", "\\"), []);
    assert.deepEqual(await find(undefined, [], "todos", "á".repeat(80)), []);
    assert.deepEqual((await fixture.DB.prepare("PRAGMA foreign_key_check").all()).results, []);
  } finally { fixture.close(); }
});
