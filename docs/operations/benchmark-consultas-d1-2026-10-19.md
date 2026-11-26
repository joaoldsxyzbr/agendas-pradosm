# Diagnóstico reproduzível das consultas D1 — 19/10/2026

## Motivação
Issue [#102](https://github.com/joaoldsxyzbr/Agendas-pradosm/issues/102).
A `main` utiliza `listAdminAgendas` e `listStoreAgendas` em `worker/repositories/agendas.js`, ambas com agregações e sem paginação. A auditoria anterior constatou 162 agendas, 2390 agendamentos e 10 lojas ativas no D1, além dos índices `idx_agendas_loja_data` e `idx_agendamentos_agenda_horario`. Isso **não prova lentidão**.

## Ferramenta (nenhum acesso remoto)
`npm run benchmark:agendas` cria um SQLite **em memória**, com 10 lojas, 15 recebimentos por agenda e cenários crescentes de 162, 1000 e 5000 agendas. Executa as **próprias funções JavaScript de repositório** contra um adaptador com a mesma interface de consulta do D1. Mede mediana de cinco leituras após aquecimento e coleta `EXPLAIN QUERY PLAN` de cada cenário. Não copia SQL, não precisa de secrets nem escreve no Cloudflare.

`node scripts/benchmark-agendas.mjs --quick` usa 40 agendas e serve para smoke automatizado. É usado pelo teste `tests/unit/benchmark-agendas.test.js` no CI. Requer Node 22+; `node:sqlite` pode emitir aviso de recurso experimental em certas versões.

**Limitações:** SQLite no Node NÃO mede latência de rede, quota de CPU, execução remota ou índices internos da Cloudflare D1. Números locais não podem justificar por si só migrations, índices adicionais ou parâmetros de paginação em produção.

### Diagnóstico manual reproduzível no GitHub Actions

O workflow `.github/workflows/runner-diagnostico.yml` (`Diagnóstico operacional (manual)`) pode ser executado sob demanda na `main`. Ele realiza:

- `npm run benchmark:agendas` e `npm run benchmark:password` com dados e senhas sintéticos (PBKDF2 **somente 100.000**), sem D1 nem secrets;
- benchmark WebCrypto com **100.000 iterações** usando a implementação real da senha no **Workerd local isolado** (Wrangler oficial, apenas loopback), medindo ida e volta HTTP, não CPU remota; nunca testar valores superiores por iniciativa da rotina;
- `git rev-list` e `git log --cherry-pick` em branches históricas, somente leitura, sem exclusões;
- smoke HTTP **somente GET** à página inicial e ao arquivo `/frontend/entry.js` do Worker publicado;
- smoke HTTP **somente GET** a `/api/auth/bootstrap-status` (espera JSON com chave `available`);
- smoke HTTP **somente GET** a `/api/health`, que executa `SELECT 1 AS ok` no D1 da própria produção e exige `{ "ok": true, "database": "ok" }`. Não lê dados de usuários e não escreve no banco.

O workflow não autentica usuários nem altera registros. Sucesso no HTTP comprova disponibilidade básica de asset e API pública, **não substitui teste manual de login, conferência, importação ou permissões**. Falhas externas de DNS, rede ou WAF devem ser diagnosticadas antes de interpretar como defeito do app.


## Critérios para uma mudança futura
1. Medir `rows_read`, duração e volume retornado em Preview/D1 sintético, nos filtros comuns e no histórico completo.
2. Verificar se a interface e os endpoints realmente precisam listar todas as agendas ao mesmo tempo.
3. Se houver gargalo demonstrado, propor paginação incremental preservando compatibilidade e filtragem; testar perfil ADM, visualizador e conferente, histórico e ordenação.
4. Qualquer índice novo deve ser justificado por plano real e query; testar com dados sintéticos antes de migration aditiva.
5. Alterações por PR e CI, Preview isolada, smoke e deploy confirmado.

Este diagnóstico não altera o schema nem endpoints de produção.
## Atualização de 26/11/2026 — programa #259

O diagnóstico de outubro acima é histórico. Na PR #258, o benchmark passa a usar as migrations reais e funções TypeScript de repositório e rotas gerenciais, com 20 repetições completas, mediana/p95 descritivo, quantidade de consultas e plano de cada statement. Inclui páginas iniciais e profundas, relatórios até 93 dias, ocorrências e avisos com cursor e badge. Volumes: 162, 1.000 e 5.000 agendas, 15 agendamentos e 2 avisos por agenda. O quick usa 40 agendas e duas repetições. CI executa os cenários completos em SQLite local; resultados não são medições remotas da Cloudflare. Preview não integra o escopo deste programa; não habilitar ou recriar D1 Preview. Nenhuma migration ou índice novo nesta etapa.

## Resultado do CI 45887784001 — commit c538a49 (26/11/2026)

Fonte: https://github.com/joaoldsxyzbr/agendas-pradosm/actions/runs/45887784001/job/140142711891 . Medições SQLite local sintético, 20 repetições; não são latência remota, CPU ou rows_read de D1. Verificações de cardinalidade, FKs e isolamento passaram.

| Cenário | p95 162 agendas (ms) | p95 1.000 agendas (ms) | p95 5.000 agendas (ms) | Statements |
|---|---:|---:|---:|---:|
| ADM sem filtros | 2,19 | 13,25 | 81,56 | 1 |
| ADM filtrado por data | 0,10 | 0,17 | 0,20 | 1 |
| ADM primeira página | 0,39 | 0,55 | 1,36 | 1 |
| ADM página profunda | 0,38 | 0,76 | 2,67 | 1 |
| Conferente/loja sem paginação | 0,23 | 1,04 | 8,55 | 1 |
| Conferente primeira página | 0,31 | 0,31 | 0,32 | 1 |
| Relatório até 93 dias | 3,51 | 14,58 | 29,32 | 3 |
| Ocorrências paginadas | 1,63 | 8,64 | 28,03 | 2 |
| Avisos primeira página + badge | 0,54 | 2,19 | 10,93 | 2 |
| Avisos segunda página | 0,44 | 2,17 | 11,26 | 2 |

Interpretação: o caminho paginado evita agregação de todas as agendas e escala melhor no cenário sintético; o caminho filtrado por data é estável. Relatórios e badge de avisos merecem observação de rows_read e CPU antes de otimizar. Ordenações temporárias aparecem nos planos de agendas; não são por si só um defeito. Manter paginação nos consumidores de histórico e evitar novos usos sem filtros. A comparação não é uma garantia de capacidade, SLA nem teste de concorrência. A #257 modifica destinos e índices de avisos; repetir a baseline depois de reconciliar as PRs. Sem criar índices especulativos.
