# Aceite da consolidação de engenharia — PR #258 / issue #259

Atualização de 26/11/2026. Este documento resume evidências e separa critérios de implementação, validação e operação. Não autoriza merge, migration remota, deploy ou recuperação.

## Evidências verificadas

CI [45907403980](https://github.com/joaoldsxyzbr/agendas-pradosm/actions/runs/45907403980), commit e108058: verify e CodeQL verdes, auditorias de dependências, strict Worker/Node/frontend/E2E, migrations, build, dry-runs, 128 E2E e smoke integrado Worker/D1/WebSocket/Chromium. Os números a seguir não representam capacidade contratada nem garantias de latência remota.

| Cenário | Medição local |
| --- | --- |
| 5.000 agendas, 75.000 agendamentos, 10.000 avisos | p95 listagem administrativa sem filtro 80,50 ms; página inicial 1,37 ms; profunda 3,00 ms; relatório 31,24 ms; avisos primeira página + badge 5,54 ms |
| Importação 121 itens / 10 lojas | medianas criação 2,43 ms, substituição 2,37 ms, 141 statements |
| Importação 350 itens / 10 lojas | 6,51 / 4,98 ms, 370 statements |
| Importação 700 itens / 10 lojas | 12,43 / 10,96 ms, 720 statements |
| PBKDF2 100 mil, 10 amostras | Node média 13,3 ms; workerd loopback HTTP mediana 17,0 ms (15,8–17,6 ms) |

Benchmarks SQLite sintético, não D1 remoto; PBKDF2 HTTP inclui overhead e não mede CPU faturada. Manter a política de senha vigente. Sem índice especulativo, serviço pago ou R2.

## Último lote para revisão

- Revisão direcionada das telas maiores de conferência, histórico e relatórios. Leituras passam a consumir AbortSignal do React Query; cancelamento no navegador não comprova cancelamento de SQL já iniciado no servidor. Contratos, mutações, polling e autorização permanecem. Filtros rápidos preservam filtros já aplicados e sincronizam formulário e persistência; troca do conjunto de lojas volta à primeira página. Não dividir componentes apenas por tamanho.
- Os 12 arquivos .mjs de scripts são wrappers de importação para implementações TypeScript; manter nomes por compatibilidade. Ativar allowJs/checkJs nos gates correspondentes para verificar esses wrappers e a configuração Playwright sem adicionar dependência.
- Atualizar arquitetura vigente, distinguir Preview histórica do fluxo local e reforçar runbook de recuperação. Preservar histórico.
- CI de 10fdd09e ([45908752480](https://github.com/joaoldsxyzbr/agendas-pradosm/actions/runs/45908752480)): 151 testes Node, strict inclusive JS, CodeQL, build, benchmarks e smoke real passaram; 128/129 E2E. Falhou o cenário de recuperação de relatório: mock falhava apenas a primeira requisição, que pode ser cancelada ou pertencer à comparação. A fixture agora mantém indisponibilidade até a tentativa explícita, desativa comparação nesse cenário e exige desaparecimento do alerta após retry. Corrigido também o caminho de upload dos diagnósticos Playwright. O novo head ainda precisa de CI completo; não declarar aprovação antecipada.

## Monitoramento operacional (não é SLA)

Baseline passiva de 24h até 22:35 UTC de 26/11, serviço exato: 11.304 eventos com CPU, p95 9 ms/p99 15 ms, wall p95 809 ms; 2.009 spans D1 com 176.947 linhas lidas, 869 escritas e SQL p95 1,1558 ms (traces amostrados a 5%). D1 medido em 15.355.904 bytes em consulta anterior. Não extrapolar amostragem para cotas totais nem confundir wall/CPU/SQL.

| O que conferir | Fonte e frequência proposta | Critério de investigação |
| --- | --- | --- |
| Requisições Workers | Painel de uso da conta, diariamente e após release | >=70% de 100 mil/dia ou erro de limite |
| Linhas D1 lidas/escritas | Row Metrics / uso da conta, diariamente e após release | >=70% de 5 milhões lidas ou 100 mil escritas/dia |
| CPU e erros | Observability do Worker, após release e semanalmente | p95 >=8 ms, erros de limite ou aumento sustentado de falhas/latência |
| Tamanho e recuperação | D1, semanalmente e antes de release | >=70% de 500 MB; conferir disponibilidade de bookmark e janela Free de 7 dias |

Fontes oficiais: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/). Revalidar limites na data de cada decisão. Os dados agregados de cobrança da conta não foram comprovados pelo conector; responsável precisa conferir painel. CPU p95 observada já merece investigação, não autoriza aumentar custos ou mudar política de senha. Erros históricos de realtime não têm causa raiz demonstrada; usar classificação de etapa/categoria acrescentada nesta PR para investigar recorrências.

## Gate de publicação (separado do aceite de implementação)

1. Responsável revisa o diff e autoriza explicitamente a PR #258; #257 é sobreposta e não deve ser mesclada separadamente.
2. Conferir head/base, proteção da main, verify/CodeQL atualizados e ausência de mudança inesperada de migrations. Falha externa de Preview ausente não equivale a aprovação de deploy.
3. Antes de release, conferir somente por leitura migrations, estado dos destinatários legados, correspondências de lojas e ponto de recuperação. Se houver ambiguidade, interromper e revisar; não alterar dados para fazer o check passar.
4. Seguir [runbook de publicação](production-release.md), sem deploy paralelo nem recriar Preview. Confirmar aplicação da 0031, versão e saúde, incluindo visibilidade por loja.
5. A migration aditiva permite escrita do Worker antigo durante a transição, mas rollback para código antigo após renomear/reutilizar códigos pode reintroduzir risco de visibilidade. Preferir correção à frente; avaliar antes de rollback. Restore remoto exige autorização específica e [runbook de recuperação](data-recovery.md).

## Riscos residuais e limites

- Consumo diário agregado e margem de quota dependem de consulta no painel. Não declarar capacidade de produção por usuários simultâneos.
- Recuperação SQLite local validada; Time Travel real não exercitado e não deve ser testado em produção. RPO/RTO reais não demonstrados.
- ASVS é referência de controle, não certificação nem auditoria exaustiva. Política PBKDF2 mantida por restrição operacional; não aumentar iterações automaticamente.
- Causa histórica de erros não comprovada, observabilidade e acompanhamento permanecem necessários.
- Aceite de implementação depende de CI e revisão da candidata; monitoramento e recuperação são responsabilidades permanentes, não justificam esconder lacunas ou criar operações perigosas.
