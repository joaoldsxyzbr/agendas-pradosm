-- Reserva técnica de acesso à API; nenhuma informação comercial ou token.
-- Um único registro para a fonte, compartilhado por todos os usuários da V2.
CREATE TABLE nexello_limite_consulta (
  fonte TEXT NOT NULL PRIMARY KEY CHECK (fonte = 'relatorio_60'),
  proxima_consulta_em INTEGER NOT NULL CHECK (proxima_consulta_em >= 0)
);
