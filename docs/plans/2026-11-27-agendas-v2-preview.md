# Agendas Prado V2 — ambiente preview

Branch de trabalho: feat/v2-nexello-preview; base preview (5447c669). Produção main intocada. Esta PR inicia a V2, não é uma versão implantável. A PR #260 é referência do estudo; não mesclar na main por causa da V2.

## Decisões
- Novo Worker e novo D1, ambos sugeridos como agendas-pradosm-v2; UUID real a ser informado após criação pelo responsável. Configurações remotas desta branch usam UUID reservado não real, sem cron, realtime desligado; scripts npm de deploy/migrations remotas falham de forma explícita. Não executar Wrangler remoto diretamente. Não alterar main, banco antigo ou recursos Cloudflare.
- Reaproveitar autenticação, permissões, UI React, testes, auditoria e regras de conferência onde maduros. A preview diverge da main: auditar diferenças de segurança, acesso, relatórios, R2 legado e demais features antes de portar; nenhum R2 será configurado na V2.
- Cliente GET e normalizador testados na PR #260, copiados sem workflow com token real. Relatório 60 não prova situação; modelo de domínio separa estado externo de estado operacional. Não inventar estados nem docas. Tipos Pedido, NF-e, CNPJ e Agenda fixa, CPF se comprovado; não exigir NF-e para os demais.
- A V2 nasce sem dados de produção. Manter o CSV/PDF como contingência enquanto a API não tiver paridade; nenhum deploy até o schema e os critérios de operação estarem aprovados. Segredos SESSION_SECRET novo e NEXELLO_API_TOKEN configurados apenas no Worker novo, nunca versionados.

## Modelo candidato (não é migration executável)
| Entidade | Responsabilidade |
| --- | --- |
| lojas / docas | Identidade local e mapeamento externo explícito; CD sem doca não adivinhada |
| usuarios / sessoes / acessos | Segurança, escopo e revogação |
| agendas | Agrupamento operacional por loja/doca/data; unicidade |
| agendamentos | ID interno estável, protocolo externo não presumido globalmente único, intervalo, fornecedor, tipo, documentos, quantidades nullable |
| estado externo | desconhecido, pendente, confirmado, cancelado, recusado; evidência e data da observação |
| estado operacional | aguardando, recebido, não chegou, recusado, observações e trocas; independente do externo |
| auditoria / historico | eventos de mudança, origem/destino, usuário, antes/depois, vínculo de ocorrências comprovado |
| sincronizacoes | execução manual, escopo, resultado, contagem, conflitos, hash e versão; sem payload sensível bruto |
| digitacao / avisos | preservar comportamento e revisar efeitos de transferência |

Antes de congelar schema inicial: validar identidade/reagendamento (protocolo igual/novo), situação e horizonte, carga compartilhada, CD, dados desconhecidos, CPF. Preferir tabelas mínimas, constraints, índices por identidade/loja/data, FK, transações e histórico; não impor unicidade global prematuramente. A base local V1 continua funcionando para testes; não aplicar migrations legadas no D1 novo até baseline V2 completo revisado. Projetar schema do zero sem reescrever os módulos que não dependem das agendas.

## Plano em lotes
1. Isolamento e domínio: configurações bloqueadas, cliente/normalizador, classificação pura somente leitura (feito nesta PR). CI e regressão.
2. Auditoria de divergência main/preview; inventário de funcionalidades e permissões, remover R2 legado apenas na V2, garantir paridade de segurança. Validar fontes reais com exportação de estados do Organiza; manter pontos desconhecidos explícitos. Sem escrita Nexello.
3. Baseline D1 novo consolidado, testes SQLite/D1 local, chaves, integridade, concorrência, auditoria, autenticação e seeds sintéticos; migração da V1 não necessária no preview. Validar limites gratuitos.
4. Consultar/paginar 60 com teto e rate limit, classificar duplicidades/confirmação, prévia por dia/filial, resolver CD; fonte de estado autorizada ou revisão assistida. Sem cancelamento por ausência. Revisão de protocolos entre datas/lojas; conflitos com conferência e dia concluído.
5. Persistência transacional incremental, idempotência, transferência segura, preservar informações locais e campos ausentes, invalidação de digitação quando aplicável, realtime pós-commit. Não liberar até evidência ou confirmação humana.
6. UI completa de administração, loja, conferência, histórico e relatórios; testes de regressão, segurança, carga e limites. Manter experiência visual e acessibilidade.
7. Provisionamento exclusivamente do novo Worker/D1, segredos independentes, liberar scripts só com guardas de identidade; D1 novo a partir do schema aprovado. Teste operacional isolado; CI verde e autorização antes de merge na preview/deploy. Eventual migração para produção é outro projeto/PR com aprovação explícita.

O módulo nexello-lifecycle é uma primeira classificação conservadora, não identidade persistente nem autorização de mudança. Dados do relatório 60 entram como unknown. Candidatos de atualização, transferência e cancelamento só são possíveis com evidência explícita e ainda exigem validação independente. Ausência jamais é cancelamento.

## Política temporária de CI (decisão do responsável)
Durante a reconstrução, os pushes e PRs para preview não disparam o CI geral. Os gatilhos de main permanecem e workflow_dispatch permite a validação final. Não desabilitar testes, checks de segurança ou a exigência de aprovação. Antes de liberar a V2, executar o CI integral no commit final e restaurar os gatilhos de preview quando for apropriado; nenhum merge na main sem autorização explícita. Usar testes locais focados durante os lotes quando disponíveis.

## Lote de fundação D1 e consulta isolada
Baseline candidato em migrations-v2/0001_baseline.sql e 0002_nexello.sql, sem histórico de alterações V1 no novo D1. Schema preserva contratos existentes e acrescenta sincronizações, evidência de estado externo e destinos explícitos. Ambiente local novo, UUID sintético separado, estado mock-state-v2; bootstrap remoto bloqueado. A pasta migrations antiga permanece como referência de testes de regressão. Teste v2-schema verifica paridade de objetos/colunas e integridade; execução ainda pendente. Não aplicar no D1 remoto antes da validação.
A rota /api/admin/nexello/config e POST /api/admin/nexello/pages/:page oferecem somente leitura de página, restrita ao administrador integral, sem gravação e sem estado inventado. A habilitação exige NEXELLO_READ_MODE=on, segredo e limitador próprio. A configuração permanece desligada/ausente. Rate limiter Cloudflare não garante cota global entre regiões; validar orçamento antes de habilitar acesso real. A tela não representa um snapshot e não é a sincronização completa. CI geral adiado a pedido do responsável; testes permanecem no repositório.

## Perfil Digitador (decisão do responsável)
Perfil efetivo adicional, cadastrado pelo administrador integral no editor de acessos. Permissões operacionais equivalentes às do administrador, exceto lojas, usuários, logs/diagnósticos, auditoria e retenção (esta última exclusivamente administrativa por segurança). A leitura de lojas para filtros operacionais continua permitida. Exceções não podem conceder áreas bloqueadas. Ações continuam auditadas. O perfil padrão pode operar todas as lojas; escopo restrito é suportado pelo mecanismo existente. Nexello exige escopo global e permissões de importação, pois relatório 60 não filtra por loja. A consulta continua desabilitada até configuração explícita. O Agendador foi removido por decisão do responsável; apenas Administrador, Digitador, Visualizador e Conferente são admitidos na V2. Migrations antigas permanecem como registro histórico da V1. Nenhuma conta antiga será migrada automaticamente para Digitador. ACCESS_MODE habilitado nas configurações executáveis V2; papel físico de segurança permanece visualizador inativo para contas personalizadas. O baseline novo contém Digitador; não aplicar sobre banco V1 ou sobre um baseline V2 anterior já criado sem planejar atualização. Seed fictício V2 inclui digitador.mock. Testes de autorização e integração ficam pendentes de execução no CI final.

## Comparação de leitura por página
A consulta agora confronta protocolos da página com registros locais usando uma consulta parametrizada de até 100 protocolos, limitada a 500 correspondências (acima disso falha sem resultado parcial). Diferencia campos coincidentes/divergentes, múltiplas ocorrências locais, conflitos dentro da página, registros operacionais protegidos e filial não identificada. Não prova identidade, estado externo, completude ou cancelamento. Não escreve no D1 nem Nexello. Testes sintéticos adicionados, execução pendente. A próxima etapa exige evidência de estado externo e revisão humana antes de qualquer persistência.

## Limite global da leitura Nexello
Substituído o limitador regional opcional pela reserva atômica no próprio D1 (0003_nexello_rate.sql), com intervalo de quatro segundos entre inícios de chamadas da V2 e relógio do banco. Reserva falha fechada e não é devolvida em erro de transporte. HTTP 429 em concorrência; o limite de 30/min da Nexello também pode ser consumido por outros aplicativos e diagnósticos, portanto não garantimos cota global fora da V2. A única escrita da consulta é o registro técnico de reserva, nunca agendas. Sem serviço pago, sem token no banco, sem habilitação remota. Testes de concorrência e falha fechada adicionados, pendentes de execução.

## Revisão de todas as páginas
A interface passa a percorrer sequencialmente até 15 páginas, com intervalo local de 4,5s e reserva atômica D1. Cancelamento encerra a sequência, não desfaz chamadas já iniciadas; falha descarta todo o resultado parcial. Verifica número, total, contagem e ordem das páginas; alterações silenciosas com mesmas contagens continuam possíveis, portanto não se chama snapshot. Duplicidades divergentes entre páginas e variação da comparação local são sinalizadas antes dos filtros por período/filial. Linhas inválidas são mantidas, e duplicidades exatas não são apagadas. Dados ficam em memória na tela, não são persistidos. Sem gravação operacional. Testes sintéticos pendentes de execução.

## Retenção e capacidade sem R2
A V2 não tem binding R2 nem rotina de exportação/purga de histórico ou auditoria. As rotas administrativas de retenção mantêm o contrato de contagens e sinalizam registros antigos para revisão, sempre com zero exclusões/exportações. A estimativa por linhas é apenas um alerta, não mede bytes do D1. Diagnósticos técnicos e sessões expiradas continuam com sua limpeza própria. Nenhuma política de exclusão de dados operacionais será introduzida sem autorização e método de recuperação validado. O baseline foi comparado estaticamente às migrations legadas; a execução do SQLite/D1 e a equivalência completa de constraints continuam pendentes de teste. Ajustes de tipagem nas respostas D1 de comparação/reserva falham fechados se metadados estiverem ausentes.
