# Matriz de controles de segurança — issue #259

Referência: [OWASP ASVS](https://owasp.org/projects/ASVS/) e [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/). Matriz inicial de rastreabilidade, não certificação. "Coberto" indica existência de código e teste, não ausência garantida de vulnerabilidades.

| Área | Controle atual | Evidência existente | Lacuna/aceite |
|---|---|---|---|
| Autenticação | PBKDF2-SHA256, salt, hash dummy, rate limiter fail-closed | password-security.test.ts, auth-integration-synthetic.test.ts | Custo 100 mil por decisão operacional; revisar métricas workerd sem aumentar iterações automaticamente |
| Sessão | HMAC, HttpOnly/SameSite, expiração, revogação e versionamento | session-revocation.test.ts, auth-contract.test.ts | Cobrir renovação/expiração, encoding canônico e revogação em runtime real; documentar política de prazo |
| Autorização | Middleware servidor, papéis e escopo por loja | recebimento-api-integrated.test.ts, avisos.test.ts, migrations-worker-smoke.test.ts | Inventariar cada rota/ação e testar IDs de outra loja, visualizador e usuário desativado |
| CSRF | SameSite e validação Origin/Fetch Metadata | mutation-origin-security.test.ts | Smoke com cookie real e origem externa; preservar compatibilidade de clientes sem metadata |
| Injeção | SQL parametrizado, esquemas Zod | shared-contracts.test.ts, validate-import-batch.test.ts | Auditar SQL dinâmico, limites de placeholders e busca literal |
| XSS/headers | React, CSP, headers de segurança | app-contract.test.ts, check-build.mjs | Teste de conteúdo hostil renderizado no navegador; revisar CSP de WASM e evitar HTML não confiável |
| Importação | Limites de payload/lote e validação | validate-import-batch.test.ts, agenda-import-bulk-replace.test.ts | Testes limítrofes em workerd; medir memória e CPU sem arquivos reais |
| Auditoria | Batches D1 e histórico, diagnósticos sanitizados | concurrency-guards.test.ts, diagnostics.test.ts | Revisar logs e erros, testar rollback e evitar exposição de segredos |
| Dependências | Lockfiles, npm audit, CodeQL | CI verify | Manter gates, revisar dependências transitivas e não adicionar ferramentas redundantes |
| Recuperação | Time Travel e runbook | auditoria D1 somente leitura | Restauração isolada não comprovada; não restaurar produção para testar |

Os testes anteriores usam Node/SQLite ou mocks; a PR #258 acrescenta smoke HTTP real em Wrangler com D1 local descartável. A cobertura por rota e o teste de navegador sem mocks ainda são trabalhos pendentes. Sem dados reais, sem credenciais de produção, sem serviços adicionais.

## Evidências da consolidação — 26/11/2026

CI do c538a49: verify, CodeQL, 126 cenários de navegador e smoke real passaram. Smoke exercitou sessão HttpOnly/SameSite, papéis, isolamento de loja, rejeição de origem externa, presença e eventos direcionados, reações, leitura idempotente, revogação HTTP/WebSocket e login/logout da UI sem mocks. Testes Node cobrem encoding canônico e renovação/revogação de sessão. O limite de importação também é verificado na fronteira UTF-8 local. Não substitui teste de expiração/renovação em workerd, inventário completo de autorização, testes XSS adicionais ou restauração isolada. PBKDF2 não foi alterado. Próximo CI inclui smoke tipado e tipos oficiais como gate primário; não considerar esse incremento aprovado antes do resultado.
