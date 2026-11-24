# Controle de acesso modular — etapa 1 (#248)

Status: fundação isolada, sem ativação nas rotas. Base reconciliada no PR #249.
A matriz é provisória até a homologação; não modifica o papel dos usuários atuais.

## Diagnóstico e fronteiras

- `migrations/0012_remove_usuario_perfil.sql`: CHECK limita papel aos três valores atuais e exige loja_id para conferente. `0013_admin_integrity.sql` protege o último admin por papel físico. Não reescrever migrations nem ampliar esse CHECK por reconstrução destrutiva nesta etapa.
- `shared/auth.ts`, `shared/api.ts`, auth e repositório de usuários: contrato de papel e loja única; sessão validada contra session_version e revogação individual.
- `worker/app.ts` e middleware: bloco /api/admin protegido por papel, lista GET especial para visualizador. /api/store tem verificações próprias de conferente. A UI não é fronteira de segurança.
- `routes.tsx`, `layouts.tsx`, páginas de recebimento/conferência, avisos e sessão: seleção por papel. A tela administrativa de recebimento e a tela operacional da conferência são superfícies distintas, mesmo que o nome apresentado seja Recebimento.

## Inventário para integração

| Superfície | Permissão e escopo a integrar |
| --- | --- |
| GET /api/admin/stores | Leitura de lojas necessárias à operação deve ser separada de lojas.ver (gestão); filtrar escopo. |
| POST/PATCH/DELETE /api/admin/stores; /api/admin/users | Gestão granular. Alterações de perfil/escopo e concessões exigem autorização adicional, proteção do último admin e proibição de autoelevação. |
| GET /api/admin/agendas, /today, /:id e appointments/:id | Leitura de recebimento/agendas conforme finalidade; resolver loja real no servidor para IDs diretos, filtrar listas e paginação. |
| PATCH agendas/:id/status, /digitado, /digitacao; GET /digitacao e /history | Separar concluir/reabrir, edição/digitação e histórico. Verificar agenda e loja. |
| POST agendas/:id/manual; PATCH/DELETE appointments/:id/manual; PATCH /status, /exchanges, /observation; GET /history | Separar criação, edição, exclusão, status e histórico. Escopo por agenda real e validação de estado/CAS existente. |
| POST agendas/import e /import/bulk | Importação e substituição separadas. Validar todas as lojas do lote antes de qualquer escrita. Manter atomicidade. |
| /api/store/today, /agenda/:date, /history e /appointments | Conferência; seleção da loja autorizada para múltiplos vínculos e proteção de cada ID. Manter fechamento e status. |
| /api/admin/reports e /occurrences | Relatórios: escopo no SQL, não apenas filtro visual. |
| /api/admin/presence e /api/store/presence | Presença por escopo; conferente só envia para loja autorizada. |
| /api/avisos, marcar lido, marcar-todos; /api/admin/avisos | Leitura pessoal, publicação e filtros por loja e eventos; preservar comportamento anterior. |
| /api/realtime e RealtimeHub | Identidade e escopo provenientes do servidor; filtrar eventos e snapshots, revogar conexões na alteração de acesso. |
| /api/admin/audit, /diagnostics, /retention | Separar leitura administrativa e execução sensível de retenção. Não habilitar R2. |
| /api/auth e /api/diagnostics/events | Autenticação e diagnóstico do cliente, não liberar gestão por meio dessas rotas. |

## Fundação desta etapa

`shared/permissions.ts` define quatro perfis, catálogo de ações, herança,
negação/concessão individual e função pura de escopo. Configuração inválida
não concede acesso. A negação de visualização retira ações dependentes.
O catálogo não autoriza nenhuma rota ainda.

Decisão conservadora: o agendador recebe edição operacional e importação,
mas exclusão, reabertura, conclusão, substituição e exportação ficam
desmarcadas por padrão para revisão. O conferente mantém as operações
anteriores. O visualizador só lê dados de negócio (marcar aviso próprio como
lido não é edição de recebimento). Permissões extras de administração são
decisão explícita; a função pura não substitui controle de delegação.

## Próximas etapas

1. Projetar persistência aditiva sem remover papel/loja existentes: perfil
   efetivo, exceções e escopo explícito (todas versus vinculadas). Não
   representar agendador como admin irrestrito; validar estratégia de
   compatibilidade e rollback antes de criar contas com o novo perfil.
2. Integrar resolução única no Worker, revisar cada rota do inventário e
   escopo de consulta, e proteger concessões/último admin por operação atômica.
   Revogar sessões e conexões ao alterar direitos. Negar por padrão.
3. Integrar contrato de sessão e menu/telas; criar seleção de loja; distinguir
   herdar, conceder e negar. Validar ações sensíveis e rotas diretas.
4. Seed exclusivo local e testes integrados em banco sintético, segurança,
   regressão, E2E, CI e homologação isolada. Não promover a main sem aprovação.

Rollback de código antigo não pode devolver direitos revogados ou escopo
global a contas personalizadas. Definir procedimento de suspensão/revogação
dessas contas e compatibilidade antes da ativação; não basta republicar uma
versão anterior.

### Persistência aditiva preparada (0026)

A migration cria três tabelas, sem backfill nem modificação de usuários existentes:
`usuario_acesso` (perfil efetivo e escopo explícito),
`usuario_acesso_lojas` (vínculos; FK composta impede vínculos em escopo todas)
e `usuario_acesso_excecoes` (concessões/negações únicas por permissão).
A ausência de configuração permanece equivalente ao legado até a integração.
Uma configuração vinculada sem lojas deve negar todo acesso por loja.
O catálogo valida identificadores de permissão; a tabela não concede acesso
por si só. Mudanças futuras precisam de transação atômica com CAS de
session_version e auditoria. O teste aplica o SQL após as 25 migrations
anteriores, com dados sintéticos já existentes, e verifica preservação e FKs.
Nenhuma conta com o novo perfil deve ser provisionada antes da integração.

### Etapa 2 — resolução e política de rotas (preview)

Leitura consistente em `worker/repositories/access.ts` resolve perfis, vínculos e exceções, com fallback legado. `worker/middleware/access-policy.ts` inventaria métodos e caminhos, separa ações e exige escopo resolvido. Listas, avisos e realtime falham fechados na função de escopo até a implementação de filtros próprios. Testes usam todas as migrations e o adaptador SQLite local. Ainda não habilitar configuração de contas: faltam escrita transacional e auditoria, proteção efetiva do último admin, enforcement de rotas/consultas, sessões/realtime e interface. Nenhum usuário foi alterado.

### Escrita transacional preparatória

`saveAccessConfiguration` grava perfil, vínculos, exceções, versão de sessão e auditoria em um batch atômico; CAS e autoridade do administrador integral são verificados no mesmo batch. A migration 0027 protege pelo menos um administrador integral não personalizado. A escrita NÃO está exposta na API; não criar configurações reais antes dos guards, filtros, revogação de WebSocket e UI. A reversão deve suspender contas customizadas antes de usar código anterior.
