# Sincronização segura da preview — 24/11/2026 (#248, #249)

## Evidências (somente leitura na Cloudflare)
- Worker `agendas-pradosm-preview`: binding DB aponta para D1 `agendas-pradosm-preview`, UUID distinto da produção; REALTIME_MODE=off.
- Trigger de build: somente branch preview, build `npm run verify:production`, deploy `npm run deploy:preview`.
- O D1 de preview tem as migrations 0020_agenda_digitado_para_conferente e 0021_agendas_csv_fornecedor_preview, mas ainda não tem 0022–0025. A configuração antiga de deploy aplicava somente 0020 e 0021.
- Histórico legado do D1 de preview: 0017_appointment_observation.sql (em vez do nome 0017_observacao_recebimento.sql no repositório atual), 0020_cross_docking.sql, 0021_cross_agendamento_vinculo.sql, 0030_supplier_tags.sql. Não editar ou apagar esses registros.
- As duas colunas de observação de 0017 já existem; executar novamente a migration com o nome atual tentaria criar colunas duplicadas. A coluna agendamentos.observacao do preview ainda possui CHECK de 240 caracteres; o contrato atual admite 250. Usar D1 local com schema integral para testar esse limite; não reconstruir tabelas remotamente sem aprovação.

## Ajuste isolado
O comando `deploy:preview` passa a validar migrations e aplicar as pendências usando `wrangler.preview-migrations.jsonc`, binding PREVIEW_DB e UUID fixo de homologação. O padrão `migrations/00[2-9][0-9]_*.sql` cobre 0020–0099, evitando a reaplicação da 0017 histórica. As 0020/0021 atuais já constam no histórico por nome. O comando de produção e seu wrangler não são alterados. O script histórico db:migrate:preview:agendas é mantido, mas deixa de ser chamado pelo deploy.

Antes de mesclar, exigir CI verde e conferir novamente o destino do PR. Após merge, confirmar que o build isolado aplicou 0022–0025, publicou o Worker e manteve o binding. Nenhuma migration remota foi executada manualmente nesta análise. O limite de numeração do padrão deve ser revisto antes de criar a migration 0100; não usar esse procedimento para um D1 novo e vazio (usar a sequência integral no ambiente local).
