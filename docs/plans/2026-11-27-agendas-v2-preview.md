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
