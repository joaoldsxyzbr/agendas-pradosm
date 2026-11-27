# Sincronização manual de agendas via API

Status: proposta em desenvolvimento; implementação bloqueada pela leitura do contrato externo.

## Objetivo e escopo
Permitir ao administrador consultar a plataforma de origem a partir da tela de importação, escolher data/lojas, revisar inclusões, alterações e cancelamentos e confirmar a gravação. Manter CSV/PDF como contingência. Não adicionar cron, R2, dependências ou serviços pagos. TypeScript estrito, validação Zod e infraestrutura existente.

Referência: https://documenter.getpostman.com/view/10499406/2s9YXmZ1E7 (API v2 - Integração de Clientes). Em 2026-11-27, a página retornou título, mas não expôs o conteúdo dos endpoints à ferramenta de leitura. Não há contrato validado nem teste autenticado. Solicitar coleção Postman JSON sanitizada ou documentação equivalente.

## 1. Descoberta obrigatória antes de implementar
- Identificar endpoint(s) de consulta, método HTTP, host oficial, autenticação, expiração/renovação, escopos de leitura, limites e condições comerciais.
- Confirmar filtros de data, fuso, filial, paginação e semântica de snapshot completo versus incremental; distinguir resposta vazia válida, erro e resultado parcial.
- Confirmar identificador estável do agendamento, unicidade, remarcações entre datas/lojas, cancelamentos e mapeamento de cada campo usado hoje (protocolo, horários, fornecedor, itens, volumes, paletes, carga batida, tipo, NFe, pedidos).
- Obter exemplos sanitizados de sucesso, vazio, cancelamento, paginação e erros. Nunca versionar credenciais ou dados reais de produção.
- Verificar limites do Worker/D1 e API para o volume real; definir escopo máximo por operação. Não assumir que o plano gratuito suporta qualquer volume.

## 2. Arquitetura proposta
Fluxo: administrador -> Worker -> API externa (somente leitura) -> normalização e validação -> prévia -> confirmação -> D1 -> publicação realtime.
- Cliente externo exclusivamente no Worker, host fixo validado, Secrets para credenciais, timeout e limites de resposta/páginas; não aceitar URLs do navegador nem expor tokens, cabeçalhos ou corpos sensíveis em logs.
- Adaptador específico após confirmar contrato, convertendo resposta validada para tipos compartilhados de importação. Evitar abstrações genéricas para provedores inexistentes.
- Extrair/reutilizar orquestração da importação existente onde necessário, sem duplicar persistência. Referências: shared/agenda.ts, shared/import/validateImportBatch.ts, worker/routes/admin-agendas.ts, worker/repositories/agenda-imports.ts, apps/web/src/features/import/import-model.ts.
- Rotas administrativas autenticadas, com autorização/CSRF equivalentes às rotas existentes. Prévia sem gravação; confirmação vinculada ao usuário, escopo e versão/conteúdo revisado, sem confiar em payload externo editável pelo cliente. Se houver alteração concorrente da agenda ou da fonte entre prévia e confirmação, rejeitar e solicitar nova prévia.
- Validar o lote inteiro antes de gravar. Reutilizar transação D1, versão de importação, auditoria e publicação realtime; avaliar limite existente de 800 statements e limites efetivos do plano. Não prometer atomicidade global se houver divisão em lotes; neste caso definir e comunicar unidade atômica antes de implementar.
- Interface na tela existente: data (fuso de negócio), loja/todas, botão Sincronizar agendas, estado de carregamento, resumo de diferenças, confirmação e resultado. Manter importação de arquivos intacta. Desabilitar integração de modo explícito quando não configurada; sem novos segredos obrigatórios para deploys existentes.

## 3. Integridade e regras operacionais
O repositório atual inativa registros importados ausentes em uma substituição; NÃO encaminhar uma resposta paginada incompleta ou incremental para essa rotina como snapshot. Só permitir inativação por ausência se completude e semântica do fornecedor estiverem comprovadas e o operador confirmar. Vazio inesperado, falha de página, loja desconhecida, campo inválido, identificador duplicado, timeout ou inconsistência devem bloquear gravação. Cancelamento e remarcação de registros já conferidos exigem regra explícita e revisão; não apagar histórico.
- Preservar IDs, status, observações, trocas, conferência, registros manuais e auditoria local; não sobrescrever campos operacionais com dados externos.
- Verificar correspondência com protocolos já importados por arquivo. Se identificadores divergirem, bloquear conflito até definição de mapeamento/migração, sem criar duplicatas.
- Repetir a mesma sincronização não deve alterar dados/versão sem necessidade nem criar duplicatas; auditar o acionamento conforme política existente.
- Proteger confirmação simultânea e concorrência com importação manual. Publicar mudanças somente após commit; falha de notificação não deve ser relatada como rollback se D1 já confirmou.
- Não fazer escrita na plataforma externa. Não executar consultas de produção sem configuração/autorização.

## 4. Implementação e validação (checklist)
- [ ] Contrato da API e exemplos confirmados; mapeamento de identidade, filial, datas, cancelamentos e custos revisado.
- [ ] Cliente/adaptador estrito e testes com respostas fictícias.
- [ ] Prévia e confirmação protegidas; reutilização do fluxo de persistência.
- [ ] UI e testes de regressão da importação CSV/PDF.
- [ ] Testes: dados inválidos, 401/403, 429, 5xx, timeout, paginação interrompida, resposta vazia, duplicidade, remarcação/cancelamento, repetição, concorrência, preservação de campos locais, rollback e realtime.
- [ ] Testes locais com D1 local e fixtures sanitizadas; nenhuma escrita em D1 remoto de preview ou produção.
- [ ] Revisar compatibilidade com hardening #257 (aberta na data desta proposta); atualizar branch com main após alterações relevantes e resolver conflitos.
- [ ] CI completo verde, revisar diff e impacto de deploy; testar credencial de leitura autorizada em ambiente apropriado.
- [ ] Merge somente com autorização explícita.

## 5. Operação e reversão
Documentar configuração de Secrets sem valores, erros seguros, forma de desativar a integração e contingência CSV/PDF. Preferir nenhuma migração de banco se o contrato permitir; qualquer migração deve ser justificada, aditiva e revisada. A implantação inicial não deve ativar sincronização automática nem remover a funcionalidade atual.

Esta revisão inicial é documental: nenhum código executável, configuração de produção ou banco foi alterado.
