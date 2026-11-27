# Reconciliação main / V2

Base V2 7365c54c89e1e88e06172a2ea61fd540f31c33d9; referência main 481b92f65d93fbbd1813c9153ee4c79d1b3220a3; branch `feat/v2-consolidacao-main`. Base comum b8252f2; 90 caminhos exclusivos da main, 94 da V2, 49 modificados dos dois lados, 183 idênticos (comparação de blobs, incluindo adições/remoções). Nenhum merge em main/preview.

- [x] Inventário e preservação do snapshot original.
- [x] Núcleo de agendas: separar consultas/importação/mutações com código da main, restaurar filtros de escopo, paginar após autorização, proteger CSV vinculado Nexello. Serviços de digitação, manutenção e realtime tipados. Eventos operacionais passam à auditoria; realtime continua desligado.
- [ ] Validar regressões dos módulos de agendas, segurança e tipos reais D1. Testes antigos de eventos precisam refletir decisão da main.
- [ ] Canal de Avisos: preservar avisos, leituras e destinos; integrar permissões, ID estável de loja, chat, reações e leitura. Migration 0029 da main usa rebuild/PRAGMA foreign_keys OFF/BEGIN; não aplicar diretamente ao D1 V2. Preparar e testar 0011 em SQLite com dados sintéticos e aprovação explícita do contrato antes de aplicar remotamente. 0030/0031 devem integrar a mesma evolução.
- [ ] Demais módulos estritos (Worker, UI, scripts Node e testes), preservar redesign, perfis, comparativos Nexello, relatório gerencial e caminhos locais. Não reativar R2/deploy/cron.
- [ ] Configurar exclusivamente D1 existente agendas-pradosm-preview (962d3e81-9045-421b-96f8-ce65b5d1996d), 10 migrations já aplicadas, usuário teste existente. Não editar migrations aplicadas nem resetar. Worker isolado permanece não publicado.
- [ ] Gate completo, CI quando V2 concluída, revisão/merge somente mediante autorização.

## Limites

Build/CI/migration remota/deploy não executados. Restante dos conflitos não resolvido. Não habilitar branch para uso operacional antes de integrar contratos e validar. Avisos ainda anteriores ao chat.

## Proposta de evolução do canal de Avisos

Arquivo de estudo: `docs/plans/sql/0011_avisos_canal.sql` (fora de migrations-v2 para não ser aplicado por engano). SHA-256 local: `bd383380c94480897e69ffdccc8a137ad06f73401b1d82434c8ff898e4b7eb90`. Não editar migrations 0001–0010 já aplicadas.

O CHECK de tipo e o NOT NULL do título exigem reconstrução da tabela pai. Recriar também os dois filhos em tabelas intermediárias, copiar os registros, remover os filhos antigos antes do pai e renomear; as referências apontam para o novo pai. Não usar foreign_keys OFF, BEGIN/COMMIT explícitos no D1 ou DROP direto do pai. Reações e destino por ID estável seguem os contratos 0030/0031. Código legado sem correspondência mantém loja_id NULL e não deve ser tratado como destino global.

Teste real local (Python sqlite3, dez migrations do snapshot V2, transação com foreign_keys ON): preservou dois avisos incluindo evento histórico, uma leitura, dois destinos (um resolvido e outro não resolvido) e usuário; rollback integral quando uma inserção inválida falhou depois da reconstrução; inserção de chat sem título, reação, resolução de escrita legada, estabilidade do destino após renomear loja, foreign_key_check vazio e integrity_check ok. Asserções verificaram que só os dois filhos referenciam avisos antes da alteração. Não equivale a executar em D1 remoto.

Contrato bloqueado para execução: exige aprovação explícita para reconstrução, registro de aprovação com hash, conferência de backup e contagens no banco correto, validação no runtime D1, revisão de permissões e teste de preservação. Não desabilitar o gate global. Banco preview permanece com dez migrations e usuário existente. O novo canal ainda não está conectado.

## Lote backend Avisos

Portar contrato, repositório e rotas da main, com escopo estável por ID, autorização de chat/reações/leitores separada, validação de destino real e régua global restrita a quem possui permissão e escopo global. Visualizador sem acesso padrão ao canal (paridade main); exceções explícitas ainda podem conceder permissões. Digitador e conferente mantêm canal conforme perfil. Chat é global como na main, inclusive para conferentes vinculados; não confundir isso com publicação oficial direcionada. Contas personalizadas seguem permissões efetivas. O repositório de leitores considera perfis efetivos quando ACCESS_MODE=on. Testes unitários de política adicionados. A interface e a aprovação da migration 0011 continuam pendentes; manter branch não publicada.

## Lote de interface Avisos

Canal da main incorporado à navegação V2, mantendo menu reordenável, identidade visual e escopo do perfil efetivo. Badge no menu, toasts, busca, paginação, leitura e reações; ações separadas por permissão. Conta com lojas atribuídas não pode publicar para todas nem escolher destinos fora do escopo. Leitores só com escopo global. Sessão que só tem Avisos direcionada ao canal. Realtime permanece desativado no V2; atualização por HTTP. Antigo sino retirado. Não executado build/Playwright neste lote. Migration 0011 ainda não aplicada nem integrada ao diretório executável.

### Verificação local do lote de Avisos

- `node --experimental-strip-types --test tests/unit/v2-avisos-sqlite.test.ts`: 2/2 aprovados em Node 22.16, com SQLite real, migrations 0001–0010 e proposta 0011; verificados os blobs exatos de notice-scope, proposta SQL e adaptador local. Isolamento global, vazio, uma/múltiplas lojas, destino legado não resolvido, alteração/reutilização de código de loja, preservação de leitura e integridade referencial; conta personalizada não herda privilégios do papel físico.
- Validação específica de filtros e permissões, não valida o backend HTTP completo nem a interface. Sem CI, deploy ou alteração remota.

## Lote de relatórios gerenciais

Mantida a semântica V2 (recusas, ausências e não recebidos no ranking; entregas manuais recebidas, total de fornecedores e filtros por tipo). Incorporada busca literal da main, filtros tipados e predicados SQL compartilhados entre resumo, ranking e ocorrências. Consultas filtram também pelo escopo estável do servidor usando json_each, inclusive escopo vazio. Falhas de leitura não são convertidas em sucesso vazio. UI propaga AbortSignal nas quatro consultas de relatório, sincroniza rascunho/aplicado ao selecionar período rápido e reinicia a paginação ao remover filtros inválidos. Seleção explícita totalmente inválida não é ampliada automaticamente a todas as lojas; exige revisão pelo operador.

Teste local real: Node 22.16 + SQLite, `tests/unit/v2-report-filters.test.ts` 1/1 aprovado, 14 asserções, incluindo escopo vazio/global/múltiplo, interseção com códigos, classes de ocorrência, exclusão de inativos e busca literal por caracteres especiais e texto longo. Helper isolado compilado com TypeScript 5.8.3 strict/noUncheckedIndexedAccess; blobs do helper e do teste conferidos. Não foi validada a rota HTTP inteira, build web, integração D1 remota ou CI.

## Lote Conferência / Recebimento / Histórico

Reaproveitados os blobs exatos da main de quatro clientes HTTP e da rota de conferência, após comparar linha a linha com a branch V2: diferenças dos clientes eram apenas propagação de AbortSignal; da rota, tipagem explícita, validação defensiva da sessão e normalização nullable. Não alterada a política de autorização externa da V2, que resolve o escopo e adapta o usuário operacional antes da rota de loja. Propagado o cancelamento nas consultas das páginas redesenhadas de Conferência, Recebimento, Histórico e detalhes administrativos. Não substituir as páginas pelo layout antigo. Nenhum CI/build ou teste de navegador executado neste lote; validar a integração de tipos e os guards com os testes locais antes do gate final.

## Lote Realtime

Portados os blobs da main do cliente WebSocket compartilhado, hooks de conferência/recebimento e hub tipado com evento avisos.changed, validação de attachment e expiração. Rota baseada na main com tratamento explícito de falhas do binding; proteção adicional bloqueia conexões de contas personalizadas e conexões diretas no modo off. Layout recebe invalidação do canal nas demais telas para contas legadas, sem duplicar sockets de recebimento/conferência. Mantido fallback HTTP e heartbeat REST de presença. Nenhuma configuração de ambiente alterada: REALTIME_MODE=off na V2. Não habilitar realtime personalizado antes de implementar escopos no hub. Testes de integração e compilação integral pendentes.

## Lote de testes de paridade

Reaproveitados da main adaptadores SQLite/D1 e recording-D1 tipados, contratos históricos e testes de paginação, rotas, digitação, concorrência de agendas, importação, status e indisponibilidade realtime. Acrescentado teste de modo off e contas personalizadas, com verificação de que nenhuma chamada ao hub legado ocorre. Não foram executados neste lote; os testes de integração devem ser revisados contra a V2 e suas migrations. Preservados testes próprios da V2. Não copiar automaticamente suites de retenção, recuperação ou migrations de produção; esses contratos divergem deliberadamente por não usar R2 e por manter schema isolado.
