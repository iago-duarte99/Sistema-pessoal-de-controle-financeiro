-- Selecione o banco da aplicação antes de executar. Requer MySQL 8 / InnoDB.
-- Sem FK, seguindo as tabelas auxiliares legadas (tipo/signedness variável).
-- A API valida o usuário e remove seus tokens na mesma transação da exclusão.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expira_em DATETIME NOT NULL,
  usado_em DATETIME NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_reset_hash (token_hash),
  INDEX idx_reset_usuario (usuario_id),
  INDEX idx_reset_expira (expira_em)
) ENGINE=InnoDB;
