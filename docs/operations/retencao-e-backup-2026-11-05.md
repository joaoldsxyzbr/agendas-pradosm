# Monitoramento e preservação dos históricos (política atualizada em 26/11/2026)

Este documento substitui a proposta histórica de exportação R2/treino de restore da Preview de 05/11/2026. O projeto não usa R2 nem D1 Preview. Não ativar serviços ou executar restore para testes.

## Política vigente

| Tabela | Idade monitorada | Política |
|---|---:|---|
| historico_status | 365 dias | Preservar |
| historico_agenda | 365 dias | Preservar |
| auditoria | 730 dias | Preservar |
| avisos, avisos_lidos, avisos_lojas, avisos_reacoes | Toda a vida útil | Preservar |
| diagnosticos | 30 dias | Limpeza independente |
| sessoes_revogadas | Expiração | Limpeza independente |

Cron diário às 03:05 UTC. Cada etapa possui tratamento independente de erro. O resumo `retention_summary`, `db_size_report` e `db_size_warning` registra monitoramento; `retention_history_preserved` indica registros antigos preservados. Os campos de contagem `exportados`, `purgados`, `lotes` continuam disponíveis por compatibilidade e são zero; `pendentes` informa registros além do corte e `motivo` é `PRESERVACAO_HISTORICO`. A variável `RETENTION_ROW_LIMIT_WARNING` (padrão 500000) é alerta de linhas, não limite de bytes nem previsão de faturamento.

As rotas administrativas autenticadas `GET /api/admin/retention/status` e `POST /api/admin/retention/run` mantêm seus contratos; a segunda registra tentativa de execução na auditoria. Nenhuma exclusão de históricos é realizada.

## Recuperação

Time Travel é recurso de recuperação, não backup independente. Consulte o runbook [data-recovery.md](data-recovery.md). Restauração real exige autorização explícita e incidente documentado. Treino de restauração remota ainda não comprovado, e a Preview antiga não deve ser recriada. Testes de migrations, FK, preservação e integração são locais e descartáveis.
