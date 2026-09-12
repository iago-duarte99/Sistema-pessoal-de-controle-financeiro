-- Execute uma vez como administrador no banco existente, após revisar.
-- Não altera as quatro tabelas existentes. Exige MySQL 8 / InnoDB.
USE controle_financeiro;

CREATE TABLE IF NOT EXISTS app_perfis (
  usuario_id INT NOT NULL PRIMARY KEY,
  papel ENUM('admin','user') NOT NULL DEFAULT 'user',
  versao_token INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_estado (
  usuario_id INT NOT NULL PRIMARY KEY,
  dados JSON NOT NULL,
  versao INT NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_planejamentos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  transacao_id INT NULL UNIQUE,
  descricao VARCHAR(255) NOT NULL,
  categoria VARCHAR(100) NOT NULL,
  valor_previsto DECIMAL(15,2) NOT NULL,
  data_planejada DATE NOT NULL,
  INDEX idx_planejamento_usuario_data (usuario_id,data_planejada)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_migracoes (
  usuario_id INT NOT NULL,
  origem VARCHAR(200) NOT NULL,
  checksum CHAR(64) NOT NULL,
  contagens JSON NOT NULL,
  original JSON NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id,origem)
) ENGINE=InnoDB;

-- Os IDs auxiliares não têm FKs para aceitar bases legadas com variações
-- de tipo/signedness. A API valida os vínculos e exclui em transação.
-- Para promover um usuário já existente, execute manualmente substituindo o ID:
-- INSERT INTO app_perfis(usuario_id,papel) VALUES(123,'admin')
-- ON DUPLICATE KEY UPDATE papel='admin';
