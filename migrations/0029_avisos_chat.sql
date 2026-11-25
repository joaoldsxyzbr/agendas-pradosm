-- Chat do canal de avisos (decisão do João, 25/11/2026): a mensagem
-- comum do canal ("chat") entra na MESMA tabela de avisos como novo tipo, e o
-- título passa a ser opcional — só o aviso oficial do admin exige título.
-- CHECK de tipo e NOT NULL de titulo não são alteráveis por ALTER TABLE no
-- SQLite: a tabela é reconstruída pelo procedimento recomendado
-- (copy-and-rebuild) com foreign_keys desligado, preservando avisos,
-- avisos_lidos e avisos_lojas. A numeração pula para 0029 de propósito:
-- 0026-0028 já existem na branch preview (issue #248) e precisam chegar à
-- main depois sem colisão em d1_migrations, que registra por nome de arquivo.
PRAGMA foreign_keys = OFF;

BEGIN;
CREATE TABLE avisos_novo (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('aviso', 'evento', 'chat')),
  titulo TEXT,
  mensagem TEXT NOT NULL,
  criado_por TEXT REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  expira_em TEXT,
  inativo_em TEXT,
  urgente INTEGER NOT NULL DEFAULT 0 CHECK (urgente IN (0, 1)),
  autor TEXT NOT NULL DEFAULT 'Sistema'
);
INSERT INTO avisos_novo (id, tipo, titulo, mensagem, criado_por, criado_em, expira_em, inativo_em, urgente, autor)
  SELECT id, tipo, titulo, mensagem, criado_por, criado_em, expira_em, inativo_em, urgente, autor
  FROM avisos;
DROP TABLE avisos;
ALTER TABLE avisos_novo RENAME TO avisos;
DROP INDEX IF EXISTS idx_avisos_leitura;
CREATE INDEX idx_avisos_leitura ON avisos (inativo_em, criado_em DESC);
COMMIT;

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
