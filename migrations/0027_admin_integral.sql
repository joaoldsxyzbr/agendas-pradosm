-- Protege um administrador integral legado, independentemente de perfis personalizados.
-- Sem backfill. Permite bootstrap em banco sem administradores.
CREATE TRIGGER trg_acesso_preserva_admin_integral_insert
BEFORE INSERT ON usuario_acesso
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM usuarios WHERE id=NEW.usuario_id AND papel='admin' AND ativo=1 AND excluido_em IS NULL)
  AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id<>NEW.usuario_id AND u.papel='admin' AND u.ativo=1 AND u.excluido_em IS NULL
    AND NOT EXISTS (SELECT 1 FROM usuario_acesso a WHERE a.usuario_id=u.id))
BEGIN
  SELECT RAISE(ABORT,'ULTIMO_ADMIN_INTEGRAL');
END;

CREATE TRIGGER trg_acesso_preserva_admin_integral_usuario
BEFORE UPDATE OF papel, ativo, excluido_em ON usuarios
FOR EACH ROW
WHEN OLD.papel='admin' AND OLD.ativo=1 AND OLD.excluido_em IS NULL
  AND NOT EXISTS (SELECT 1 FROM usuario_acesso WHERE usuario_id=OLD.id)
  AND NOT (NEW.papel='admin' AND NEW.ativo=1 AND NEW.excluido_em IS NULL)
  AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id<>OLD.id AND u.papel='admin' AND u.ativo=1 AND u.excluido_em IS NULL
    AND NOT EXISTS (SELECT 1 FROM usuario_acesso a WHERE a.usuario_id=u.id))
BEGIN
  SELECT RAISE(ABORT,'ULTIMO_ADMIN_ATIVO');
END;

CREATE TRIGGER trg_acesso_preserva_admin_integral_delete
BEFORE DELETE ON usuarios
FOR EACH ROW
WHEN OLD.papel='admin' AND OLD.ativo=1 AND OLD.excluido_em IS NULL
  AND NOT EXISTS (SELECT 1 FROM usuario_acesso WHERE usuario_id=OLD.id)
  AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id<>OLD.id AND u.papel='admin' AND u.ativo=1 AND u.excluido_em IS NULL
    AND NOT EXISTS (SELECT 1 FROM usuario_acesso a WHERE a.usuario_id=u.id))
BEGIN
  SELECT RAISE(ABORT,'ULTIMO_ADMIN_ATIVO');
END;
-- A identidade da configuração é imutável; trocar de usuário exige nova gravação.
CREATE TRIGGER trg_acesso_usuario_imutavel
BEFORE UPDATE OF usuario_id ON usuario_acesso
FOR EACH ROW WHEN OLD.usuario_id<>NEW.usuario_id
BEGIN
  SELECT RAISE(ABORT,'ACESSO_USUARIO_IMUTAVEL');
END;
