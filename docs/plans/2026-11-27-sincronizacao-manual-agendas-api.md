# Sincronização manual de agendas via API

Status: descoberta autenticada concluída; contrato funcional do relatório ainda em validação. Implementação de escrita bloqueada até os critérios de entrada da fase 2.

## Objetivo e escopo
Permitir ao administrador consultar a plataforma de origem a partir da tela de importação, escolher data/lojas, revisar inclusões, alterações e cancelamentos e confirmar a gravação. Manter CSV/PDF como contingência. Não adicionar cron, R2, dependências ou serviços pagos. TypeScript estrito, validação Zod e infraestrutura existente.

Referência: https://documenter.getpostman.com/view/10499406/2s9YXmZ1E7 (API v2 - Integração de Clientes). Coleção Postman v2.1 recebida e analisada. Diagnóstico autenticado em 2026-11-27: https://github.com/joaoldsxyzbr/agendas-pradosm/actions/runs/45992407786 (sucesso). Nenhuma credencial ou valor comercial foi registrado.

## 1. Descoberta obrigatória antes de implementar
- Identificar endpoint(s) de consulta, método HTTP, host oficial, autenticação, expiração/renovação, escopos de leitura, limites e condições comerciais.
- Confirmar filtros de data, fuso, filial, paginação e semântica de snapshot completo versus incremental; distinguir resposta vazia válida, erro e resultado parcial.
- Confirmar identificador estável do agendamento, unicidade, remarcações entre datas/lojas, cancelamentos e mapeamento de cada campo usado hoje (protocolo, horários, fornecedor, itens, volumes, paletes, carga batida, tipo, NFe, pedidos).
- Obter exemplos sanitizados de sucesso, vazio, cancelamento, paginação e erros. Nunca versionar credenciais ou dados reais de produção.
- Verificar limites do Worker/D1 e API para o volume real; definir escopo máximo por operação. Não assumir que o plano gratuito suporta qualquer volume.

## 2. Arquitetura proposta
Fluxo: administrador -> Worker -> API externa (somente leitura) -> normalização e validação -> prévia -> confirmação -> D1 -> publicação realtime.
- Cliente externo exclusivamente no Worker, host fixo validado, Secrets para credenciais, timeout e limites de resposta/páginas; não aceitar URLs do navegador nem expor tokens, cabeçalhos ou corpos sensíveis em logs.
- Adaptador específico após confirmar contrato, convertendo resposta validada para tipos compartilhados de importação. Evitar abstrações genéricas para provedores inexistentes.
- Extrair/reutilizar orquestração da importação existente onde necessário, sem duplicar persistência. Referências: shared/agenda.ts, shared/import/validateImportBatch.ts, worker/routes/admin-agendas.ts, worker/repositories/agenda-imports.ts, apps/web/src/features/import/import-model.ts.
- Rotas administrativas autenticadas, com autorização/CSRF equivalentes às rotas existentes. Prévia sem gravação; confirmação vinculada ao usuário, escopo e versão/conteúdo revisado, sem confiar em payload externo editável pelo cliente. Se houver alteração concorrente da agenda ou da fonte entre prévia e confirmação, rejeitar e solicitar nova prévia.
- Validar o lote inteiro antes de gravar. Reutilizar transação D1, versão de importação, auditoria e publicação realtime; avaliar limite existente de 800 statements e limites efetivos do plano. Não prometer atomicidade global se houver divisão em lotes; neste caso definir e comunicar unidade atômica antes de implementar.
- Interface na tela existente: data (fuso de negócio), loja/todas, botão Sincronizar agendas, estado de carregamento, resumo de diferenças, confirmação e resultado. Manter importação de arquivos intacta. Desabilitar integração de modo explícito quando não configurada; sem novos segredos obrigatórios para deploys existentes.

## 3. Integridade e regras operacionais
O repositório atual inativa registros importados ausentes em uma substituição; NÃO encaminhar uma resposta paginada incompleta ou incremental para essa rotina como snapshot. Só permitir inativação por ausência se completude e semântica do fornecedor estiverem comprovadas e o operador confirmar. Vazio inesperado, falha de página, loja desconhecida, campo inválido, identificador duplicado, timeout ou inconsistência devem bloquear gravação. Cancelamento e remarcação de registros já conferidos exigem regra explícita e revisão; não apagar histórico.
- Preservar IDs, status, observações, trocas, conferência, registros manuais e auditoria local; não sobrescrever campos operacionais com dados externos.
- Verificar correspondência com protocolos já importados por arquivo. Se identificadores divergirem, bloquear conflito até definição de mapeamento/migração, sem criar duplicatas.
- Repetir a mesma sincronização não deve alterar dados/versão sem necessidade nem criar duplicatas; auditar o acionamento conforme política existente.
- Proteger confirmação simultânea e concorrência com importação manual. Publicar mudanças somente após commit; falha de notificação não deve ser relatada como rollback se D1 já confirmou.
- Não fazer escrita na plataforma externa. Não executar consultas de produção sem configuração/autorização.

## 4. Implementação e validação (checklist)
- [ ] Contrato da API e exemplos confirmados; mapeamento de identidade, filial, datas, cancelamentos e custos revisado.
- [ ] Cliente/adaptador estrito e testes com respostas fictícias.
- [ ] Prévia e confirmação protegidas; reutilização do fluxo de persistência.
- [ ] UI e testes de regressão da importação CSV/PDF.
- [ ] Testes: dados inválidos, 401/403, 429, 5xx, timeout, paginação interrompida, resposta vazia, duplicidade, remarcação/cancelamento, repetição, concorrência, preservação de campos locais, rollback e realtime.
- [ ] Testes locais com D1 local e fixtures sanitizadas; nenhuma escrita em D1 remoto de preview ou produção.
- [ ] Revisar compatibilidade com hardening #257 (aberta na data desta proposta); atualizar branch com main após alterações relevantes e resolver conflitos.
- [ ] CI completo verde, revisar diff e impacto de deploy; testar credencial de leitura autorizada em ambiente apropriado.
- [ ] Merge somente com autorização explícita.

## 5. Operação e reversão
Documentar configuração de Secrets sem valores, erros seguros, forma de desativar a integração e contingência CSV/PDF. Preferir nenhuma migração de banco se o contrato permitir; qualquer migração deve ser justificada, aditiva e revisada. A implantação inicial não deve ativar sincronização automática nem remover a funcionalidade atual.

A branch contém também um workflow temporário de diagnóstico, limitado a GET no host oficial e à própria branch. Removê-lo antes do merge; não é parte da integração de produção. Nenhum código da aplicação, configuração de produção ou banco foi alterado.


## 6. Descoberta autenticada e decisão arquitetural (27/11/2026)

Base HTTPS oficial: https://integracao-organiza.nexello.com.br/integracao/api/v2/relatorio-personalizado/
GET consultas lista os relatórios autorizados; GET {id}?limit=2&page=1 foi confirmado com o Secret NEXELLO_API_TOKEN do GitHub. Limite documentado 30 requisições/minuto; paginação padrão 100. Catálogo com oito relatórios, cinco candidatos. Totais abaixo são metadados observados nesse instante, não contagens verificadas de todo o histórico.

| ID | Total informado | Campos relevantes observados (amostra de 2) |
| --- | ---: | --- |
| 1 | 227990 | data_agenda_inicio, data_agenda_fim, doca, entidade_remetente, filial |
| 27 | 2311 | data, agendamentos_do_dia, presentes, ausentes, itens, volumes, paletes |
| 30 | 36935 | agendado_para_inicio, agendado_para_fim, fornecedor, filial, cnpj_cpf_fornecedor, comparecimento, numero_pedidos, qtd_itens, qtd_volumes, paletes |
| 57 | 1390 | dia, filial, cancelados_cliente, cancelados_fornecedor, total_agendamentos, presentes, ausentes |
| 60 | 1027 | protocolo, data_agenda_inicio, hora_agendada, filial_entrega, fornecedor, fornecedores, cnpj_fornecedores, codigo_fornecedor, nfe_numeros, numero_pedido, tipo, transportadora |

**Candidato principal: relatório 60**, por oferecer protocolo e documentos. Não assumir unicidade global, granularidade por protocolo, cobertura de todas as lojas, período ou status. Os relatórios 1 e 30 não demonstraram protocolo na amostra: não fazer junção aproximada por fornecedor/horário. Se necessário, solicitar à Nexello um único relatório completo com protocolo e os campos que faltam. ID configurável no Worker, validado por catálogo/contrato na implantação.

### Mapeamento preliminar (não é contrato final)
- protocolo -> protocol: converter inteiro seguro para string, verificar correspondência exata com CSV e regra atual de 6–20 dígitos; preservar zeros se fornecidos em texto.
- filial_entrega -> storeCode: testar formatos e correspondência exata, incluindo CD DOCA; não adivinhar filial nem criar lojas automaticamente.
- data_agenda_inicio e hora_agendada -> date/startTime: verificar formatos e fuso de negócio, sem inferir horário final.
- fornecedor/fornecedores -> supplier: confirmar granularidade e seleção correta (inclusive múltiplos fornecedores).
- nfe_numeros, numero_pedido -> nfe/orders: confirmar separadores, nulidade e preservação de zeros.
- tipo -> type: mapear somente valores comprovados para os quatro tipos aceitos pelo schema.
- Lacunas: endTime é obrigatório e deve ser posterior a startTime; relatório 60 não mostrou fim explícito. Itens, volumes, paletes e carga batida são nullable mas não podem ser preenchidos com zero fictício nem sobrescrever dados conhecidos por ausência de campo. Doca e situação/cancelamento não demonstrados. Confirmar formato de hora_agendada (pode conter intervalo, mas não foi inspecionado). Buscar paridade com CSV antes de ativar importação.
- Se o relatório não oferecer campos suficientes, pedir ajuste ao fornecedor; não alterar schema de produção para mascarar incompatibilidade.

### Fases e critérios de entrada/saída
1. **Contrato (próximo lote)** — diagnóstico somente leitura, limitado e sanitizado: verificar formatos sem imprimir valores reais, cardinalidade de protocolos e documentos, cobertura por filial/data, horário final, docas, quantidades, tipo, estado/cancelamentos/remarcações. Confirmar com Nexello nomes exatos dos filtros server-side, ordenação estável/paginação, semântica de ausência, escopo do token, homologação e custo. Não supor que parâmetros desconhecidos são aplicados: filtro ignorado deve ser detectável. Comparar com fixture CSV sanitizada ou comparação local autorizada de um mesmo dia. Sem filtro confirmado, não varrer histórico; eventual snapshot pequeno e limitado exige decisão explícita e prova de completude. Não usar os totais atuais como limite contratual.
2. **Cliente e normalização (sem escrita)** — implementação TS estrita no Worker; host fixo HTTPS, sem redirecionamentos, timeout, tamanho máximo, paginação limitada e validação de consistência. Não registrar payload/token. Respeitar 30/min e limites Cloudflare; erro explícito para 429/401/403/5xx, sem repetição ilimitada. Testes com fixtures fictícias. Saída compatível com ImportAgendaBatchInput. Não duplicar parser de CSV.
3. **Prévia e confirmação** — na tela Importação, data e loja/todas, botão Sincronizar agendas, resumo de novos, alterações, iguais, conflitos e avisos. Proposta: confirmação curta vinculada à sessão, ao conteúdo validado e às versões locais; se necessário reconsultar a fonte e comparar o conteúdo. Verificar concorrência na própria operação atômica, inclusive criação simultânea. Não aceitar alteração de payload pelo cliente. Na primeira versão, não inativar automaticamente registros ausentes; cancelamento/remarcação ficam bloqueados para revisão enquanto contrato não demonstrar semântica. Sem gravação parcial silenciosa.
4. **Persistência e regressão** — serviço compartilhado com importação atual onde apropriado; atualização por identidade estável dentro de loja/data, preservar IDs, status/observações/trocas/conferência, registros manuais e campos locais; atualizar somente campos autoritativos da fonte. No-op real se não mudou. Validar limites atuais de 50 agendas/lote, 500 agendamentos/agenda, 700/lote e orçamento de 800 statements, além dos limites reais do plano. Se não couber, rejeitar operação e orientar seleção menor; não adicionar serviços pagos. Testes concorrentes, falhas de página e transação, remarcação, campos ausentes, duplicidade, atualização realtime pós-commit, CSV/PDF inalterados.
5. **Entrega** — ativação opcional por configuração de servidor; Secret do GitHub serve exclusivamente ao diagnóstico, configurar Secret separado no Worker para produção pelo responsável. Não exigir segredo novo dos ambientes sem integração. Remover workflow de diagnóstico antes do merge. Reconciliar com hardening #257; CI completo, revisão do diff e autorização explícita para merge. Documentar rollback por desativação da função e manutenção dos arquivos manuais.

### Status dos marcos
- [x] Coleção Postman analisada.
- [x] Autenticação e leitura reais confirmadas.
- [x] Relatórios candidatos identificados; ID 60 priorizado.
- [ ] Contrato efetivo, paridade e filtro de data/filial confirmados.
- [ ] Implementação, testes, CI da entrega, revisão e autorização de merge.

### Diagnóstico complementar e primeiro lote de código

Execução https://github.com/joaoldsxyzbr/agendas-pradosm/actions/runs/45993328740: a consulta de 20 registros do relatório 60 funcionou; 20 protocolos distintos na amostra, 20 tipos reconhecidos pelo contrato atual, data DD/MM/AAAA e intervalo HH:MM - HH:MM em todos os registros. NF-e e pedidos apresentam listas de dígitos separadas por vírgulas e hífen como ausência na amostra. Filial apresenta formatos com código e nome, além de uma forma sem código numérico (necessária verificação do CD/doca). Nenhum valor comercial foi registrado. Não extrapolar a amostra para todo o relatório.

Lacunas confirmadas na amostra: itens, volumes, paletes, carga batida e doca ausentes. Horário final resolvido pelo intervalo de hora_agendada, sujeito à validação do intervalo. A primeira sondagem de filtro não documentado recebeu HTTP 500, interrompendo as demais; não há filtro funcional confirmado. Não repetir sondagens indiscriminadamente nem fazer varredura histórica.

Implementado cliente de página GET isolado em worker/services/nexello-report.ts e testes sintéticos em tests/unit/nexello-report.test.ts (commit ab4b61853af1e0a1478b4369e91500c9dc317c38). Valida origem fixa HTTPS, parâmetros documentados, timeout, limite de resposta, metadados de paginação e erros sanitizados. Sem rotas, gravação, configuração de produção ou chamada pela aplicação. Os testes/CI precisam ser confirmados.

Escopo reafirmado pelo usuário: somente as mesmas informações da importação atual. Próximo critério obrigatório: obter relatório equivalente ao CSV, com protocolo, data/intervalo, fornecedor, filial/doca, itens, volumes, paletes, carga batida, tipo, NF-e e pedidos, com filtro por data documentado. Não substituir valores existentes por null nem inventar valores para campos ausentes. Não adicionar campos comerciais novos. Se necessário, pedir ajuste do relatório 60 ou outro relatório equivalente ao exportador atual da Nexello. Manter PR draft; não liberar o botão funcional até a paridade estar comprovada.


## 7. Decisão revisada: adaptação sem depender de novo relatório

O usuário autorizou adaptar ao relatório disponível. A exigência anterior de paridade integral deixa de ser bloqueio para uma primeira versão explicitamente parcial. Não ampliar escopo para campos comerciais não utilizados. Não fazer junção aproximada entre relatórios.

- Modelo normalizado separado do ImportAgendaInput: somente os campos autoritativos do relatório 60, sem fabricar itens, volumes, paletes, carga batida ou csvFields. Horários e datas validados; documentos preservam zeros; filial somente por código inequívoco. CD sem doca exige resolução explícita; não inferir doca a partir de horário/nome. A primeira versão pode excluir CD de forma explícita na interface, com aviso e contingência CSV/PDF; não ignorar registros silenciosamente.
- A persistência incremental não pode chamar o caminho atual de substituição integral: ele sobrescreve campos ausentes e inativa ausentes. Criar modo interno específico, usando a infraestrutura transacional e auditoria existente. Inserções podem ter quantidades nulas; atualizações preservam quantidades e csv_campos anteriores. Não reativar inativos automaticamente, nem mudar status/trocas/observação. Bloquear remarcação entre datas/lojas e conflitos de protocolo até regra validada. Não usar a ausência como cancelamento. Prévia apresenta conflitos, novos, alterados, iguais e indisponibilidade de quantidades; indicadores não devem apresentar quantidade desconhecida como zero confirmado.
- Alternativa ao filtro externo não confirmado: ler somente relatório 60 com teto de 15 páginas de 100 (1500 registros), filtrar localmente por dia e filial; se crescer, rejeitar sem gravar. O teto é uma escolha inicial, não garantia do fornecedor. Validar total, número de página, tamanho, duplicidade e consistência; sem promessa de snapshot estável quando a origem não a oferece. Antes de ligar a UI, validar duração, limites gratuitos do Worker, concorrência e orçamento global de 30 requisições/minuto; não repetir automaticamente nem permitir múltiplas leituras simultâneas. Se não couber no ambiente existente, manter fallback manual e rever escopo.
- Cliente de leitura corrigido para tipos oficiais do Worker (TextDecoder); normalizador puro e testes sintéticos adicionados no commit b54e4442f06318d2935e3de39e4102853b7c96a7. Ainda sem gravação ou rota ativa. CI anterior falhou por TS2345; correção precisa passar CI. Diagnóstico adicional limitado ao relatório 60, sem valores individuais nos logs, valida volume e distribuição agregada.
- Antes da ativação: validar correspondência de protocolos com CSV sanitizado, resolução de filiais reais, UX de dados incompletos, comportamento de sincronização incremental e concorrência. Manter CSV/PDF intactos; PR draft e sem merge.


## 8. Estratégia de integração após diagnóstico de volume

Execução 45994038780 (sucesso): 1031 linhas, 11 páginas, 26 datas distintas, 182 linhas do dia e 849 de dias futuros, 947 com filial codificada, 84 sem código inequívoco e 9 ocorrências repetidas de protocolo. Observações pontuais, sem garantia de horizonte ou cobertura contratual.

Decisão: relatório 60 como fonte primária. Relatórios 1 e 30 só podem enriquecer dados se houver chave compartilhada estável e semântica demonstrada; fornecedor + horário + filial não prova identidade mesmo em correspondência única na amostra. Não percorrer os históricos. Diagnóstico complementar 45994758979 investiga primeira/última página de cada relatório e duplicatas do 60, com teto de 19 GETs e sem valores individuais nos logs.

Deduplicar apenas equivalência integral dos campos normalizados; consolidar documentos somente após comprovar granularidade; nunca escolher arbitrariamente uma linha. CD sem doca permanece no CSV/PDF até identificação explícita e segura. Preservar quantidades anteriores; novos sem informação permanecem nulos. Não converter ausência em cancelamento.

Limites oficiais do Cloudflare Workers Free (https://developers.cloudflare.com/workers/platform/limits/): 50 subrequests externos por invocação e CPU de 10 ms. 11 páginas cabem no orçamento externo, mas CPU, duração, concorrência e D1 exigem teste. Não ativar se os limites gratuitos não forem respeitados.

CI 45994045287 falhou porque Node 22 strip-only não suporta parameter properties; corrigido no commit 48d81ff1fdef8b73d19319581055443efdabbacc. Testes do cliente de leitura passaram naquela execução, CodeQL verde, CI completo ainda não verde. Sem alteração da main nem produção.
