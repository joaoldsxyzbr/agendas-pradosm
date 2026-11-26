-- Expansão compatível com o Worker anterior; manter código histórico.
ALTER TABLE avisos_lojas ADD COLUMN loja_id TEXT REFERENCES lojas(id);
UPDATE avisos_lojas SET loja_id = (SELECT id FROM lojas WHERE codigo = avisos_lojas.loja) WHERE loja_id IS NULL;
-- Escritas do Worker anterior durante a janela de deploy também recebem o ID.
CREATE TRIGGER trg_avisos_lojas_resolve_id AFTER INSERT ON avisos_lojas
WHEN NEW.loja_id IS NULL
BEGIN
  UPDATE avisos_lojas SET loja_id = (SELECT id FROM lojas WHERE codigo = NEW.loja)
   WHERE aviso_id = NEW.aviso_id AND loja = NEW.loja;
END;
-- A paginação não filtra inativo_em; índice compatível com a ordem real.
CREATE INDEX idx_avisos_criado_id ON avisos(criado_em DESC, id DESC);
