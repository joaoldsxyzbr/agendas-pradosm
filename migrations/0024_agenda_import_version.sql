-- Controle aditivo de concorrência nas substituições de agendas importadas.
-- O valor avança apenas quando uma importação substitui a agenda; outras
-- operações (conferência e ajustes manuais) mantêm suas regras próprias.
-- A constraint nomeada aborta o db.batch inteiro se uma substituição
-- calculada sobre uma versão obsoleta tentar gravar a versão -1.
ALTER TABLE agendas ADD COLUMN versao_importacao INTEGER NOT NULL DEFAULT 0
  CONSTRAINT ck_agenda_versao_importacao CHECK (versao_importacao >= 0);
