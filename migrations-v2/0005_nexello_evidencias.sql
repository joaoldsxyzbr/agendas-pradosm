-- Referência da evidência verificada; não guardar arquivo, payload ou token.
-- Histórico separado do vínculo atual para preservar a trilha de decisões.
CREATE TABLE nexello_evidencias (
  sincronizacao_id TEXT NOT NULL REFERENCES sincronizacoes_nexello(id),
  agendamento_id TEXT NOT NULL REFERENCES agendamentos(id),
  fonte TEXT NOT NULL CHECK (fonte IN ('csv_situacao','api_estado','revisao_admin')),
  estado_externo TEXT NOT NULL CHECK (estado_externo IN ('confirmado','cancelado','recusado','pendente')),
  hash_evidencia TEXT NOT NULL CHECK (length(hash_evidencia)=64 AND hash_evidencia NOT GLOB '*[^0-9a-f]*'),
  hash_registro TEXT NOT NULL CHECK (length(hash_registro)=64 AND hash_registro NOT GLOB '*[^0-9a-f]*'),
  verificado_em TEXT NOT NULL,
  PRIMARY KEY (sincronizacao_id, agendamento_id)
);
CREATE INDEX idx_nexello_evidencias_agendamento ON nexello_evidencias(agendamento_id, verificado_em);

CREATE TRIGGER trg_nexello_evidencia_vinculo
BEFORE INSERT ON nexello_evidencias
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM agendamento_nexello n
  WHERE n.agendamento_id=NEW.agendamento_id
    AND n.sincronizacao_id=NEW.sincronizacao_id
    AND n.estado_externo=NEW.estado_externo
    AND n.evidencia=NEW.fonte
    AND n.hash_conteudo=NEW.hash_registro
)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_EVIDENCIA_VINCULO_INVALIDO');
END;

CREATE TRIGGER trg_nexello_evidencia_imutavel_update
BEFORE UPDATE ON nexello_evidencias
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_EVIDENCIA_IMUTAVEL');
END;

CREATE TRIGGER trg_nexello_evidencia_imutavel_delete
BEFORE DELETE ON nexello_evidencias
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_EVIDENCIA_IMUTAVEL');
END;
