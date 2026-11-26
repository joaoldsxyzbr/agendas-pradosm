# Arquitetura do Agenda Prado

## Fonte de verdade e ambientes

O repositório oficial é `joaoldsxyzbr/Agendas-pradosm`.

- `main`: branch de produção, com frontend **React 19 + Vite + TypeScript** em `apps/web/`.
- `preview`: branch de **homologação** (recriada da `main` em 11/11/2026), com Worker e D1 próprios. Funcionalidades novas homologam-se nela via branch própria + PR + CI; a promoção para `main` só acontece após homologação aprovada.
- Mudanças devem passar por branch própria, PR e CI antes de chegar à `main`. O dependabot e as ferramentas de automação apontam para a `main`.

A UI legada foi substituída pelo React na raiz do aplicativo. Documentos em `docs/archive/` e planos de migração registram etapas históricas, não a arquitetura atual.

## Fluxo técnico

- `apps/web/src/`: telas React (login, recebimento, importação por modal, conferência, relatórios, histórico, lojas, usuários e diagnósticos), rotas e consulta de sessão.
- `apps/web/src/app/routes.tsx`: rotas `/login`, `/admin`, `/admin/reports`, `/admin/history`, `/admin/stores`, `/admin/users`, `/admin/diagnostics` e `/app`. O Worker aplica a autorização efetiva por perfil.
- `scripts/build-native.mjs`: compila `apps/web/` com Vite para `dist-modern/` e publica o React na raiz de `dist/`, junto aos arquivos de `public/` (ícone e cabeçalhos de segurança).
- `worker/index.ts`: entrada do Cloudflare Worker, incluindo cron; `worker/app.ts`: Hono, middleware e rotas `/api/*`. O Worker serve o `dist/` com fallback de SPA para URLs profundas.
- `worker/routes/`: autenticação, validação e autorização; `worker/repositories/`: D1; `worker/services/` e `worker/realtime/`: regras operacionais, retenção de dados com export para R2 e WebSockets/Durable Object.
- O cron diário (03:05 UTC) fecha agendas passadas, expurga diagnósticos antigos (30 dias) e roda a retenção: `historico_status`/`historico_agenda` acima de 12 meses e `auditoria` acima de 24 meses, sempre exportadas em JSON para o bucket R2 antes do purge (política em `docs/operations/retencao-e-backup-2026-11-05.md`).
- `shared/`: contratos, validações, datas e parser de importação CSV/PDF (incluindo WASM para PDF).
- `migrations/`: sequência imutável de migrations aplicada pelo Wrangler; não reescrever arquivos já aplicados.
- `tests/unit/`: contratos, segurança, parsers e lógica de Worker; `apps/web/tests/`: navegação e fluxos React no Chromium, com APIs simuladas.
- `.github/workflows/ci.yml`: segurança de dependências, testes, build, dry-run do Worker, E2E e CodeQL em PRs e pushes previstos.

## Tempo real e consistência

O D1 é a fonte de verdade de agendas. O Worker publica eventos `agenda.changed` após gravações, e as telas invalidam consultas React Query para refletir alterações de outras sessões. O painel também possui reconciliação por consulta HTTP periódica (30 segundos para agendas e presença). A produção configura `REALTIME_MODE=on`, com fallback quando o WebSocket não estiver disponível.

## Avisos e notificações in-app

- Tabelas `avisos` e `avisos_lidos` (migration `0022_avisos.sql`): aviso publicado pelo admin (`tipo = "aviso"`) e evento automático do sistema (`tipo = "evento"`); leitura por usuário em PK composta. Migration `0023_avisos_melhorias.sql`: urgência (`urgente`), autor visível (`autor`, desnormalizado do nome no momento da publicação) e direcionamento por loja (`avisos_lojas`).
- Avisos são registro permanente (decisão de 12/11/2026): sem expiração e sem inativação — os últimos 50 são consultados automaticamente e as páginas mais antigas ficam disponíveis por cursor estável, sem aumentar o polling do cabeçalho. As colunas `expira_em`/`inativo_em` de 0022 ficam sem uso.
- Rotas `GET /api/avisos` (histórico + não lidos, filtrado pela loja do conferente e pelo tipo), `POST /api/avisos/:id/lido` (idempotente, restrito ao que o usuário enxerga — mesmo filtro de loja/tipo da listagem), `POST /api/avisos/marcar-todos` (leitura em lote do que o usuário vê) e, para admin, `POST /api/admin/avisos` (publicar com `urgente` e `lojas` opcionais, auditado).
- O canal exclui eventos automáticos para todos os perfis e não gera novos registros desse tipo. Importações, substituições, conclusões e reaberturas preservam a auditoria atômica existente e o histórico da agenda. Eventos legados permanecem no D1, sem exclusão ou migration. A situação da loja continua no Recebimento.
- UI: página Avisos integrada à área principal (`apps/web/src/features/avisos/`), badge de não lidos no menu (pulsa em vermelho com urgente pendente), polling de 30 segundos no canal e 60 segundos no menu. Contratos em `shared/avisos.ts`.

## Comandos

```bash
npm ci --legacy-peer-deps
npx wrangler d1 migrations apply DB --local --config wrangler.local.jsonc
npm run dev
npm test
npm run verify:production
npx playwright test --config apps/web/playwright.config.mjs
```

- `wrangler.local.jsonc`: desenvolvimento com D1 local e sem operações remotas.
- `wrangler.preview.jsonc`: Worker da homologação e D1 separado (deploys automáticos a cada push/merge na `preview`).
- `wrangler.jsonc`: Worker e D1 de produção.
- Cloudflare Workers Builds: build `npm run verify:production` e deploy `npm run deploy:cloudflare`. O comando local `npm run deploy` combina ambas as etapas e **não deve ser executado sem autorização para publicar**.

## Alterações estruturais

Preferir alterações incrementais, testes e CI antes da mesclagem. Não mexer em credenciais, sessões, permissões, D1 remoto ou lógica operacional como efeito colateral de reorganizações.

O canal de comunicação possui um fluxo cronológico único de mensagens e avisos oficiais, busca paginada, leitura individual de mensagens visíveis e confirmação explícita de avisos. A consulta de pendências considera o conjunto completo, não apenas a primeira página. Leituras históricas podem ter sido automáticas.

- Reações: migration aditiva `0030_avisos_reacoes.sql`, chave composta por aviso e usuário, emojis 👍/👀/😂. A API `PUT /api/avisos/:id/reacao` define ou remove (emoji null), exige visibilidade e impede autoria própria. Visualizadores não acessam nenhuma rota do canal.
- O evento realtime `avisos.changed` sinaliza atualização a administradores e conferentes destinatários (sem conteúdo); D1/API permanecem fonte de verdade. Toasts locais só para novas publicações de terceiros, sem alertar reações ou histórico inicial; polling de fallback preservado.

### Organização de consultas de agendas (PR #258)

`worker/repositories/agenda-queries.ts` concentra tipos de linhas e leituras SQL de agendas/agendamentos/históricos, sem dependência de mutações. `worker/repositories/agendas.ts` concentra importação, alterações e guardas transacionais, reexportando os contratos públicos existentes. A separação é por responsabilidade; nenhuma nova camada de abstração ou serviço externo.
