# Reconciliação main / V2

## Inventário de blobs recalculado — 27/11/2026

Comparação refeita pelo GitHub API a partir dos trees completos de `main` (`481b92f65d93fbbd1813c9153ee4c79d1b3220a3`), ancestral comum (`b8252f2a394ce3376a5643d8fb50071fb7dce552`) e branch ativa (`feat/v2-consolidacao-main`, `e274099ad79711b31e3646dcd756f94c88e8fc77`). Classificação por caminho e SHA do blob, comparando cada branch com o ancestral:

| Classe | Caminhos | Decisão inicial |
| --- | ---: | --- |
| Mudados apenas na main | 27 | Revisar e portar/adaptar somente o que cabe no schema e operação V2. |
| Mudados apenas na consolidação | 103 | Preservar como trabalho V2; revisar regressões e limites. |
| Mudados nas duas branches, blob idêntico | 64 | Conteúdo convergente. |
| Mudados nas duas branches, blob diferente | 52 | Revisão manual obrigatória por contrato/segurança/UX. |
| Caminhos sem mudança relativa ao ancestral | 179 | Sem divergência de blob nessa comparação. |

O HEAD da consolidação ainda difere de `main` em 182 caminhos e de sua base V2 original (`7365c54c89e1e88e06172a2ea61fd540f31c33d9`) em 102. Esses totais incluem funcionalidades próprias da V2 e não são, isoladamente, medida de paridade funcional.

Mudanças exclusivas da main que dependem diretamente do schema/recursos de produção (migrations 0029–0031, contratos de migration, smoke/benchmarks e retenção/R2) não devem ser copiadas literalmente. Os testes, documentação de segurança/operação e workflow restante precisam receber decisão explícita de adaptação ou exclusão justificada. As 52 divergências simultâneas incluem autenticação/sessões, autorização, agendas, Avisos, relatórios, auditoria, presença/realtime, testes de navegação/relatório, build e política de retenção; cada uma deve ser revisada mantendo os comportamentos intencionais da V2.

Inventário inicial registrado antes dos lotes finais (histórico, não usar como estado atual): base V2 `7365c54c89e1e88e06172a2ea61fd540f31c33d9`, main `481b92f65d93fbbd1813c9153ee4c79d1b3220a3`, ancestral comum `b8252f2a394ce3376a5643d8fb50071fb7dce552`; 90 caminhos exclusivos da main, 94 exclusivos da V2, 49 modificados dos dois lados e 183 idênticos. Nenhum merge em main/preview.

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

Arquivo de estudo: `docs/plans/sql/0011_avisos_canal.sql` (fora de migrations-v2 para não ser aplicado por engano). SHA-256 local após impor o título obrigatório para aviso/evento e nulo exclusivamente no chat: `2409b6abfb6034f8d50b712f2d8207ab0d2d4102a32099587e3c25319e0f97ad`. Não editar migrations 0001–0010 já aplicadas.

O CHECK de tipo e a nulabilidade condicional do título (obrigatório para `aviso`/`evento`, nulo para `chat`) exigem reconstrução da tabela pai. Recriar também os dois filhos em tabelas intermediárias, copiar os registros, remover os filhos antigos antes do pai e renomear; as referências apontam para o novo pai. Não usar foreign_keys OFF, BEGIN/COMMIT explícitos no D1 ou DROP direto do pai. Reações e destino por ID estável seguem os contratos 0030/0031. Código legado sem correspondência mantém loja_id NULL e não deve ser tratado como destino global.

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

## Lote de engenharia: tipagem do runtime e gates

Incorporados o tsconfig Worker strict, declarações PDF com unknown e mocks Node sem any, tsconfig Node strict/checkJs e descoberta automática de módulos da main. O verificador gera os tipos oficiais do Wrangler via configuração temporária sem bindings/credenciais e valida Worker completo, gate V2 adicional noUncheckedIndexedAccess e scripts/testes Node. Mantidos scripts de bloqueio remoto e flags de compatibilidade V2. Ajustes pontuais em auth, guard de escopo, observações e leitores. Scheduler isola falha de manutenção de agendas das limpezas seguintes e registra alerta de volume sem R2.

**Status: gate instalado, NÃO aprovado.** Dependências do repositório e tipos gerados não estão disponíveis no ambiente local desta sessão; não foi executada a compilação integral. A tentativa anterior de `npm ci` foi bloqueada por resposta 403 do registry. Foram corrigidos tipos nos testes de navegação/relatórios e em adaptadores, scripts de benchmark, smoke, retenção, diagnósticos e migrations. O conjunto estrito ainda não foi comprovado; podem restar erros em módulos exclusivos da V2, scripts JS e tipos D1. Não considerar ativar strict como prova de paridade nem desabilitar o gate para aprovar. Nenhum CI ou deploy executado.

## Proteção de digitação durante inclusão incremental

Revisão de integridade identificou que o repositório interno da V2 limpava a marcação de agenda digitada ao incluir novos protocolos. A preparação passa a recusar agenda com marcação geral ou qualquer fornecedor digitado; a atualização transacional repete a condição e falha na constraint de versão, sem limpar marcações. A comparação já sinalizava proteção, mas não substitui o guard de persistência. Nenhuma rota de escrita Nexello foi habilitada. Nenhuma migration já aplicada foi editada.

Validação local: Python sqlite3 com os dez blobs de migrations verificados, consultas exatas de leitura e atualização (SHA-256 36181deafd16848a20cfd6fdf5f09d52624265f1d5b26deb84ac5bd68295ac5d e a29dbe024e8078dd5a0edce1b864c6ccaa5abb913fb7e93aa7a95420292282c0), bloqueio de agenda digitada, fornecedor digitado e versão obsoleta; inclusão em agenda sem digitação e integridade/FK aprovadas. Teste TypeScript integrado de preparação, corrida e rollback adicionado, ainda não executado por dependências ausentes. Sem CI ou alteração remota.

## Concorrência e cadastro de lojas

Portada a suíte de concorrência da main, direcionada às dez migrations V2. Os testes de remoção de loja vinculada e associação a loja removida exigem as rejeições explícitas dos triggers V2, sem flexibilizar a integridade. Corrigido o tratamento 409 de alteração concorrente no PATCH de lojas (estava no POST), preservando o código de conflito comum dos repositórios e o bloqueio de remoção por trigger. O repositório não exige a duplicação do ID no objeto de campos de atualização. Testes integrados ainda não executados; compilação integral depende das dependências locais. Sem CI, deploy ou alteração no D1.

## Lote de ferramentas de build e contratos

Após comparação das diferenças com a main, reaproveitados os blobs de testes CSV/PDF, contratos compartilhados e de autenticação, presença, repositórios e API integrada, além de scripts de build, verificação de artefatos e benchmark PBKDF2. O Vite incorpora a allowlist restrita do WASM, mantendo a denylist padrão. Não alteradas dependências, scripts de deploy ou configurações remotas. Testes HTTP sintéticos legados continuam sendo verificados com ACCESS_MODE desativado e não substituem a cobertura dos perfis V2. O benchmark de agendas agora carrega as migrations reais de `migrations-v2/` e mantém dados sintéticos em SQLite local; não mede Cloudflare D1. Suítes copiadas aguardam execução integral e revisão de expectativas V2.

## Lote de testes de navegador e revalidação local

Portadas suites Playwright de agendas, conferência, diagnósticos, histórico, importação, recebimento, lojas, usuários e canal de Avisos, além da fixture tipada compartilhada e tsconfig web que inclui todos os testes/configuração. Os testes de layout e comportamento originais não foram afrouxados. Auth/navigation e relatório foram ajustados para os contratos V2 e tipados estritamente; ainda falta executar Playwright e revisar suas expectativas em navegador. Demais suites devem ser verificadas contra redesign, permissões, fixtures de sessão e nova navegação. A falha E2E anterior de altura do layout segue pendente de diagnóstico. Nenhum Playwright ou build completo executado neste lote.

Revalidação local em Node 22.16: 12/12 aprovados nos cinco arquivos de testes disponíveis (nexello-comparison-sqlite, nexello-comparison, nexello-lifecycle, v2-avisos-sqlite e v2-report-filters). Os cinco testes e sete arquivos de apoio tiveram hashes Git conferidos com o commit 501767196fec6da9185b749650601101db896b27. tsc 5.8.3 strict/noUncheckedIndexedAccess passou no módulo isolado report-filters. Reexecutada ainda a proteção SQL de digitação com os dez blobs de migrations conferidos, verificando marcação geral, fornecedor, versão stale, integridade e FK. Não equivale ao gate integral; dependências Hono/Zod/Wrangler/Playwright indisponíveis no ambiente desta execução. Nenhuma operação remota no D1, deploy ou CI.

Nova execução neste checkout, em Node 24.22.3: os mesmos cinco arquivos passaram 13/13. A primeira execução revelou que o adaptador SQLite local não implementava `D1PreparedStatement.first(columnName)`; o adaptador e o tipo local foram alinhados ao contrato D1, e o teste agora verifica tanto a linha quanto a coluna selecionada. `git diff --check` também passou. Build, typecheck integral e Playwright continuam bloqueados pela ausência de `node_modules` e cache npm; nenhuma dependência foi instalada, e nenhum CI, deploy ou acesso remoto ao D1 foi executado.

Também executados neste checkout: `npm run test:v2-schema` (2/2 aprovados) e `npm run check:migrations` (gate aprovado, sem migration destrutiva não aprovada). O npm exibiu aviso de configuração legada `http-proxy`; não interferiu nos resultados.

A revisão também encontrou que o CHECK do tipo permitia título nulo em avisos oficiais após o rebuild. A proposta 0011 agora restringe título nulo a mensagens de chat; o hash da proposta foi atualizado acima. A suíte SQLite de Avisos cobre preservação dos campos legados de eventos, chat sem título, rejeição de combinações de título inválidas, reações válidas/inválidas, resolução de destino por ID, isolamento após renomear loja e rollback da reconstrução quando uma instrução posterior falha. Resultado observado após essas asserções: `tests/unit/v2-avisos-sqlite.test.ts`, 3/3 aprovados em SQLite local. Isso não substitui validação no runtime D1 antes de solicitar aprovação para a operação remota.
