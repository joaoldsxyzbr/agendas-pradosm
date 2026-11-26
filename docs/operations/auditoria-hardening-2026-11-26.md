# Hardening de integridade e robustez — 26/11/2026

## Escopo e limites
- Main: corrigir concorrência de lojas, destinos de avisos, consultas, fallback realtime e retenção sem R2.
- O D1 de Preview não é utilizado atualmente e não faz parte desta intervenção. Não alterar bindings nem executar migrations remotas manualmente.
- Não alterar registros antigos de agendamentos concluídos: a auditoria encontrou 1.291 registros em estado legado. Revisar a regra de negócio e a época dos registros antes de eventual correção explícita. Não presumir que uma pendência histórica equivale a ausência.
- Nenhuma exclusão automática de histórico operacional. Time Travel é mecanismo de recuperação, não substitui revisão da política de backup.
- Os erros de WebSocket foram observados na auditoria; o tratamento de indisponibilidade foi reforçado, mas a causa raiz não está comprovada.
- Páginas antigas de avisos são reconciliadas em intervalos, evitando requisições repetidas; a página mais recente continua realtime.
- Migration 0031 preserva o código original, acrescenta ID de loja e índice. Destinos sem correspondência ficam restritos a administradores, nunca globais. A publicação normal aplica a migration antes do Worker.
