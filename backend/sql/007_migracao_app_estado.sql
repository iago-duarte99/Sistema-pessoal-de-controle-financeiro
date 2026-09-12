-- Snapshot textual integral, recibo, IDs legados nas tabelas e ativação por usuário.
-- DDL não transforma dados. Execute o script de migração separadamente.
CREATE TABLE IF NOT EXISTS app_estado_migracoes (
 usuario_id INT NOT NULL PRIMARY KEY,
 original LONGTEXT NOT NULL,
 checksum CHAR(64) NOT NULL,
 versao_original INT NOT NULL,
 versao INT NOT NULL DEFAULT 0,
 ativo BOOLEAN NOT NULL DEFAULT FALSE,
 contagens JSON NOT NULL,
 rejeitados JSON NOT NULL,
 criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
