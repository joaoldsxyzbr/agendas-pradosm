import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAgendaCsv } from "../../shared/import/parseAgendaBatch.ts";
import {
  formatImportBatchIssues,
  validateImportBatchPayload
} from "../../shared/import/validateImportBatch.ts";

// Réplica do buildImportPayload do import-model.ts (React): a prévia valida
// exatamente o payload que seria enviado ao endpoint de lote.
function payloadFromPreview(preview: ReturnType<typeof parseAgendaCsv>, originalFileName: string) {
  return {
    agendas: preview.agendas.flatMap(agenda => ({
      storeCode: agenda.storeCode,
      date: agenda.date,
      originalFileName,
      appointments: agenda.appointments.map(({ status: _status, ...appointment }) => appointment)
    }))
  };
}

// CSV sintético acima do limite seguro (1.000.000.000): o parser aceita
// qualquer sequência de dígitos em Itens, mas o schema do Worker rejeita
// contagens fora do limite com um 400 genérico.
const incidentCsv = [
  "Protocolo;Data agenda;Fornecedor;Filial;Doca;Itens;Vol.;Paletes;Carga batida;Tipo;N° NFe;Pedidos;",
  "99990001;23/11/2026 07:00 às 07:30;FORNECEDOR ALFA LTDA;CD;DOCA 01;26;100;0;-;Pedido;-;48354;",
  "99990002;23/11/2026 13:10 às 13:40;FORNECEDOR BETA LTDA;CD;DOCA 02;1000000001;26;1;-;Nota fiscal;-;-;"
].join("\n");

const validCsv = [
  "Protocolo;Data agenda;Fornecedor;Filial;Doca;Itens;Vol.;Paletes;Carga batida;Tipo;N° NFe;Pedidos;",
  "99990001;23/11/2026 07:00 às 07:30;FORNECEDOR ALFA LTDA;CD;DOCA 01;26;100;0;-;Pedido;-;48354;",
  "99990002;23/11/2026 13:10 às 13:40;FORNECEDOR BETA LTDA;CD;DOCA 02;260000000;26;1;-;Nota fiscal;-;-;"
].join("\n");

const validAppointment = (protocol: string, startTime: string, endTime: string) => ({
  protocol,
  startTime,
  endTime,
  supplier: "FORNECEDOR GAMA LTDA",
  items: 1,
  volumes: null,
  pallets: null,
  cargaBatida: null,
  type: "Pedido",
  nfe: [],
  orders: []
});

describe("Prévia e Worker compartilham a validação do lote de importação", () => {
  it("contagem acima do limite seguro é apontada com protocolo, loja e campo", () => {
    const preview = parseAgendaCsv(incidentCsv);
    assert.equal(preview.blockingErrors.length, 0);
    assert.equal(preview.totalAppointments, 2);
    const issues = validateImportBatchPayload(payloadFromPreview(preview, "agendas.csv"));
    assert.equal(issues.length, 1);
    assert.equal(
      issues[0],
      "REGISTRO_INVALIDO:99990002 (CD DOCA 02, 23/11/2026, Itens) Contagem acima do limite seguro."
    );
  });

  it("lote dentro dos limites não gera erros, incluindo o padrão do fornecedor (260000000)", () => {
    const preview = parseAgendaCsv(validCsv);
    const issues = validateImportBatchPayload(payloadFromPreview(preview, "agendas.csv"));
    assert.deepEqual(issues, []);
  });

  it("loja e data duplicadas no lote são apontadas na agenda afetada", () => {
    const issues = validateImportBatchPayload({
      agendas: [
        { storeCode: "F01", date: "2026-11-23", originalFileName: "a.csv", appointments: [validAppointment("99990003", "07:00", "07:30")] },
        { storeCode: "f01", date: "2026-11-23", originalFileName: "a.csv", appointments: [validAppointment("99990004", "08:00", "08:30")] }
      ]
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /AGENDA_INVALIDA:f01, 23\/11\/2026 Loja e data duplicadas no lote\./);
  });

  it("formatação limita a lista de issues e informa o restante", () => {
    const manyIssuesPayload = {
      agendas: [{
        storeCode: "CD DOCA 01",
        date: "2026-11-23",
        originalFileName: "a.csv",
        appointments: Array.from({ length: 15 }, (_unused, index) => ({
          protocol: `99990${String(index).padStart(4, "0")}`
        }))
      }]
    };
    const issues = Array.from({ length: 15 }, (_unused, index) => ({
      path: ["agendas", 0, "appointments", index, "items"],
      message: "Contagem acima do limite seguro."
    }));
    const labels = formatImportBatchIssues(issues, manyIssuesPayload, 10);
    assert.equal(labels.length, 11);
    assert.equal(labels[labels.length - 1], "LOTE_INVALIDO:5 outros problemas não listados.");
  });
});
