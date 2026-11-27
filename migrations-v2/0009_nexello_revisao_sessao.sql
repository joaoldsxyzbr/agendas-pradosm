-- O rascunho pertence à sessão individual, não apenas à versão de acesso.
-- Rascunhos anteriores sem chave não podem ser confirmados; expiram normalmente.
ALTER TABLE nexello_revisoes_pendentes ADD COLUMN chave_sessao TEXT;

CREATE TRIGGER trg_nexello_revisao_sessao_obrigatoria
BEFORE INSERT ON nexello_revisoes_pendentes
FOR EACH ROW WHEN NEW.chave_sessao IS NULL
  OR length(NEW.chave_sessao)<>40
  OR substr(NEW.chave_sessao,1,4)<>'sid:'
  OR EXISTS (SELECT 1 FROM sessoes_revogadas WHERE session_key=NEW.chave_sessao)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_SESSAO_INVALIDA');
END;
