-- Reações do canal: uma por usuário e publicação, sem alterar registros existentes.
CREATE TABLE avisos_reacoes (
  aviso_id TEXT NOT NULL REFERENCES avisos(id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  emoji TEXT NOT NULL CHECK (emoji IN ('👍', '👀', '😂')),
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (aviso_id, usuario_id)
);
