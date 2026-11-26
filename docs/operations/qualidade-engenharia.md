# Consolidação da qualidade de engenharia

Baseline: main 79b4903, auditoria de 26/11/2026. Esta consolidação não altera regras de negócio, dados reais, infraestrutura ou permissões. A PR #257 trata integridade operacional, destinos de avisos, concorrência, retenção e fallback realtime; não repetir seu escopo.

## Critérios permanentes

| Dimensão | Evidência esperada |
| --- | --- |
| Arquitetura e simplicidade | Monólito modular; responsabilidades explícitas; dependências justificadas. |
| Organização e manutenção | Módulos coesos; contratos compartilhados; nomes consistentes; ausência de duplicação relevante. |
| Modelagem e integridade D1 | PK/FK/UNIQUE/CHECK adequados; migrations aditivas e imutáveis; SQL parametrizado e mutações atômicas. |
| Segurança | Autorização no servidor e isolamento por loja; sessões revogáveis; auditoria e CodeQL verdes. |
| Robustez | Falhas isoladas; fallback HTTP; concorrência protegida; testes de erro e recuperação. |
| Escalabilidade | Consultas limitadas e paginadas; planos SQL e medições com volumes representativos; sem confundir benchmark local com capacidade remota. |
| Testabilidade e entrega | Testes unitários, integração local e navegador; gate verify obrigatório; PR e merge autorizado. |
| Operação e documentação | Runbooks atuais, histórico separado de instruções vigentes; limites de recuperação explícitos. |

## Primeira etapa

- Descoberta automática dos módulos Worker/shared na verificação existente; novos módulos não dependem de atualizar uma lista manual.
- Benchmark SQL com todas as migrations reais aplicadas a SQLite em memória. Cobertura de listagens completas e paginadas, totais, duplicidade e indicador de próxima página. Cenários 40 (smoke), 162, 1.000 e 5.000 agendas. Não impor limite absoluto de milissegundos em CI compartilhado.
- Nenhuma nova dependência, serviço ou migration. O D1 de Preview não é utilizado neste fluxo; nunca usar o D1 remoto para testes.

## Próximas etapas, condicionadas a evidência

1. Tipagem: reduzir implicit any e nullabilidade em módulos pequenos, habilitar strict por conjunto após correções; não mascarar erros com casts ou @ts-ignore.
2. Coesão: revisar worker/repositories/agendas.ts e worker/routes/admin-agendas.ts por responsabilidade (consulta, importação, mutação). Separar apenas quando os limites forem claros e os testes preservarem contratos.
3. Realtime: inventariar clientes, reconexão e fallback; consolidar somente após cobertura de comportamento e integração local.
4. Integração: complementar Playwright mockado com smoke local Worker + D1 sintético; medir concorrência e custo de consultas representativas. Não prometer capacidade em produção a partir do SQLite local.
5. Documentação: atualizar instruções vigentes e marcar documentos históricos como históricos. Não apagar registros de decisões.
6. Revisitar índices, limites e uso de CPU após medir. Sem serviços pagos ou R2.

## Critérios de aceite

CI e CodeQL verdes, ausência de regressão de API/esquema, nenhuma escrita em produção, documentação de riscos e limites, PR revisável. Mudanças estruturais futuras devem ser pequenas, com justificativa e testes próprios; não refatorar por número de linhas apenas.

## Referências oficiais e avaliação de lacunas — 26/11/2026

As referências orientam escolhas; não representam certificação nem comprovam capacidade de produção. Aplicar somente práticas proporcionais ao sistema.

| Área | Referência oficial | Evidência atual e ação |
| --- | --- | --- |
| Workers | [Best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) | Observabilidade já configurada. Revisar mensagens de erro, limites e compatibilidade do runtime de forma incremental. |
| Tipagem | [Workers TypeScript](https://developers.cloudflare.com/workers/languages/typescript/) e [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict) | worker/types.d.ts mantém tipos manuais de runtime e worker/tsconfig.json usa strict: false. Avaliar wrangler types com a configuração existente, sem segredos; migrar tipos de fronteira e resultados de D1 gradualmente. Frontend já usa strict. |
| D1 | [Prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [índices](https://developers.cloudflare.com/d1/best-practices/use-indexes/) e [SQLite query planner](https://www.sqlite.org/queryplanner.html) | Manter SQL parametrizado e batches atômicos, medir índices com EXPLAIN QUERY PLAN e metadados rows_read/rows_written. Não adicionar ORM nem remodelar dados sem motivo comprovado. |
| Realtime | [Durable Objects architecture](https://developers.cloudflare.com/durable-objects/best-practices/architecture-guidance/) e [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | Hub único e dois hooks de conexão possuem risco de concentração/duplicação. Manter hibernation; medir e consolidar lifecycle, retry com backoff/jitter e reconciliação HTTP. Dividir por loja apenas se houver gargalo comprovado e desenho seguro do canal global. |
| Frontend | [React state structure](https://react.dev/learn/choosing-the-state-structure) | Evitar duplicar estado remoto e local. Revisar cache por sessão/loja, cancelamento de consultas e erros. |
| Segurança | [OWASP ASVS](https://owasp.org/projects/ASVS/), [Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | Criar matriz de controles com evidência e testes negativos. Revisar acesso por recurso/loja, sessão, CSRF, injeção, limites de entrada e ausência de segredos nos logs. PBKDF2-HMAC-SHA256 atual usa 100 mil iterações; referência OWASP para PBKDF2-HMAC-SHA256 indica 600 mil ou mais. Não alterar custo nem invalidar senhas sem benchmark de runtime e estratégia compatível. |
| Testes | [Workers testing](https://developers.cloudflare.com/workers/testing/) | Complementar testes Node/SQLite e Playwright mockado com fluxo integrado via Wrangler local, bindings locais e fixtures sintéticas. Não adicionar framework sem necessidade. |
| Recuperação | [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) | Confirmar procedimentos, janela de recuperação e capacidade de restauração em ambiente isolado; não executar restore em produção para testar. |
| Entrega | [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches) | Preservar ruleset e gate verify. PRs revisáveis, nenhuma publicação manual ou merge sem autorização. |

## Orçamento de capacidade e limites da plataforma

Consultar [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) e [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) antes de mudanças. Para o plano Free, em 26/11/2026: D1 até 500 MB por banco, 5 milhões de linhas lidas/dia, 100 mil escritas/dia por conta, 50 consultas por invocação, 100 parâmetros por statement e 7 dias de Time Travel; Workers até 100 mil requisições/dia e 10 ms de CPU por requisição HTTP. Quotas não são metas de capacidade. Não contratar serviços ou adicionar cartão.

- Registrar baseline de p50/p95, erros, linhas lidas/escritas e volume; cenários sintéticos crescentes de agendas, histórico, avisos e concorrência por loja. Avaliar latência e CPU do ambiente real por telemetria passiva, sem teste de carga em produção.
- Conferir limites de SQL também nos casos extremos. Achado estático: a busca de ocorrências em admin-reports.ts aceita 80 caracteres e usa LIKE, enquanto D1 documenta limite de 50 bytes para padrão LIKE/GLOB. Reproduzir com entradas longas/multibyte em ambiente local e ajustar preservando a semântica de busca literal; não declarar incidente de produção sem evidência.
- Considerar o custo de polling, varreduras e reconexões repetidas. Monitorar a folga da quota diária, não apenas o tamanho do arquivo. A partir de setembro de 2026, o D1 Free rejeita consultas quando a quota diária de linhas é excedida.
- Não afirmar suporte a um número de usuários simultâneos sem ensaio representativo. Definir metas de disponibilidade, recuperação e latência após baseline; registrar resultados e limites.

## Ordem de execução recomendada

1. Baseline e testes de caracterização; revisar resultados CI da primeira etapa.
2. Tipos oficiais e contratos de fronteira, matriz de segurança e testes negativos.
3. Fluxo integrado local Worker + D1 + navegador, com falhas e concorrência.
4. Melhorias de consultas e lifecycle realtime fundamentadas em métricas.
5. Refatorações pequenas por responsabilidade e revisão de documentação vigente.
6. Revisão final independente, evidências de regressão e capacidade; atualizar main antes de validar, sem merge automático.

As etapas acima são planejadas, não entregues. Não duplicar a PR #257 nem alterar o ambiente Preview.

## Execução inicial da issue #259

- Gate estrito incremental para `worker/lib/session.ts` e `worker/lib/login-rate-limit.ts`, preservando o gate de todos os módulos. Payload de sessão validado em runtime; tokens com segmentos extras rejeitados; compatibilidade dos tokens legítimos e legados mantida. Não altera PBKDF2 ou duração das sessões.
- Busca literal de ocorrências usa `instr(lower(...), lower(?))` em vez de LIKE com curingas escapados; preserva comparação ASCII do SQLite, remove dependência do limite de padrão LIKE e mantém parâmetros. Testes com Unicode, caracteres especiais e autorização.
- Tipos oficiais Wrangler, demais módulos strict e smoke no workerd real ainda pendentes; não declarar etapa concluída antes do CI.

### Incremento: runtime local e tipagem

- Ampliação do gate strict para senha, middleware HTTP, presença e datas, sem mudar a política de senhas.
- `npm run test:integration:local` (após `npm run build`): configuração temporária derivada apenas dos bindings locais, UUID fictício obrigatório, credenciais efêmeras, migrations reais em diretório descartável, Wrangler/workerd ouvindo somente loopback. Gera tipos oficiais do Wrangler e verifica nomes dos bindings; ainda não substitui o arquivo manual `worker/types.d.ts`.
- Smoke HTTP com login real, isolamento entre lojas, autorização de visualizador, CSRF, mutação de recebimento, avisos direcionados, reações, leitura idempotente e logout/revogação. Executado no gate CI depois do build; resultado depende da execução. Realtime permanece desligado nesse primeiro smoke, e o navegador ainda usa mocks.
- Referências: https://developers.cloudflare.com/workers/languages/typescript/ e https://developers.cloudflare.com/d1/best-practices/local-development/ .

### Segurança: revogação de sessão renovada

Encontrado por revisão de código: o logout de um cookie anterior à renovação podia registrar a revogação apenas até a expiração daquele cookie, permitindo que a limpeza de revogações removesse a proteção antes do fim de validade de outro cookie do mesmo sessionId. A correção mantém a revogação pelo prazo máximo de sessão a partir do logout, e o UPSERT nunca encurta uma revogação existente. Também exige representação base64url canônica da assinatura, evitando aliases de cookies legados cuja revogação é por hash do token exato. O prazo das sessões válidas e a política de senha permanecem os mesmos. Não corrige retroativamente revogações já expiradas. Testes sintéticos cobrem a janela e os aliases; aguardar CI.

### Compatibilidade do smoke local com migrations históricas

O CI de `7249876` confirmou a geração dos tipos oficiais, mas o Wrangler local recusou a transação explícita da migration histórica 0029. A documentação D1 explica o gerenciamento de transações e FKs pelo runtime: https://developers.cloudflare.com/d1/sql-api/foreign-keys/ e https://developers.cloudflare.com/d1/reference/migrations/ .

Ajuste estritamente local: banco novo, vazio, diretório temporário de migrations; apenas o envelope BEGIN/COMMIT e a troca de foreign_keys da 0029 são removidos da cópia descartável. O DDL/DML permanece; o Wrangler controla a transação, fixtures entram somente depois e foreign_key_check é exigido. Os testes SQLite continuam executando os arquivos originais, inclusive regressão de preservação de dados. Não é um procedimento de migração de banco populado; não se modifica a migration histórica, não se resolve uma eventual incompatibilidade dela com provisionamento remoto novo. O smoke verifica o schema resultante e a API real.

Também passa a compilar os módulos strict contra os tipos de runtime gerados por `wrangler types --include-env false`, sem carregar as declarações manuais nessa verificação. A substituição integral dos tipos do backend continua incremental. CI pendente.

### Decisão: TypeScript estrito em todo o projeto

Strict será critério obrigatório de encerramento da issue #259: frontend, Worker, shared, scripts e testes TypeScript. A migração incremental não é exceção permanente: o objetivo final é remover a configuração parcial e usar strict em todos os tsconfigs, com gate obrigatório. Não introduzir any indiscriminado, @ts-ignore, @ts-nocheck ou coerções para contornar erros. Tipar retornos D1, entradas externas e nullabilidade; usar unknown e validação quando apropriado. Scripts e testes devem possuir configuração própria compatível com Node; não misturar tipos Node e Workers. Preservar testes e comportamento. Módulos de importação/PDF ainda exigem revisão de declarações externas antes da compilação com tipos oficiais. Nesta etapa, adicionados contratos compartilhados não-PDF, repositórios e rotas de auditoria/presença ao gate strict. CI pendente.

### Tipagem de cadastros, autenticação e publicação de eventos

Tipos explícitos de linhas de lojas/usuários, inputs derivados dos schemas compartilhados, parâmetros e resultados dos repositórios, nulabilidade de consultas, respostas administrativas e eventos de publicação realtime. O gate strict (também contra tipos oficiais do runtime) passa a abranger esses módulos. Não altera schema SQL nem a política de autorização. As rotas verificam a presença do usuário autenticado e resultados nulos antes de serializar. A PR #257 altera alguns dos mesmos arquivos: reconciliar os diffs e rodar CI após atualização da main, sem sobrepor as proteções de concorrência. CI do novo commit pendente.

### Lote ampliado — avisos, diagnósticos, relatórios e importação

Corrige o narrowing de StoreCheck em configuração mista strict/permissiva. Tipos de entradas, linhas SQL e saídas do canal, diagnósticos e relatórios; reação JSON validada com schema. Inclui todo shared/import no gate strict, isolando a declaração externa do parser PDF do runtime manual e usando unknown no retorno do parser. Nenhuma migration nova; a troca de destinos por ID continua na #257. CI do lote pendente; não declarar aprovação antes do resultado.

### Durable Object — contratos realtime

Incluído RealtimeHub no gate strict. Validação Zod de mensagens, eventos internos e anexos de hibernação, com tipos explícitos de presença, conexão e alarmes; removido cast any do evento. Mantidos protocolo, tags, prazos e semântica de publicação. CI pendente; smoke anterior usa REALTIME_MODE=off, então comportamento de WebSocket real ainda precisa de teste dedicado.

### Worker integral sob strict

A configuração Worker agora usa strict: true para todos os módulos Worker/shared. Tipos de linhas D1, importação, histórico, mutações, rotas e manutenção; removido any da substituição de agendas. Verificação com tipos oficiais a partir do entrypoint Worker, sem confundir APIs DOM do parser de CSV (TextDecoder fatal) com APIs do runtime. A verificação DOM estrita de todo shared continua ativa. Não se reescrevem migrations nem regras de negócio. O caminho legado R2 não foi habilitado: apenas ajustada a forma tipada de httpMetadata; remoção segue #257. CI pendente; scripts/testes TypeScript ainda exigem configuração Node própria.

### Gate Node para scripts e testes

CI do commit 43173b0: verify e CodeQL aprovados, inclusive integração Wrangler/D1 local e navegador. Worker e shared integralmente strict. Este incremento cria tsconfig.node.json, reutilizando TypeScript e @types/node já instalados em apps/web; todos os 11 scripts TypeScript entram no gate obrigatório. Adaptador SQL sintético tipado, com coerção restrita à fronteira dos resultados genéricos do SQLite. Os testes TypeScript serão acrescentados ao gate em lotes. CI do novo commit pendente. Nenhum bootstrap remoto foi executado.

### Testes de contrato sob strict

Primeiro lote de 12 dos 30 testes TypeScript incluído no gate Node: contratos de rotas/autenticação, paridade, parsers, validação de importação, senha, migrations, utilitários e benchmark. Fixtures File reais, verificações explícitas de ausência e validação do JSON de benchmark. Os outros testes, especialmente mocks e integrações D1, permanecem pendentes. CI ainda precisa validar os dois novos commits.

### Segundo lote Node: integração e concorrência

O CI de 8ce340b passou verify, CodeQL e integração local. Novo adaptador SQLite exclusivamente de teste, com transação e rollback, hooks restritos para simular concorrência e falha de auditoria, bindings sintéticos que falham se utilizados indevidamente. Nove arquivos adicionais no gate strict (paginação, concorrência, digitação, autenticação, diagnósticos, migrations, CSRF, recebimento e revogação). Mantidas as fixtures e asserções; coerções de projeções SQL ficam na fronteira de teste. Ainda faltam oito arquivos; CI deste lote pendente. Sem acesso remoto.

### Guardas e retenção sob strict

Mais dois testes migrados: guardas concorrentes com schema real, rollback integral do lote e retenção local sintética (R2 exclusivamente simulado em memória, sem binding remoto). Assinaturas das mutações explicitam parâmetros já opcionais em runtime. Agora 23 de 29 arquivos de teste no gate; seis restantes. CI pendente.

### Último lote de mocks SQL

Cinco arquivos adicionais no strict Node; adaptador de statements registrados tipado, separado do SQLite real, preservando asserções de aridade, SQL, binds e batches. Fixtures completas com tipos de domínio, sem casts nos chamadores; resultados genéricos ficam na fronteira do mock. Restam avisos e validação CI deste lote.

### Cobertura integral de testes TypeScript

Todos os 29 arquivos unitários e helpers passam a integrar o gate Node automaticamente por glob; novos testes não precisam ser acrescentados manualmente. Canal de avisos usa adaptadores tipados e valida contratos de listagem, leitores e reações com schemas compartilhados. Nenhuma alteração de produto ou dados reais neste lote. A aprovação depende do CI do novo head; não confundir cobertura configurada com execução validada. Scripts JavaScript .mjs permanecem fora do escopo de TypeScript estrito.
