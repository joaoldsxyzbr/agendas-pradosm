-- Revisão temporária preparada exclusivamente pelo servidor.
-- Payload normalizado, não a resposta bruta da Nexello. Removido ao confirmar,
-- cancelar ou expirar. A trilha definitiva reside em sincronizacoes/evidencias.
CREATE TABLE nexello_revisoes_pendentes (
  id TEXT NOT NULL PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  versao_sessao INTEGER NOT NULL CHECK (versao_sessao >= 1),
  hash_conteudo TEXT NOT NULL CHECK (length(hash_conteudo)=64 AND hash_conteudo NOT GLOB '*[^0-9a-f]*'),
  conteudo TEXT NOT NULL CHECK (length(conteudo)<=262144 AND json_valid(conteudo)),
  criado_em TEXT NOT NULL,
  expira_em TEXT NOT NULL CHECK (expira_em > criado_em)
);
CREATE INDEX idx_nexello_revisoes_expira ON nexello_revisoes_pendentes(expira_em);
CREATE INDEX idx_nexello_revisoes_usuario ON nexello_revisoes_pendentes(usuario_id);
CREATE TRIGGER trg_nexello_revisao_pendente_imutavel
BEFORE UPDATE ON nexello_revisoes_pendentes
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_REVISAO_IMUTAVEL');
END;
