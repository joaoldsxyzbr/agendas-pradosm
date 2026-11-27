-- PROPOSTA: aplicar somente após aprovação do contrato, backup e validação D1.
-- Um único batch atômico; manter foreign_keys ON. Não executar isoladamente.
-- Reconstruir o pai e os dois filhos para preservar os registros com CASCADE.
CREATE TABLE avisos_v2_novo (
  id TEXT NOT NULL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('aviso','evento','chat')),
  titulo TEXT,
  mensagem TEXT NOT NULL,
  criado_por TEXT REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  expira_em TEXT,
  inativo_em TEXT,
  urgente INTEGER NOT NULL DEFAULT 0 CHECK (urgente IN (0,1)),
  autor TEXT NOT NULL DEFAULT 'Sistema'
);
CREATE TABLE avisos_lidos_v2_novo (
  aviso_id TEXT NOT NULL REFERENCES avisos_v2_novo(id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  lido_em TEXT NOT NULL,
  PRIMARY KEY (aviso_id, usuario_id)
);
CREATE TABLE avisos_lojas_v2_novo (
  aviso_id TEXT NOT NULL REFERENCES avisos_v2_novo(id) ON DELETE CASCADE,
  loja TEXT NOT NULL,
  loja_id TEXT REFERENCES lojas(id),
  PRIMARY KEY (aviso_id, loja)
);
INSERT INTO avisos_v2_novo (id,tipo,titulo,mensagem,criado_por,criado_em,expira_em,inativo_em,urgente,autor)
  SELECT id,tipo,titulo,mensagem,criado_por,criado_em,expira_em,inativo_em,urgente,autor FROM avisos;
INSERT INTO avisos_lidos_v2_novo (aviso_id,usuario_id,lido_em)
  SELECT aviso_id,usuario_id,lido_em FROM avisos_lidos;
INSERT INTO avisos_lojas_v2_novo (aviso_id,loja,loja_id)
  SELECT x.aviso_id,x.loja,l.id FROM avisos_lojas x LEFT JOIN lojas l ON l.codigo=x.loja;
DROP TABLE avisos_lidos;
DROP TABLE avisos_lojas;
DROP TABLE avisos;
ALTER TABLE avisos_v2_novo RENAME TO avisos;
ALTER TABLE avisos_lidos_v2_novo RENAME TO avisos_lidos;
ALTER TABLE avisos_lojas_v2_novo RENAME TO avisos_lojas;
CREATE INDEX idx_avisos_leitura ON avisos(inativo_em,criado_em DESC);
CREATE INDEX idx_avisos_criado_id ON avisos(criado_em DESC,id DESC);
CREATE TABLE avisos_reacoes (
  aviso_id TEXT NOT NULL REFERENCES avisos(id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  emoji TEXT NOT NULL CHECK (emoji IN ('👍','👀','😂')),
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (aviso_id,usuario_id)
);
CREATE TRIGGER trg_avisos_lojas_resolve_id AFTER INSERT ON avisos_lojas
WHEN NEW.loja_id IS NULL
BEGIN
  UPDATE avisos_lojas SET loja_id=(SELECT id FROM lojas WHERE codigo=NEW.loja)
    WHERE aviso_id=NEW.aviso_id AND loja=NEW.loja;
END;
