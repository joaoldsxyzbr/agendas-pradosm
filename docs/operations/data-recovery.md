# Recuperação de dados do D1

Este runbook descreve como responder a perda, corrupção ou alteração operacional indevida no banco D1 de produção do `agendas-pradosm`.

## Princípios

- O banco de produção é `agendas-pradosm`.
- Recuperação de dados é uma operação de incidente, não parte do fluxo normal de deploy. Exige autorização explícita do responsável para cada restore remoto, inclusive para desfazê-lo.
- Para erro localizado e reversível pela própria aplicação, prefira correção funcional/auditável em vez de restaurar o banco inteiro.
- Não execute `DELETE`, `DROP`, alteração manual de schema ou restauração por tentativa e erro.
- Antes de qualquer restore, preserve o ponto atual para permitir retorno ao estado anterior caso a hipótese de recuperação esteja errada.

## 1. Confirmar o incidente

Registre no GitHub:

- horário aproximado do primeiro dado incorreto;
- lojas/datas/entidades afetadas;
- ação que antecedeu o incidente;
- último horário conhecido em que os dados estavam corretos;
- responsável pela execução da recuperação.

Use a tabela `auditoria`, o histórico de agenda e os logs do Worker para delimitar a janela. Não inclua segredos, senhas ou dados sensíveis no issue.

## 2. Reduzir novas escritas

Enquanto a janela de recuperação estiver sendo definida:

- suspenda importações e ajustes administrativos;
- avise os conferentes para não alterar agendas afetadas;
- não faça novo deploy ou migration não relacionada ao incidente.

Se o incidente exigir indisponibilidade total para preservar consistência, trate essa decisão explicitamente no registro do incidente antes de continuar.

## 3. Registrar o estado atual

Consulte o bookmark atual do D1 antes do restore:

```bash
npx wrangler d1 time-travel info agendas-pradosm
```

Copie para o registro restrito do incidente (não exponha identificadores de recuperação em issue pública):

- bookmark atual;
- horário UTC da coleta;
- commit atualmente publicado.

Esse bookmark é o ponto de retorno caso seja necessário desfazer a restauração, enquanto estiver disponível na janela do Time Travel. No plano Free a janela documentada é de sete dias; confirme a disponibilidade efetiva de ambos os pontos antes de prosseguir. Bookmark não é backup exportado nem garantia de recuperação fora da janela.

## 4. Resolver o ponto de recuperação

Escolha um timestamp imediatamente anterior ao evento que corrompeu os dados e peça ao D1 o bookmark correspondente:

```bash
npx wrangler d1 time-travel info agendas-pradosm --timestamp="2026-09-30T12:00:00Z"
```

O timestamp deve ser documentado em UTC/RFC3339 para evitar ambiguidade.

Antes de restaurar, confirme que o ponto escolhido é anterior ao incidente e posterior às últimas alterações válidas que precisam ser preservadas.

## 5. Restaurar

A restauração sobrescreve o banco remoto no lugar. Todas as escritas posteriores ao ponto escolhido, inclusive de lojas não afetadas, podem ser perdidas. Delimite e documente essas escritas, confirme o plano de reconciliação, a interrupção de novas escritas e a compatibilidade entre Worker e schema. Execute somente após revisão e autorização explícita:

```bash
npx wrangler d1 time-travel restore agendas-pradosm --timestamp="2026-09-30T12:00:00Z"
```

Também é possível usar o bookmark resolvido:

```bash
npx wrangler d1 time-travel restore agendas-pradosm --bookmark="<BOOKMARK>"
```

Registre o bookmark anterior informado pelo Wrangler ao concluir. Ele permite desfazer o restore se necessário.

Referência oficial: https://developers.cloudflare.com/d1/reference/time-travel/

## 6. Validar depois do restore

Execute, nesta ordem:

1. `/api/health` deve responder HTTP 200 com D1 disponível;
2. login administrativo deve funcionar;
3. dashboard deve carregar as lojas;
4. valide as lojas/datas afetadas contra o estado esperado;
5. confira auditoria e históricos anteriores ao ponto restaurado;
6. confirme que migrations esperadas continuam aplicadas e que o Worker publicado é compatível com o schema restaurado; confira integridade referencial, totais e isolamento dos avisos por ID de loja se a 0031 estiver aplicada;
7. somente então libere novas importações e alterações dos conferentes.

Se o Worker atual depender de schema criado depois do ponto restaurado, não libere o uso. Primeiro alinhe aplicação e schema seguindo o runbook de release.

## 7. Se o restore estiver errado

Não tente “corrigir por cima” imediatamente.

Use o bookmark preservado antes da restauração ou o bookmark de retorno informado pelo Wrangler:

```bash
npx wrangler d1 time-travel restore agendas-pradosm --bookmark="<BOOKMARK_ANTERIOR>"
```

Depois reavalie a janela do incidente e escolha um novo ponto de recuperação.

## 8. Encerramento do incidente

Antes de encerrar:

- registre o ponto restaurado;
- registre validações executadas;
- confirme o commit de produção;
- descreva a causa raiz;
- crie testes/guards quando a causa puder ser evitada por código;
- registre qualquer dado válido perdido entre o ponto restaurado e o incidente para reconciliação manual.

## O que este runbook não autoriza

Este documento não autoriza:

- restaurar produção para testar hipóteses, sem autorização explícita ou como parte do CI;
- usar o D1 remoto em testes automatizados;
- remover migrations já aplicadas;
- editar `d1_migrations` manualmente;
- restaurar banco e publicar código incompatível com o schema resultante;
- executar recuperação sem registrar previamente o ponto atual.

## Exercício de recuperação local (CI)

`tests/unit/data-recovery-local.test.ts` usa exclusivamente SQLite temporário com todas as migrations e fixture sintética. Gera snapshot consistente via VACUUM INTO, simula alteração posterior, reabre o snapshot somente leitura, compara dados e valida integrity_check, foreign_key_check, status, avisos por loja e saúde HTTP. O original é preservado até o fim do exercício. Não é teste do serviço Time Travel da Cloudflare e não autoriza restore remoto. Bookmark de produção foi consultado por leitura em 26/11/2026; janela e procedimento devem ser revalidados em cada incidente real.
