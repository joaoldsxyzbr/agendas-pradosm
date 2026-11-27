# Reconciliação main / V2

Base V2 7365c54c89e1e88e06172a2ea61fd540f31c33d9; referência main 481b92f65d93fbbd1813c9153ee4c79d1b3220a3; branch `feat/v2-consolidacao-main`. Base comum b8252f2; 90 caminhos exclusivos da main, 94 da V2, 49 modificados dos dois lados, 183 idênticos (comparação de blobs, incluindo adições/remoções). Nenhum merge em main/preview.

- [x] Inventário e preservação do snapshot original.
- [x] Núcleo de agendas: separar consultas/importação/mutações com código da main, restaurar filtros de escopo, paginar após autorização, proteger CSV vinculado Nexello. Serviços de digitação, manutenção e realtime tipados. Eventos operacionais passam à auditoria; realtime continua desligado.
- [ ] Validar regressões dos módulos de agendas, segurança e tipos reais D1. Testes antigos de eventos precisam refletir decisão da main.
- [ ] Canal de Avisos: preservar avisos, leituras e destinos; integrar permissões, ID estável de loja, chat, reações e leitura. Migration 0029 da main usa rebuild/PRAGMA foreign_keys OFF/BEGIN; não aplicar diretamente ao D1 V2. Preparar e testar 0011 em SQLite com dados sintéticos e aprovação explícita do contrato antes de aplicar remotamente. 0030/0031 devem integrar a mesma evolução.
- [ ] Demais módulos estritos (Worker, UI, scripts Node e testes), preservar redesign, perfis, comparativos Nexello, relatório gerencial e caminhos locais. Não reativar R2/deploy/cron.
- [ ] Configurar exclusivamente D1 existente agendas-pradosm-preview (962d3e81-9045-421b-96f8-ce65b5d1996d), 10 migrations já aplicadas, usuário teste existente. Não editar migrations aplicadas nem resetar. Worker isolado permanece não publicado.
- [ ] Gate completo, CI quando V2 concluída, revisão/merge somente mediante autorização.

## Limites

Build/CI/migration remota/deploy não executados. Restante dos conflitos não resolvido. Não habilitar branch para uso operacional antes de integrar contratos e validar. Avisos ainda anteriores ao chat.
