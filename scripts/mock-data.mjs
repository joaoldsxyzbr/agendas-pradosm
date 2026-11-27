// Dados 100% fictícios. Não ler arquivos de produção nem acessar serviços externos.
import { createHash } from "node:crypto";
import { businessDate } from "../shared/time.ts";
import { hashPassword } from "../worker/lib/password.ts";

export const MOCK_ACCOUNTS = Object.freeze([
  { login: "admin.mock", name: "Administrador de teste", role: "admin", store: null },
  { login: "digitador.mock", name: "Digitador de teste", role: "visualizador", profile: "digitador", store: null },
  { login: "agendador.mock", name: "Agendador de teste", role: "visualizador", profile: "agendador", store: null },
  { login: "gerente.mock", name: "Gerente de depósito de teste", role: "visualizador", store: null },
  { login: "conferente01.mock", name: "Conferente 01 de teste", role: "conferente", store: 1 },
  { login: "conferente02.mock", name: "Conferente 02 de teste", role: "conferente", store: 2 },
  { login: "conferente03.mock", name: "Conferente 03 de teste", role: "conferente", store: 3 },
]);
export function mockId(key) {
  const hex = createHash("sha256").update("agenda-prado-local-mock-v1:" + key).digest("hex");
  return hex.slice(0,8)+"-"+hex.slice(8,12)+"-4"+hex.slice(13,16)+"-8"+hex.slice(17,20)+"-"+hex.slice(20,32);
}
function sql(value) {
  if (value === null) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") throw Error("Valor inesperado no fixture.");
  return "'" + value.replaceAll("'", "''") + "'";
}
function insert(table, row) {
  return "INSERT INTO " + table + " (" + Object.keys(row).join(",") + ") VALUES (" +
    Object.values(row).map(sql).join(",") + ") ON CONFLICT(id) DO NOTHING;";
}
export function offsetDay(date, offset) {
  const value = new Date(date + "T12:00:00.000Z");
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0,10);
}
export function mockImportCsv(now = new Date()) {
  const day = offsetDay(businessDate(now), 1).split("-").reverse().join("/");
  return [
    "Filtros;",
    "Dia: " + day + " ; Filial: Todas ; Doca: Todas ; Busca:  ; ;",
    "",
    "Protocolo;Data agenda;Fornecedor;Filial;Doca;Itens;Vol.;Paletes;Carga batida;Tipo;N° NFe;Pedidos;",
    "99000001;" + day + " 07:00 às 08:00;Fornecedor Mock Norte;F901 - Loja fictícia 01;DOCA 01;5;12;1;-;Pedido;-;99001;",
    "99000002;" + day + " 08:00 às 09:00;Fornecedor Mock Sul;F902 - Loja fictícia 02;DOCA 01;6;20;2;-;Nota fiscal;99002;99003;",
    "99000003;" + day + " 09:00 às 10:00;Fornecedor Mock Centro;F903 - Loja fictícia 03;DOCA 01;7;30;3;-;Agenda fixa;-;-;",
    "",
  ].join("\n");
}
export async function buildMockSql(password, now = new Date(), options = {}) {
  if (typeof password !== "string" || password.length < 12) throw Error("Senha local inválida.");
  const today = businessDate(now);
  const stamp = now.toISOString();
  const admin = mockId("user:admin.mock");
  const rows = [];
  const stores = [1, 2, 3].map(i => ({ id: mockId("store:"+i), codigo: "F90"+i,
    nome: "Loja fictícia 0"+i, ativo: 1, criado_em: stamp, atualizado_em: stamp }));
  for (const store of stores) rows.push(insert("lojas",store));
  for (const user of MOCK_ACCOUNTS.filter(u=>!u.profile||(options.access&&(u.profile!=="digitador"||options.v2)))) {
    const id = mockId("user:"+user.login);
    const lojaId = user.store ? stores[user.store-1].id : null;
    rows.push(insert("usuarios",{id,loja_id:lojaId,nome:user.name,login:user.login,
      senha_hash:await hashPassword(password),papel:user.role,ativo:1,criado_em:stamp,atualizado_em:stamp}));
    if(user.profile)rows.push("INSERT INTO usuario_acesso(usuario_id,perfil,escopo) VALUES ("+sql(id)+","+sql(user.profile)+",'todas') ON CONFLICT(usuario_id) DO NOTHING;");
    rows.push(insert("auditoria",{id:mockId("audit:user:"+user.login),usuario_id:admin,
      acao:"usuario_criado",entidade:"usuario",entidade_id:id,loja_id:lojaId,
      depois:JSON.stringify({nome:user.name,login:user.login,papel:user.role,ativo:true,lojaId}),
      detalhes:"Cadastro fictício para teste local.",criado_em:stamp}));
  }
  for (let offset=-6;offset<=0;offset++) {
    const date=offsetDay(today,offset);
    const past=offset<0;
    const time=past ? date+"T18:00:00.000Z" : stamp;
    for (let s=0;s<stores.length;s++) {
      const store=stores[s];
      const userId=mockId("user:conferente0"+(s+1)+".mock");
      const agendaId=mockId("agenda:"+store.id+":"+date);
      rows.push(insert("agendas",{id:agendaId,loja_id:store.id,data_agenda:date,
        arquivo_original:"agenda-ficticia-"+date+".csv",criado_por:admin,
        status_dia:past?"concluido":"aberto",concluido_em:past?time:null,
        concluido_por:past?userId:null,criado_em:time,atualizado_em:time}));
      rows.push(insert("auditoria",{id:mockId("audit:agenda:"+agendaId),usuario_id:admin,
        acao:"agenda_importada",entidade:"agenda",entidade_id:agendaId,loja_id:store.id,
        agenda_id:agendaId,detalhes:"Importação fictícia.",criado_em:time}));
      if(past) rows.push(insert("historico_agenda",{id:mockId("history:agenda:"+agendaId),
        agenda_id:agendaId,usuario_id:userId,acao:"concluido",detalhes:"Fechamento fictício.",alterado_em:time}));
      const samples=[
        {name:"Fornecedor Mock Norte",status:"recebido",note:null},
        {name:"Fornecedor Mock Sul",status:"nao_chegou",note:"Sem pedido"},
        {name:"Fornecedor Mock Centro",status:past?"nao_chegou":"aguardando",note:past?"Não compareceu":null},
        {name:"Fornecedor Mock Frio",status:"nao_chegou",note:"Temperatura acima do OK"},
        {name:"Fornecedor Mock Leste",status:past?"recebido":"aguardando",note:null},
        {name:"Fornecedor Mock Sem Agenda",status:"recebido",note:null,manual:true},
      ];
      for (let i=0;i<samples.length;i++) {
        const item=samples[i],id=mockId("appointment:"+agendaId+":"+i);
        const protocol=item.manual?"manual:"+id:String(91000000+(offset+6)*1000+s*100+i);
        const hour=String(7+i).padStart(2,"0"),end=String(8+i).padStart(2,"0");
        rows.push(insert("agendamentos",{id,agenda_id:agendaId,protocolo:protocol,
          horario_inicio:hour+":00",horario_fim:end+":00",fornecedor:item.name,
          itens:item.manual?null:5+i,volumes:item.manual?null:10+i,paletes:item.manual?null:1,
          tipo:item.manual?"Sem agenda":"Pedido",nfe:"[]",pedidos:item.manual?"[]":JSON.stringify([String(90000+i)]),
          status:item.status,origem:item.manual?"manual":"importado",ativo:1,trocas:i===0?1:0,
          observacao:item.note,criado_em:time,atualizado_em:time,
          csv_campos:item.manual?null:JSON.stringify({Protocolo:protocol,Fornecedor:item.name,Filial:store.codigo})}));
        if(item.status!=="aguardando") {
          rows.push(insert("historico_status",{id:mockId("history:"+id),agendamento_id:id,usuario_id:userId,
            status_anterior:"aguardando",status_novo:item.status,observacao:item.note,alterado_em:time}));
          rows.push(insert("auditoria",{id:mockId("audit:status:"+id),usuario_id:userId,
            acao:"status_alterado",entidade:"agendamento",entidade_id:id,loja_id:store.id,
            agenda_id:agendaId,agendamento_id:id,antes:JSON.stringify({status:"aguardando"}),
            depois:JSON.stringify({status:item.status,observacao:item.note}),criado_em:time}));
        }
      }
    }
  }
  rows.push(insert("avisos",{id:mockId("aviso:boas-vindas"),tipo:"aviso",titulo:"Ambiente fictício",
    mensagem:"Estes dados são sintéticos. Use este ambiente para testar o recebimento.",
    criado_por:admin,criado_em:stamp,urgente:0,autor:"Administrador de teste"}));
  return rows.join("\n")+"\n";
}
