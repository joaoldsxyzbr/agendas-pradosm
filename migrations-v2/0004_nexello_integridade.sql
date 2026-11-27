-- Índice para recebimento, relatórios e fechamento por data (sem loja fixa).
CREATE INDEX idx_agendas_data_loja ON agendas(data_agenda, loja_id);

-- O CSV/PDF legado faz substituição integral e altera arquivo_original.
-- Uma agenda que já contém vínculo Nexello não pode passar por esse fluxo.
-- Aborta inclusive o lote D1 inteiro; futuras sincronizações incrementais
-- não devem alterar arquivo_original em uma agenda existente.
CREATE TRIGGER trg_nexello_bloqueia_substituicao_arquivo
BEFORE UPDATE OF arquivo_original ON agendas
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM agendamentos p JOIN agendamento_nexello n ON n.agendamento_id=p.id
  WHERE p.agenda_id=OLD.id
)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_AGENDA_PROTEGIDA');
END;

-- O registro da revisão, uma vez finalizado, não pode ser reaberto ou editado.
CREATE TRIGGER trg_nexello_revisao_final_imutavel
BEFORE UPDATE ON sincronizacoes_nexello
FOR EACH ROW WHEN OLD.situacao IN ('confirmada','abortada')
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_REVISAO_FINALIZADA');
END;

-- Só vincular registros a uma revisão confirmada, com escopo compatível.
-- Confirmada significa revisão finalizada, não aprovação da Nexello.
CREATE TRIGGER trg_nexello_vinculo_revisao_insert
BEFORE INSERT ON agendamento_nexello
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM sincronizacoes_nexello s
  JOIN agendamentos p ON p.id=NEW.agendamento_id
  JOIN agendas a ON a.id=p.agenda_id
  WHERE s.id=NEW.sincronizacao_id AND s.situacao='confirmada'
    AND a.data_agenda BETWEEN s.data_inicio AND s.data_fim
    AND (s.loja_id IS NULL OR a.loja_id=s.loja_id)
)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_REVISAO_INVALIDA');
END;

CREATE TRIGGER trg_nexello_vinculo_revisao_update
BEFORE UPDATE OF sincronizacao_id,estado_externo,evidencia,observado_em,hash_conteudo ON agendamento_nexello
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM sincronizacoes_nexello s
  JOIN agendamentos p ON p.id=NEW.agendamento_id
  JOIN agendas a ON a.id=p.agenda_id
  WHERE s.id=NEW.sincronizacao_id AND s.situacao='confirmada'
    AND a.data_agenda BETWEEN s.data_inicio AND s.data_fim
    AND (s.loja_id IS NULL OR a.loja_id=s.loja_id)
)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_REVISAO_INVALIDA');
END;
