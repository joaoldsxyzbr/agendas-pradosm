-- A exclusão lógica preserva agendas históricas, mas não pode deixar
-- cadastros de usuários não excluídos apontando para uma loja removida.
CREATE TRIGGER trg_loja_exclusao_sem_usuarios
BEFORE UPDATE OF excluido_em ON lojas
FOR EACH ROW WHEN OLD.excluido_em IS NULL AND NEW.excluido_em IS NOT NULL
AND (
  EXISTS (SELECT 1 FROM usuarios u WHERE u.loja_id=OLD.id AND u.excluido_em IS NULL)
  OR EXISTS (SELECT 1 FROM usuario_acesso_lojas a JOIN usuarios u ON u.id=a.usuario_id
    WHERE a.loja_id=OLD.id AND u.excluido_em IS NULL)
)
BEGIN
  SELECT RAISE(ABORT,'LOJA_POSSUI_USUARIOS');
END;
CREATE TRIGGER trg_usuario_loja_disponivel_insert
BEFORE INSERT ON usuarios
FOR EACH ROW WHEN NEW.excluido_em IS NULL AND NEW.loja_id IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM lojas WHERE id=NEW.loja_id AND excluido_em IS NULL)
BEGIN
  SELECT RAISE(ABORT,'LOJA_NAO_ENCONTRADA');
END;
CREATE TRIGGER trg_usuario_loja_disponivel_update
BEFORE UPDATE OF loja_id,excluido_em ON usuarios
FOR EACH ROW WHEN NEW.excluido_em IS NULL AND NEW.loja_id IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM lojas WHERE id=NEW.loja_id AND excluido_em IS NULL)
BEGIN
  SELECT RAISE(ABORT,'LOJA_NAO_ENCONTRADA');
END;
CREATE TRIGGER trg_acesso_loja_disponivel_insert
BEFORE INSERT ON usuario_acesso_lojas
FOR EACH ROW WHEN NOT EXISTS (SELECT 1 FROM lojas WHERE id=NEW.loja_id AND ativo=1 AND excluido_em IS NULL)
BEGIN
  SELECT RAISE(ABORT,'LOJA_NAO_ENCONTRADA');
END;
CREATE TRIGGER trg_acesso_loja_disponivel_update
BEFORE UPDATE OF loja_id ON usuario_acesso_lojas
FOR EACH ROW WHEN NOT EXISTS (SELECT 1 FROM lojas WHERE id=NEW.loja_id AND ativo=1 AND excluido_em IS NULL)
BEGIN
  SELECT RAISE(ABORT,'LOJA_NAO_ENCONTRADA');
END;
