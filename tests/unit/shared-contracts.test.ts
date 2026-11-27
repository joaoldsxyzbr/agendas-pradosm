import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeStoreCode } from "../../shared/store.ts";
import { BUSINESS_TIME_ZONE, businessDate, businessTime } from "../../shared/time.ts";
import { REALTIME_PROTOCOL_VERSION, realtimeConfigSchema, realtimeEventSchema } from "../../shared/realtime.ts";
import { parseAgendaText } from "../../shared/import/parseAgendaText.ts";
import { parseAgendaCsv, parseAgendaPdfText } from "../../shared/import/parseAgendaBatch.ts";
import { ImportAgendaInput } from "../../shared/agenda.ts";

describe("Contratos preservados na migração JS puro", () => {
  it("normalização de códigos de loja", () => {
    assert.equal(normalizeStoreCode("  loja 01  "), "LOJA 01");
  });
  it("contagens de import absurdas são rejeitadas antes do bind no D1", () => {
    const baseInput = {
      storeCode: "CD DOCA 07",
      date: "2026-11-06",
      originalFileName: "agendas.csv",
      appointments: [
        {
          protocol: "12760355",
          startTime: "14:50",
          endTime: "15:00",
          supplier: "FORNECEDOR EXEMPLO",
          items: 260000000,
          volumes: null,
          pallets: null,
          cargaBatida: null,
          type: "Nota fiscal",
          nfe: [],
          orders: []
        }
      ]
    };
    const padraoFornecedor = ImportAgendaInput.safeParse(baseInput);
    assert.ok(padraoFornecedor.success, "contagem no padrão do fornecedor do incidente de 23/11/2026 (260000000) deve ser aceita");
    const noLimite = ImportAgendaInput.safeParse({
      ...baseInput,
      appointments: [{ ...baseInput.appointments[0], items: 1000000000 }]
    });
    assert.ok(noLimite.success, "contagem no limite de 1.000.000.000 deve ser aceita");
    const alemDoLimite = ImportAgendaInput.safeParse({
      ...baseInput,
      appointments: [{ ...baseInput.appointments[0], items: 1000000001 }]
    });
    assert.ok(!alemDoLimite.success, "contagem acima de 1.000.000.000 deve ser rejeitada");
    const issues = JSON.stringify(alemDoLimite.error.issues);
    assert.match(issues, /limite seguro/);
  });
  it("data/hora de Brasília e protocolo de tempo real", () => {
    assert.equal(BUSINESS_TIME_ZONE, "America/Sao_Paulo");
    assert.equal(businessDate(new Date("2026-10-18T03:00:00Z")), "2026-10-18");
    assert.equal(businessTime(new Date("2026-10-18T12:35:00Z")), "09:35");
    assert.equal(REALTIME_PROTOCOL_VERSION, 1);
  });
  it("parsings inválidos preservam lista de erros e avisos", () => {
    const parsed = [
      parseAgendaText("texto sem agenda"),
      parseAgendaCsv("texto sem colunas reconhecidas"),
      parseAgendaPdfText("texto sem agenda")
    ] as const;
    for (const item of parsed) {
      assert.ok(Array.isArray(item.blockingErrors));
      assert.ok(Array.isArray(item.warnings));
    }
    assert.ok(Array.isArray(parsed[1].agendas));
    assert.ok(Array.isArray(parsed[2].agendas));
  });
});
describe("Protocolo compartilhado de tempo real", () => {
  it("aceita apenas versão e tipos de evento conhecidos", () => {
    assert.equal(realtimeConfigSchema.safeParse({mode:"on",protocolVersion:1}).success,true);
    assert.equal(realtimeConfigSchema.safeParse({mode:"on",protocolVersion:2}).success,false);
    const agenda={version:1,type:"agenda.changed",agendaId:"a",storeId:"s",date:"2026-11-26",reason:"status"};
    assert.equal(realtimeEventSchema.safeParse(agenda).success,true);
    assert.equal(realtimeEventSchema.safeParse({...agenda,reason:"desconhecido"}).success,false);
    assert.equal(realtimeEventSchema.safeParse({...agenda,date:"2026-02-30"}).success,false);
    assert.equal(realtimeEventSchema.safeParse({version:1,type:"presence.changed",status:"online"}).success,false);
    assert.equal(realtimeEventSchema.safeParse({version:1,type:"avisos.changed"}).success,true);
  });
});
