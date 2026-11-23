-- Negação individual de sessões autenticadas, sem armazenar cookies ou segredos.
-- Compatível com sessões existentes e com o versionamento de usuários.
CREATE TABLE sessoes_revogadas (
  session_key TEXT PRIMARY KEY,
  expira_em INTEGER NOT NULL
);
CREATE INDEX idx_sessoes_revogadas_expira_em ON sessoes_revogadas(expira_em);
