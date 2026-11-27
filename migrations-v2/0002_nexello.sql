-- V2: metadados de sincronização separados da conferência.
-- Sem dados brutos, credenciais ou unicidade global presumida do protocolo.
CREATE TABLE sincronizacoes_nexello (
  id TEXT NOT NULL PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  data_inicio TEXT NOT NULL,
  data_fim TEXT NOT NULL CHECK (data_fim >= data_inicio),
  loja_id TEXT REFERENCES lojas(id),
  situacao TEXT NOT NULL CHECK (situacao IN ('em_revisao','confirmada','abortada')),
  hash_conteudo TEXT NOT NULL CHECK (length(hash_conteudo) = 64 AND hash_conteudo NOT GLOB '*[^0-9a-f]*'),
  linhas_lidas INTEGER NOT NULL CHECK (linhas_lidas >= 0),
  conflitos INTEGER NOT NULL DEFAULT 0 CHECK (conflitos >= 0),
  criado_em TEXT NOT NULL,
  finalizado_em TEXT,
  CHECK ((situacao = 'em_revisao' AND finalizado_em IS NULL) OR
         (situacao IN ('confirmada','abortada') AND finalizado_em IS NOT NULL))
);
CREATE INDEX idx_sincronizacoes_nexello_usuario ON sincronizacoes_nexello(usuario_id, criado_em DESC);

-- Um vínculo só existe após decisão comprovada de associação ao registro local.
-- Estado informado pelo relatório 60 sem situação explícita é desconhecido.
CREATE TABLE agendamento_nexello (
  agendamento_id TEXT NOT NULL PRIMARY KEY REFERENCES agendamentos(id),
  sincronizacao_id TEXT NOT NULL REFERENCES sincronizacoes_nexello(id),
  estado_externo TEXT NOT NULL DEFAULT 'desconhecido'
    CHECK (estado_externo IN ('desconhecido','pendente','confirmado','cancelado','recusado')),
  evidencia TEXT NOT NULL CHECK (evidencia IN ('relatorio_60','csv_situacao','revisao_admin','api_estado')),
  observado_em TEXT NOT NULL,
  hash_conteudo TEXT NOT NULL CHECK (length(hash_conteudo) = 64 AND hash_conteudo NOT GLOB '*[^0-9a-f]*'),
  CHECK (evidencia <> 'relatorio_60' OR estado_externo = 'desconhecido')
);
CREATE INDEX idx_agendamento_nexello_sincronizacao ON agendamento_nexello(sincronizacao_id);

-- Destino externo explícito. Doca vazia significa filial que não exige doca,
-- nunca uma doca desconhecida do CD. Um código deve ser validado na operação.
CREATE TABLE nexello_destinos (
  filial_externa TEXT NOT NULL CHECK (length(trim(filial_externa)) > 0 AND filial_externa = trim(filial_externa)),
  doca_externa TEXT NOT NULL DEFAULT '' CHECK (doca_externa = trim(doca_externa)),
  loja_id TEXT NOT NULL REFERENCES lojas(id),
  criado_por TEXT NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  PRIMARY KEY (filial_externa, doca_externa),
  CHECK (upper(filial_externa) <> 'CD' OR length(doca_externa) > 0)
);
CREATE INDEX idx_nexello_destinos_loja ON nexello_destinos(loja_id);

CREATE TRIGGER trg_agendamento_nexello_nao_manual
BEFORE INSERT ON agendamento_nexello
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM agendamentos WHERE id = NEW.agendamento_id AND origem = 'manual'
)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_VINCULO_MANUAL');
END;

CREATE TRIGGER trg_agendamento_nexello_id_imutavel
BEFORE UPDATE OF agendamento_id ON agendamento_nexello
FOR EACH ROW WHEN OLD.agendamento_id <> NEW.agendamento_id
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_VINCULO_IMUTAVEL');
END;

CREATE TRIGGER trg_agendamento_nexello_preserva_origem
BEFORE UPDATE OF origem ON agendamentos
FOR EACH ROW WHEN NEW.origem = 'manual' AND EXISTS (
  SELECT 1 FROM agendamento_nexello WHERE agendamento_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_VINCULO_MANUAL');
END;
