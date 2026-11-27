# Estudo de viabilidade e integridade — sincronização Nexello Organiza

Data: 2026-11-27. PR #260. Status: estudo e cliente/normalizador isolados; **não autorizado para gravação em produção**. Este documento complementa e prevalece sobre hipóteses do plano inicial de integração. O objetivo é substituir o trabalho repetitivo da exportação/importação somente onde for seguro, sem exigir novos relatórios da Nexello, sem serviços pagos, sem cron, sem R2 e sem alterar a API externa.

## 1. Evidências e limites do contrato

Fontes primárias:
- Coleção Postman API v2 – Integração de Clientes fornecida pelo usuário, 33 operações (11 GET, 16 POST, 3 PUT, 3 DELETE). Não versionar a coleção bruta: pode conter credenciais ou valores comerciais. Documentação: https://documenter.getpostman.com/view/10499406/2s9YXmZ1E7.
- Central oficial: https://atendimento.nexello.com.br/kb/pt-br/article/245613/confirmar-solicitacoes (aprovação, pendência, recusa, tipos NF-e, Pedido, CNPJ e CPF, agenda fixa); https://atendimento.nexello.com.br/kb/pt-br/article/261523/agendas-de-recebimento (relatório com protocolo, situação e filtros de datas/filiais; confirmadas, pendentes e canceladas, incluindo recusadas); https://atendimento.nexello.com.br/kb/pt-br/article/242640/exportar-agenda-do-dia (exportação operacional existente); https://atendimento.nexello.com.br/kb/pt-br/article/386074/editar-agendamentos e https://atendimento.nexello.com.br/kb/pt-br/article/530060/alteracoes-na-data-do-agendamento (edições e histórico na interface); https://atendimento.nexello.com.br/kb/pt-br/article/303840/cancelar-agendamento-data-atual (cancelamento e nova solicitação); https://atendimento.nexello.com.br/kb/pt-br/article/604818/release-2-85-0-portal (carga compartilhada quando habilitada).
- Repositório: migrations/0001_init.sql, 0004_manual_appointments.sql, 0008_audit_log.sql, 0024_agenda_import_version.sql; worker/repositories/agenda-imports.ts, agenda-queries.ts; worker/services/agenda-digitacao.ts; shared/agenda.ts, shared/import/parseAgendaBatch.ts; fixture sanitizada tests/fixtures/agenda-todas-lojas-com-doca-sanitizada.csv.
- Diagnósticos: 45992407786 (campos); 45993328740 (formatos, filtro experimental falhou); 45994038780 (volume); 45994758979 (duplicatas e cruzamentos); 45996265913 (catálogo integral e NF-e, em execução no momento da redação). CI 45994856265 verde para 55afca8e80a3964318be65b57711ace8b6de4c0c.

API oficial HTTPS /integracao/api/v2. Bearer obrigatório; 30 requisições/minuto documentadas, escopo/expiração/custo e semântica de rate limit não comprovados. Relatórios: GET /relatorio-personalizado/consultas e GET /relatorio-personalizado/{id}?limit=100&page=1. Só limit/page documentados; não inventar parâmetros de filtro. A tentativa data=... retornou HTTP 500. Não há GET documentado de estado/histórico de agenda por protocolo, criação de consulta personalizada ou webhook. Não usar POST /agendamentos/atualizar-situacao (presença A/P/O e cancelamento): altera produção. GET etapas-disponiveis descreve etapas, não o estado individual. Rotas de pedidos são de importação, não consulta de agenda. Consulta NF-e é centrada em notas, permite data_solicitada, data_agendada, data_emissao; exemplos mostram paginação 30 apesar de texto dizer 25, e status C com situação Sem solicitação; status S/X/C/N é da nota, não da agenda. A rota individual tem URL igual à listagem na coleção e exemplo com XML; não utilizá-la. Não tratar NF-e como autoridade do ciclo de vida de agenda.

O manual do Organiza documenta operações e filtros na interface, **não** garante que as consultas personalizadas reproduzam a semântica dessas telas. A existência do relatório de agendas de recebimento não prova existir endpoint público para ele.

## 2. Evidência empírica e seleção de fontes

| Relatório | Papel | Limitação |
| --- | --- | --- |
| 60 | Candidato principal, protocolo, filial, fornecedor, data, intervalo, tipo, NF-e/pedidos | Sem estado explícito, doca, itens, volumes, paletes, carga batida; cobertura e identidade ainda não comprovadas |
| 30 | Quantidades/comparecimento | Sem protocolo na amostra; 36938 linhas / 370 páginas |
| 1 | Docas e horários | Sem protocolo na amostra; 227994 linhas / 2280 páginas |
| 27 e 57 | Agregados operacionais | Sem identidade individual; não reconciliar agendamento |
| NF-e | Evidência complementar de estado de nota | Não cobre Pedido/CNPJ/CPF/Agenda fixa e não equivale ao estado da solicitação |

Execução 45994038780: 1031 linhas, 11 páginas, 26 datas, 182 linhas do dia, 849 de dias futuros, 84 sem código inequívoco. A execução seguinte 45994758979: 1031 linhas / 1019 protocolos, 12 grupos repetidos, 10 com mesma identidade (data/intervalo/filial/fornecedor/tipo), 8 com linhas idênticas e 3 com documentos divergentes; 2 grupos com identidade divergente. Todos os 84 registros sem código correspondiam a CD. Não inferir remarcação a partir de duplicidade. Não somar os grupos como disjuntos: métricas se sobrepõem. Variação entre leituras evidencia fonte mutável; paginação coerente não equivale a snapshot transacional.

Amostras primeira/última página de 1 e 30: respectivamente 14 e 56 chaves coincidentes e únicas nos dois lados (data, intervalo, filial, fornecedor), sem ambiguidades nessa pequena interseção. Isto **não prova vínculo**, unicidade global nem cobertura. Não utilizar essa chave como identidade para gravação. Não percorrer históricos; nem tentar burlar limites. Enriquecimento automático só após chave de identidade compartilhada, estável, com semântica comprovada; caso contrário manter campos desconhecidos e CSV como fonte de complemento. Doca nunca inferida por horário ou nome do fornecedor.

## 3. Identidade e ciclo de vida — requisito central

O D1 atualmente tem UNIQUE(loja_id,data_agenda) em agendas, UNIQUE(agenda_id,protocolo) em agendamentos e status operacional aguardando/recebido/nao_chegou/recusado. Protocolo não é globalmente único por constraint; origem importado/manual não distingue arquivo de API. Não adicionar UNIQUE global, nem migrar dados históricos, até comprovar identidade de ocorrência. A mesma chave de documento pode integrar mais de uma agenda; CNPJ e pedido não são identificadores globais de agenda. Protocolo do Organiza precisa ser confrontado com CSV e com casos de mudança. Consultar candidatos locais também em outras datas e lojas, de forma indexada, e sinalizar múltiplos resultados. Se necessário, migração aditiva e pequena para índice de protocolo e metadados de origem/identidade; justificar com EXPLAIN, preservar compatibilidade e dados. Sem migração nesta etapa.

Distinguir estado externo da solicitação (pendente/confirmada/cancelada/recusada/desconhecida) do status operacional Prado. Reagendamento é evento, não necessariamente estado terminal. Recebimento/finalização, cancelamento e recusa são conceitos distintos. Não mapear status NF-e ou comparecimento ao status operacional local sem decisão independente e autorização.

| Evento | Regra proposta | Evidência necessária |
| --- | --- | --- |
| Novo confirmado | Incluir aguardando após revisão | estado confirmado ou paridade com lista oficial de confirmadas |
| Novo pendente/recusado/cancelado | Não incluir | estado explícito ou exclusão comprovada da lista vigente |
| Mesmo protocolo, mesma identidade e conteúdo | No-op | equivalência canônica |
| Horário ou documentos alterados | Revisar e atualizar somente campos conhecidos | identidade comprovada; sem sobrescrever conferência; check de digitação fica desatualizado se dados mudarem |
| Data alterada, protocolo igual | Propor transferência, origem e destino juntos; se não conferido e identidade comprovada | observação antes/depois; atomicidade nas duas agendas |
| Reagendamento gera novo protocolo | Tratar como dois eventos independentes até prova do vínculo; mostrar antigo ausente e novo confirmado | histórico/relação oficial ou confirmação explícita; nunca casar por nome/horário |
| Alteração de filial/doca | Conflito para revisão; transferência somente com destino inequívoco e permissão | identidade, filial/doca e auditoria |
| Reagendamento pendente | Não assumir que anterior permanece ou deixa de estar válido | validação por tipo e situação no Organiza |
| Ausência do relatório | Sinalizar não localizado, não inativar | pode ser saída do horizonte, falha, cancelamento, recebimento ou mudança de escopo |
| Cancelado explicitamente | Propor inativação sem apagar histórico; se conferido ou dia concluído, bloquear revisão automática | estado explícito e vínculo inequívoco |
| Reaparecimento/inativo | Revisão, não reativar automaticamente | estado vigente e motivo anterior |
| Manual/recebido/recusado/não chegou/conferido | Preservar; conflitos bloqueiam mudanças destrutivas | regras locais e auditoria |
| Carga compartilhada, agenda fixa recorrente, encaixe | Não colapsar por fornecedor/CNPJ/documento; tratar ocorrência por ocorrência | identificação e configuração da empresa |
| CPF/tipo desconhecido | Bloquear e sinalizar, não mapear para CNPJ silenciosamente | manual oficial menciona CPF; confirmar existência real e compatibilidade do schema |

Em transferências aprovadas, não apagar o registro anterior: escolher entre mover ID preservando histórico (verificar repercussão em consultas/auditoria) ou inativar antigo e criar vínculo explícito com novo; decisão só após análise de integridade, sem duplicação ativa. Auditar data/filial anterior e nova, usuário, motivo e identificador. Rever relatório gerencial, contagem e digitação nas duas agendas. Dia concluído não deve ser reaberto automaticamente. Conferência local feita depois da prévia não pode ser sobrescrita na confirmação.

## 4. Validação real, sem depender de alteração da Nexello

A prova mais forte disponível é exportar CSV de **Relatórios > Agendas de recebimento** com as situações e o mesmo intervalo das consultas, além do CSV de **Gestão > Agendas** usado atualmente. Incluir protocolo, tipo, filial, datas solicitada/agendada, situação, e, se disponíveis, comparecimento/cancelamento. Exportar todos os estados para o mesmo período/filiais, não apenas aceitas; anotar instante local. Para casos de reagendamento, observar operações normais de negócio antes/depois (não criar, cancelar ou editar registros de produção só para testar). Usar dados sanitizados, protocolo pseudonimizado consistentemente quando necessário; manter confronto de dados reais localmente, não postar chaves/documentos/fornecedores nos logs e não versionar arquivos. Homologação exclusiva exige Nexello; não presumir disponível. Não usar credenciais reais em HTTP.

Matriz de validação real:
- Aguardando, confirmado, cancelado pelo fornecedor, cancelado pelo cliente, recusado, recebido/finalizado, não compareceu, reagendamento solicitado ainda pendente, confirmado após remarcação, remoção de documento, mudança de doca, mudança de filial se suportada.
- Cobertura dos quatro tipos aceitos atualmente (Nota fiscal, Pedido, CNPJ, Agenda fixa), CPF se ocorrer, agenda interna/encaixe, múltiplas notas/pedidos, carga compartilhada se habilitada.
- Para cada caso: estado no relatório da interface, presença ou ausência no 60, protocolo anterior/posterior, datas e filial, documentos, instante de comparação. Incluir caso que passa de hoje para amanhã e caso que sai do horizonte. Uma observação não prova contrato geral.
- Medir falsos positivos e falsos negativos: por situação, tipo, filial e dia, comparar conjuntos de protocolos e campos com a lista oficial de confirmadas; divergência exige investigação. Não liberar importação automática de confirmados se o teste não diferenciar pendentes/cancelados. Não liberar inativação por ausência mesmo após amostra bem-sucedida sem comprovação de completude e vigência.
- Quando fonte não permite distinguir estado: modo assistido de prévia com conferência da lista oficial ou manter importação atual. O CSV de estados pode servir como evidência manual complementar; não apresentar como sincronização automática completa. Dois snapshots iguais não garantem estado real.

## 5. Arquitetura simples, transações e concorrência

Botão manual -> escopo data/filial -> leitura integral limitada do 60 (se limite comprovado) -> normalização e validação -> comparação somente leitura com D1 -> prévia explícita de novos, alterados, iguais, ausentes, conflitos e registros excluídos -> confirmação autenticada -> db.batch atômico -> auditoria -> realtime. Não criar cron, KV, R2, serviços pagos ou integração de escrita Nexello. Não usar API para substituir integralmente um CSV. CSV/PDF permanece disponível e tem prioridade para campos indisponíveis; manter histórico de proveniência, sem apresentar CSV antigo como informação atual quando campos autoritativos mudaram. Não limpar csv_campos; revisar apresentação de origem e validade.

A aplicação atual usa appendAgendaReplaceStatements para sobrescrever todos os campos da importação e inativar ausentes; portanto não reutilizar essa semântica. Compartilhar SQL de inserção, transações, auditoria e publicação, com operação incremental específica e explícita. Não mudar contratos das rotas atuais. Quantidades/carga ausentes: null para novos; preservar existentes; não representar desconhecido como zero. NF-e/pedidos vazios só substituem valores se representação de remoção estiver demonstrada. Dados do relatório não consumidos hoje não persistir.

Prévia vinculada ao administrador/sessão, escopo, conteúdo canônico e versões locais; prazo curto; não confiar em dados editáveis pelo navegador. Revalidar conteúdo e estado antes de gravar; se fonte mudar, solicitar prévia nova. Comparar versão de importação de todas as agendas afetadas, também na transação (migration 0024), com proteção contra criação simultânea pela UNIQUE. Esta versão **não** muda quando há conferência/manual; adicionar precondições atômicas para estados operacionais e conflitos, não só versão. Sem escrita parcial silenciosa. Se unidade inteira não couber, rejeitar e solicitar escopo menor, ou desenhar nova unidade explícita de transação; transferência nunca dividida. Realtime só pós-commit, falha de publicação tratada separadamente. A digitação por fornecedor usa hash de documentos, horários, quantidades e csv_campos, de modo que alterações legítimas podem invalidar marcação; preservar auditoria, sinalizar necessidade de revisão e não transportar check para outra agenda automaticamente.

## 6. Limites, segurança, operação e testes

Cloudflare Workers Free: 50 subrequests externos, 10 ms CPU por HTTP (https://developers.cloudflare.com/workers/platform/limits/); D1 limites separados (https://developers.cloudflare.com/d1/platform/limits/). Aguardar rede não consome CPU; normalização e hashing consomem. Teto inicial 15 páginas x 100, com validação de page/per_page/last_page/total, comprimento, duplicidade e consistência. 30 requisições/minuto da Nexello: serializar/limitar no sistema, inclusive confirmações e concorrência; não usar rate limit apenas por instância isolada; medir com infraestrutura existente antes de escolher mecanismo. Evitar segunda leitura imediata de 15 páginas se exceder orçamento. Caso CPU/volume inviável, manter fallback ou propor fluxo manual paginado com estado protegido, sem persistência parcial; não pressupor que CI local reproduza limites do serviço. Avaliar tamanho de corpo, contagens, timeout, abort, retry explícito limitado, 429, 401/403, 5xx, JSON inválido, dados malformados e alteração durante paginação. Sem logs de token/headers/corpos. Token separado no Worker, HTTPS fixo sem redirects, admin/CSRF, configuração opcional; credencial somente leitura se fornecedor permitir. Rotação/revogação documentadas. Remover workflow temporário antes de merge.

Testes sintéticos obrigatórios: todo ciclo de vida acima; nulos, vazios, duplicidades idênticas e divergentes, datas inválidas, intervalo invertido, timezone, documento com zeros, tipos, loja inexistente, CD sem doca; todas as páginas, mudança de metadados, cap, timeout, concorrência entre importações CSV/API e conferência; rollback D1, versões, idempotência, ausência sem exclusão, transferência atômica, auditoria, relatórios/digitação/realtime, regressão CSV/PDF; segurança/CSRF/segredo não exposto. CI, CodeQL, testes locais D1 e Worker, dry-run sem deploy. Não tocar D1 remoto de preview/produção. Checar compatibilidade com #257 e main atual.

## 7. Marcos de liberação

- [x] Coleção original, código, schema e documentação operacional revisados.
- [x] Conectividade e autenticação; catálogo inicial; campos e formatos; volume e duplicidade; amostras de complementares.
- [x] Cliente e normalizador isolados; CI 45994856265 verde no commit 55afca8. Não equivale a aprovação da integração.
- [ ] Resultado do diagnóstico dos oito relatórios e NF-e (45996265913).
- [ ] Comparação com relatório de estados/agenda do dia; prova de aceitação e cobertura por tipo e situação.
- [ ] Identidade/reagendamento e CD resolvidos (ou exclusões explícitas com contingência); decidir se CPF ocorre; comprovar origem de enriquecimento ou manter desconhecido.
- [ ] Prévia somente leitura, testes, medição de CPU e orçamento; sem dados escritos.
- [ ] Persistência incremental, conflitos, proteção contra concorrência operacional e auditoria; testes sintéticos completos.
- [ ] Validação de operação assistida com dados autorizados; se ciclo de vida não puder ser demonstrado, limitar a modo assistido ou manter CSV/PDF.
- [ ] Remover workflow temporário, CI final verde, revisão de diff, autorização explícita para merge.

**Decisão de segurança:** autenticação bem-sucedida e coincidência de campos não bastam para autorizar sincronização de produção. A lacuna mais importante é estado e identidade ao longo do tempo, não a falta de itens/volumes. Não inventar contrato nem forçar automação plena. Nenhum deploy ou escrita em Nexello/D1 é parte deste estudo.
