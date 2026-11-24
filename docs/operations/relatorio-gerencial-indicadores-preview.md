# Indicadores gerenciais (preview)

- Recusados e sem agenda aparecem nos KPIs. Sem agenda é a origem manual, não um status: está incluído no total e não deve ser somado aos demais resultados. O subtítulo distingue os efetivamente recebidos.
- Ocorrências agregam não recebidos, não comparecimentos e recusados, sem duplicidade. Busca e paginação podem ser filtradas por classificação; a lista recente permanece independente.
- Rankings de fornecedores mostram até 12 nomes, sem cadastro único ou fusão de nomes. Totais sem agenda vêm das linhas consolidadas, não do ranking truncado. O total de fornecedores é calculado antes do LIMIT.
- Taxa de recebimento preserva o denominador total, incluindo pendências. Todos os dados respeitam período, lojas selecionadas e escopo autorizado. Nenhuma escrita, migration, mudança de status ou módulo adicional.
- Testar com dados fictícios, validar indicadores, tipos de ocorrência, rankings, filtro por loja e regressão do visualizador. Main e produção não alteradas.
