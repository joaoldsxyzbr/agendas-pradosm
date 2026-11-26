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
