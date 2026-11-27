-- Agendas Prado V2: baseline para banco vazio; não aplicar em bancos V1.
PRAGMA foreign_keys = ON;

CREATE TABLE lojas (
  id TEXT NOT NULL PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  excluido_em TEXT
);
CREATE INDEX idx_lojas_excluido ON lojas(excluido_em);
CREATE UNIQUE INDEX idx_lojas_codigo_nocase ON lojas(codigo COLLATE NOCASE);

CREATE TABLE usuarios (
  id TEXT NOT NULL PRIMARY KEY,
  loja_id TEXT REFERENCES lojas(id),
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'conferente' CHECK (papel IN ('admin','conferente','visualizador')),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  excluido_em TEXT,
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
  CHECK (papel <> 'conferente' OR loja_id IS NOT NULL)
);
CREATE UNIQUE INDEX idx_usuarios_login_nocase ON usuarios(login COLLATE NOCASE);
CREATE INDEX idx_usuarios_papel_excluido ON usuarios(papel, excluido_em);

CREATE TABLE agendas (
  id TEXT NOT NULL PRIMARY KEY,
  loja_id TEXT NOT NULL REFERENCES lojas(id),
  data_agenda TEXT NOT NULL,
  arquivo_original TEXT NOT NULL,
  criado_por TEXT NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  status_dia TEXT NOT NULL DEFAULT 'aberto' CHECK (status_dia IN ('aberto','concluido')),
  concluido_em TEXT,
  concluido_por TEXT REFERENCES usuarios(id),
  digitado_em TEXT,
  digitado_por TEXT REFERENCES usuarios(id),
  versao_importacao INTEGER NOT NULL DEFAULT 0 CONSTRAINT ck_agenda_versao_importacao CHECK (versao_importacao >= 0),
  UNIQUE (loja_id, data_agenda)
);

CREATE TABLE agendamentos (
  id TEXT NOT NULL PRIMARY KEY,
  agenda_id TEXT NOT NULL REFERENCES agendas(id),
  protocolo TEXT NOT NULL,
  horario_inicio TEXT NOT NULL,
  horario_fim TEXT NOT NULL,
  fornecedor TEXT NOT NULL,
  itens INTEGER CHECK (itens IS NULL OR itens >= 0),
  volumes INTEGER CHECK (volumes IS NULL OR volumes >= 0),
  paletes INTEGER CHECK (paletes IS NULL OR paletes >= 0),
  carga_batida TEXT,
  tipo TEXT,
  nfe TEXT NOT NULL DEFAULT '[]',
  pedidos TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','recebido','nao_chegou','recusado')),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'importado' CHECK (origem IN ('importado','manual')),
  trocas INTEGER NOT NULL DEFAULT 0 CHECK (trocas IN (0,1)),
  observacao TEXT,
  csv_campos TEXT,
  UNIQUE (agenda_id, protocolo)
);
CREATE INDEX idx_agendas_loja_data ON agendas(loja_id, data_agenda);
CREATE INDEX idx_agendamentos_agenda_horario ON agendamentos(agenda_id, horario_inicio);
-- Busca de possíveis remarcações; não é uma afirmação de unicidade global.
CREATE INDEX idx_agendamentos_protocolo ON agendamentos(protocolo);

CREATE TABLE historico_status (
  id TEXT NOT NULL PRIMARY KEY,
  agendamento_id TEXT NOT NULL REFERENCES agendamentos(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  status_anterior TEXT NOT NULL,
  status_novo TEXT NOT NULL,
  alterado_em TEXT NOT NULL,
  observacao TEXT
);
CREATE INDEX idx_historico_agendamento ON historico_status(agendamento_id, alterado_em);


CREATE TABLE historico_agenda (
  id TEXT NOT NULL PRIMARY KEY,
  agenda_id TEXT NOT NULL REFERENCES agendas(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  acao TEXT NOT NULL CHECK (acao IN ('concluido', 'reaberto', 'ajuste_admin')),
  detalhes TEXT,
  alterado_em TEXT NOT NULL
);

CREATE INDEX idx_historico_agenda
ON historico_agenda(agenda_id, alterado_em);

CREATE TABLE auditoria (
  id TEXT NOT NULL PRIMARY KEY,
  usuario_id TEXT REFERENCES usuarios(id),
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id TEXT NOT NULL,
  loja_id TEXT REFERENCES lojas(id),
  agenda_id TEXT REFERENCES agendas(id),
  agendamento_id TEXT REFERENCES agendamentos(id),
  antes TEXT,
  depois TEXT,
  detalhes TEXT,
  criado_em TEXT NOT NULL
);

CREATE INDEX idx_auditoria_entidade
ON auditoria(entidade, entidade_id, criado_em);

CREATE INDEX idx_auditoria_agenda
ON auditoria(agenda_id, criado_em);

CREATE INDEX idx_auditoria_usuario
ON auditoria(usuario_id, criado_em);

CREATE INDEX idx_auditoria_criado_em
ON auditoria(criado_em);

CREATE TABLE conferente_presenca (
  usuario_id TEXT NOT NULL PRIMARY KEY,
  loja_id TEXT NOT NULL,
  ultima_interacao_em TEXT,
  ultimo_sinal_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id)
);

CREATE INDEX idx_conferente_presenca_loja
  ON conferente_presenca(loja_id);

CREATE TABLE diagnosticos (
  id TEXT NOT NULL PRIMARY KEY,
  usuario_id TEXT REFERENCES usuarios(id),
  origem TEXT NOT NULL CHECK (origem IN ('browser', 'worker')),
  nivel TEXT NOT NULL CHECK (nivel IN ('info', 'warning', 'error')),
  evento TEXT NOT NULL,
  operacao TEXT NOT NULL,
  formato TEXT,
  quantidade INTEGER,
  http_status INTEGER,
  correlacao TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  loja_id TEXT REFERENCES lojas(id),
  duracao_ms INTEGER
);
CREATE INDEX idx_diagnosticos_data ON diagnosticos(criado_em DESC);
CREATE INDEX idx_diagnosticos_filtro ON diagnosticos(nivel, operacao, criado_em DESC);
CREATE INDEX idx_diagnosticos_usuario ON diagnosticos(usuario_id, criado_em DESC);
CREATE INDEX idx_diagnosticos_loja ON diagnosticos(loja_id, criado_em DESC);

CREATE TABLE agenda_digitacao_fornecedor (
  agenda_id TEXT NOT NULL REFERENCES agendas(id),
  fornecedor_chave TEXT NOT NULL,
  fornecedor_nome TEXT NOT NULL,
  dados_hash TEXT NOT NULL,
  digitado_em TEXT,
  digitado_por TEXT REFERENCES usuarios(id),
  PRIMARY KEY (agenda_id, fornecedor_chave)
);

CREATE TABLE avisos (
  id TEXT NOT NULL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('aviso', 'evento')),
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  criado_por TEXT REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  expira_em TEXT,
  inativo_em TEXT,
  urgente INTEGER NOT NULL DEFAULT 0 CHECK (urgente IN (0,1)),
  autor TEXT NOT NULL DEFAULT 'Sistema'
);

CREATE TABLE avisos_lidos (
  aviso_id TEXT NOT NULL REFERENCES avisos(id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  lido_em TEXT NOT NULL,
  PRIMARY KEY (aviso_id, usuario_id)
);

CREATE INDEX idx_avisos_leitura
  ON avisos (inativo_em, criado_em DESC);
CREATE TABLE avisos_lojas (
  aviso_id TEXT NOT NULL REFERENCES avisos(id) ON DELETE CASCADE,
  loja TEXT NOT NULL,
  PRIMARY KEY (aviso_id, loja)
);

CREATE TABLE sessoes_revogadas (
  session_key TEXT NOT NULL PRIMARY KEY,
  expira_em INTEGER NOT NULL
);
CREATE INDEX idx_sessoes_revogadas_expira_em ON sessoes_revogadas(expira_em);

CREATE TABLE usuario_acesso (
  usuario_id TEXT NOT NULL PRIMARY KEY REFERENCES usuarios(id),
  perfil TEXT NOT NULL CHECK (perfil IN ('admin', 'agendador', 'digitador', 'visualizador', 'conferente')),
  escopo TEXT NOT NULL CHECK (escopo IN ('todas', 'vinculadas')),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  UNIQUE (usuario_id, escopo)
);

CREATE TABLE usuario_acesso_lojas (
  usuario_id TEXT NOT NULL,
  escopo TEXT NOT NULL DEFAULT 'vinculadas' CHECK (escopo = 'vinculadas'),
  loja_id TEXT NOT NULL REFERENCES lojas(id),
  PRIMARY KEY (usuario_id, loja_id),
  FOREIGN KEY (usuario_id, escopo) REFERENCES usuario_acesso(usuario_id, escopo)
);
CREATE INDEX idx_usuario_acesso_lojas_loja ON usuario_acesso_lojas(loja_id);

CREATE TABLE usuario_acesso_excecoes (
  usuario_id TEXT NOT NULL REFERENCES usuario_acesso(usuario_id),
  permissao TEXT NOT NULL CHECK (length(trim(permissao)) > 0 AND permissao = trim(permissao)),
  efeito TEXT NOT NULL CHECK (efeito IN ('allow', 'deny')),
  PRIMARY KEY (usuario_id, permissao)
);

CREATE TRIGGER trg_usuarios_preserva_ultimo_admin_update
BEFORE UPDATE OF papel, ativo, excluido_em ON usuarios
FOR EACH ROW
WHEN OLD.papel = 'admin'
  AND OLD.ativo = 1
  AND OLD.excluido_em IS NULL
  AND NOT (
    NEW.papel = 'admin'
    AND NEW.ativo = 1
    AND NEW.excluido_em IS NULL
  )
  AND (
    SELECT COUNT(*)
    FROM usuarios
    WHERE papel = 'admin'
      AND ativo = 1
      AND excluido_em IS NULL
  ) <= 1
BEGIN
  SELECT RAISE(ABORT, 'ULTIMO_ADMIN_ATIVO');
END;

CREATE TRIGGER trg_usuarios_preserva_ultimo_admin_delete
BEFORE DELETE ON usuarios
FOR EACH ROW
WHEN OLD.papel = 'admin'
  AND OLD.ativo = 1
  AND OLD.excluido_em IS NULL
  AND (
    SELECT COUNT(*)
    FROM usuarios
    WHERE papel = 'admin'
      AND ativo = 1
      AND excluido_em IS NULL
  ) <= 1
BEGIN
  SELECT RAISE(ABORT, 'ULTIMO_ADMIN_ATIVO');
END;

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
