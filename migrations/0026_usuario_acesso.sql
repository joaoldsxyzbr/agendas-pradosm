-- Estrutura aditiva para perfis efetivos e exceções de acesso (#248).
-- Ausência de configuração significa legado; nenhuma conta é alterada aqui.
-- Não ativar a leitura/escrita dessas tabelas antes da integração completa.
CREATE TABLE usuario_acesso (
  usuario_id TEXT NOT NULL PRIMARY KEY REFERENCES usuarios(id),
  perfil TEXT NOT NULL CHECK (perfil IN ('admin', 'agendador', 'visualizador', 'conferente')),
  escopo TEXT NOT NULL CHECK (escopo IN ('todas', 'vinculadas')),
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
