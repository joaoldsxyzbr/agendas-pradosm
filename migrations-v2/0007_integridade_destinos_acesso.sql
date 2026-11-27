-- Vínculo F sem doca só é válido enquanto o código local coincide.
-- Impede a troca silenciosa de identidade de uma unidade vinculada.
CREATE TRIGGER trg_nexello_destino_codigo_insert
BEFORE INSERT ON nexello_destinos
FOR EACH ROW WHEN NEW.doca_externa='' AND NEW.filial_externa GLOB 'F[0-9]*'
AND NOT EXISTS (SELECT 1 FROM lojas WHERE id=NEW.loja_id AND codigo=NEW.filial_externa AND ativo=1 AND excluido_em IS NULL)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_DESTINO_INVALIDO');
END;

CREATE TRIGGER trg_nexello_destino_codigo_update
BEFORE UPDATE OF filial_externa,doca_externa,loja_id ON nexello_destinos
FOR EACH ROW WHEN NEW.doca_externa='' AND NEW.filial_externa GLOB 'F[0-9]*'
AND NOT EXISTS (SELECT 1 FROM lojas WHERE id=NEW.loja_id AND codigo=NEW.filial_externa AND ativo=1 AND excluido_em IS NULL)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_DESTINO_INVALIDO');
END;

CREATE TRIGGER trg_loja_nexello_codigo_protegido
BEFORE UPDATE OF codigo ON lojas
FOR EACH ROW WHEN NEW.codigo<>OLD.codigo AND EXISTS (SELECT 1 FROM nexello_destinos WHERE loja_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_LOJA_CODIGO_PROTEGIDO');
END;

-- Defesa adicional: o perfil operacional não pode receber áreas de administração.
CREATE TRIGGER trg_digitador_excecao_administrativa_insert
BEFORE INSERT ON usuario_acesso_excecoes
FOR EACH ROW WHEN NEW.efeito='allow' AND EXISTS (SELECT 1 FROM usuario_acesso WHERE usuario_id=NEW.usuario_id AND perfil='digitador')
AND (NEW.permissao GLOB 'lojas.*' OR NEW.permissao GLOB 'usuarios.*' OR NEW.permissao GLOB 'auditoria.*' OR NEW.permissao GLOB 'diagnosticos.*' OR NEW.permissao GLOB 'retencao.*')
BEGIN
  SELECT RAISE(ABORT,'DIGITADOR_PERMISSAO_RESTRITA');
END;

CREATE TRIGGER trg_digitador_excecao_administrativa_update
BEFORE UPDATE ON usuario_acesso_excecoes
FOR EACH ROW WHEN NEW.efeito='allow' AND EXISTS (SELECT 1 FROM usuario_acesso WHERE usuario_id=NEW.usuario_id AND perfil='digitador')
AND (NEW.permissao GLOB 'lojas.*' OR NEW.permissao GLOB 'usuarios.*' OR NEW.permissao GLOB 'auditoria.*' OR NEW.permissao GLOB 'diagnosticos.*' OR NEW.permissao GLOB 'retencao.*')
BEGIN
  SELECT RAISE(ABORT,'DIGITADOR_PERMISSAO_RESTRITA');
END;

CREATE TRIGGER trg_digitador_perfil_sem_excecoes_administrativas
BEFORE UPDATE OF perfil ON usuario_acesso
FOR EACH ROW WHEN NEW.perfil='digitador' AND EXISTS (
  SELECT 1 FROM usuario_acesso_excecoes e WHERE e.usuario_id=NEW.usuario_id AND e.efeito='allow'
  AND (e.permissao GLOB 'lojas.*' OR e.permissao GLOB 'usuarios.*' OR e.permissao GLOB 'auditoria.*' OR e.permissao GLOB 'diagnosticos.*' OR e.permissao GLOB 'retencao.*')
)
BEGIN
  SELECT RAISE(ABORT,'DIGITADOR_PERMISSAO_RESTRITA');
END;
