# Direção visual — Agenda Prado V2

Referência de processo: frontend-design da Anthropic (https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md), consultada em 27/11/2026. Aplicamos direção própria e revisão crítica, não um template. Este é o primeiro lote do redesign, não uma aprovação visual final.

## Brief
Sistema empresarial interno de recebimento; diretor precisa compreender operação e confiabilidade; administrador precisa encontrar exceções; conferente precisa agir rapidamente. Uma estética de controle logístico, com informação real e precisão, em vez de landing page de vendas.

## Decisão de design
Paleta: tinta #101a23 (navegação), fundo #131c25 (área de trabalho), painel #192734, divisores #344956, texto #e8eef4 e sinal #90c8df (interação). Verde, âmbar e vermelho reservados a estados. Tipografia Segoe UI / system-ui, sem fontes remotas; números tabulares, títulos sem excesso de peso, texto de operação 13–14px. Mantemos tema escuro nesta primeira etapa para evitar regressões de contraste nas telas legadas; reavaliar com usuários. O símbolo geométrico de doca é uma marca de produto proposta, não o logotipo oficial da empresa.

Layout: login dividido entre identidade/processo real e formulário; navegação lateral estável com indicador linear ativo, área operacional ampla; recebimento como matriz de lojas e progresso, não coleção de cards decorativos. Priorizamos rótulos úteis, hierarquia, densidade legível, controles consistentes, foco de teclado, responsividade e estados vazios/erro objetivos.

Crítica antes de implementar: uma landing page com números gigantes, gradientes, badges e ilustrações abstratas não explica o produto. Removemos essa direção e escolhemos o fluxo real de operação como assinatura visual. Sem movimento gratuito, marketing fictício ou valores demonstrativos apresentados como reais. Não adicionar dependências.

## Lotes e critérios
1. Identidade, tokens, login e navegação; componentes compartilhados e recebimento.
2. Agendas e integração Nexello: revisão, divergências, data/filial, origem e estado desconhecido; não simular integração funcional.
3. Conferência, histórico, relatórios gerenciais (leitura executiva e detalhamento), usuários, lojas, avisos e auditoria; consistência visual e sem perda de permissões/funcionalidades.
4. Testes E2E e revisão por screenshots em desktop, tablet e celular; contraste, teclado, zoom 200%, overflow, foco, acessibilidade, estados de loading/erro/vazio. Testar também arrastar menu e login local.
5. Apresentação ao diretor somente com dados fictícios ou autorizados e status da integração claro. Sem deploy ou merge sem autorização. Revisão visual ainda pendente.

A mudança de tema é intencionalmente gradual: manter o comportamento e refinar o design de cada tela com critérios próprios. O novo banco e a sincronização continuam em desenvolvimento separado.
