-- Contas personalizadas são fisicamente inativas para runtimes anteriores.
-- A autorização nova lê o estado ativo da configuração; rollback antigo falha fechado.
ALTER TABLE usuario_acesso ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1));
UPDATE usuario_acesso SET ativo=(SELECT u.ativo FROM usuarios u WHERE u.id=usuario_id);
UPDATE usuarios SET ativo=0,session_version=session_version+1 WHERE ativo=1 AND EXISTS (SELECT 1 FROM usuario_acesso a WHERE a.usuario_id=usuarios.id);
CREATE TRIGGER trg_acesso_desativa_papel_legado
AFTER INSERT ON usuario_acesso
FOR EACH ROW
BEGIN
  UPDATE usuarios SET ativo=0,session_version=session_version+1
    WHERE id=NEW.usuario_id AND ativo=1;
END;
CREATE TRIGGER trg_acesso_bloqueia_ativacao_legada
BEFORE UPDATE OF ativo ON usuarios
FOR EACH ROW WHEN NEW.ativo=1 AND EXISTS (SELECT 1 FROM usuario_acesso a WHERE a.usuario_id=NEW.id)
BEGIN
  SELECT RAISE(ABORT,'ACESSO_PERSONALIZADO_ATIVACAO_LEGADA');
END;
