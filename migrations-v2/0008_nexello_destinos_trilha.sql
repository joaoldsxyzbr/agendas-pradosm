-- A filial e a doca devem reproduzir exatamente a identidade da unidade local.
CREATE TRIGGER trg_nexello_destino_formato_insert
BEFORE INSERT ON nexello_destinos
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM lojas l WHERE l.id=NEW.loja_id AND l.ativo=1 AND l.excluido_em IS NULL AND (
    (NEW.doca_externa='' AND substr(NEW.filial_externa,1,1)='F'
     AND length(NEW.filial_externa) BETWEEN 2 AND 4
     AND substr(NEW.filial_externa,2) NOT GLOB '*[^0-9]*'
     AND l.codigo=NEW.filial_externa COLLATE BINARY)
    OR (NEW.filial_externa='CD' AND length(NEW.doca_externa) BETWEEN 2 AND 3
     AND NEW.doca_externa NOT GLOB '*[^0-9]*'
     AND l.codigo=('CD DOCA ' || NEW.doca_externa) COLLATE BINARY)
  )
)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_DESTINO_INVALIDO');
END;

-- Remapeamento exige procedimento explícito ainda não implementado.
CREATE TRIGGER trg_nexello_destino_identidade_imutavel
BEFORE UPDATE OF filial_externa,doca_externa,loja_id ON nexello_destinos
FOR EACH ROW WHEN NEW.filial_externa<>OLD.filial_externa OR NEW.doca_externa<>OLD.doca_externa OR NEW.loja_id<>OLD.loja_id
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_DESTINO_IMUTAVEL');
END;

-- Preservar vínculo, inclusive contra INSERT OR REPLACE (recursive_triggers pode estar off).
CREATE TRIGGER trg_nexello_vinculo_sem_exclusao
BEFORE DELETE ON agendamento_nexello
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_VINCULO_IMUTAVEL');
END;
CREATE TRIGGER trg_nexello_vinculo_sem_substituicao
BEFORE INSERT ON agendamento_nexello
FOR EACH ROW WHEN EXISTS (SELECT 1 FROM agendamento_nexello WHERE agendamento_id=NEW.agendamento_id)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_VINCULO_IMUTAVEL');
END;
CREATE TRIGGER trg_nexello_evidencia_sem_substituicao
BEFORE INSERT ON nexello_evidencias
FOR EACH ROW WHEN EXISTS (SELECT 1 FROM nexello_evidencias WHERE sincronizacao_id=NEW.sincronizacao_id AND agendamento_id=NEW.agendamento_id)
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_EVIDENCIA_IMUTAVEL');
END;
CREATE TRIGGER trg_nexello_revisao_sem_exclusao
BEFORE DELETE ON sincronizacoes_nexello
FOR EACH ROW WHEN OLD.situacao IN ('confirmada','abortada')
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_REVISAO_FINALIZADA');
END;
CREATE TRIGGER trg_nexello_revisao_sem_substituicao
BEFORE INSERT ON sincronizacoes_nexello
FOR EACH ROW WHEN EXISTS (SELECT 1 FROM sincronizacoes_nexello WHERE id=NEW.id AND situacao IN ('confirmada','abortada'))
BEGIN
  SELECT RAISE(ABORT,'NEXELLO_REVISAO_FINALIZADA');
END;
