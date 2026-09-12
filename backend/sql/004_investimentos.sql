-- Aplicação manual, MySQL 8/InnoDB. Não modifica tabelas legadas.
-- usuario_id sem FK: preserva compatibilidade signed/unsigned de usuarios.
-- Vínculos de usuário são validados e removidos em transação pela API.
CREATE TABLE IF NOT EXISTS investimentos (
 id INT AUTO_INCREMENT PRIMARY KEY,
 usuario_id INT NOT NULL,
 legado_id BIGINT NULL,
 nome VARCHAR(150) NOT NULL,
 saldo_atual DECIMAL(15,2) NOT NULL DEFAULT 0,
 observacao TEXT NULL,
 ativo BOOLEAN NOT NULL DEFAULT TRUE,
 criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY investimento_legado(usuario_id,legado_id),
 UNIQUE KEY investimento_usuario(id,usuario_id),
 INDEX investimento_ativo(usuario_id,ativo)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS aportes (
 id INT AUTO_INCREMENT PRIMARY KEY,
 usuario_id INT NOT NULL,
 investimento_id INT NOT NULL,
 legado BOOLEAN NULL,
 valor DECIMAL(15,2) NOT NULL,
 tipo ENUM('planejado','realizado') NOT NULL,
 data_prevista DATE NULL,
 data_realizada DATE NULL,
 observacao TEXT NULL,
 criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY aporte_legado(investimento_id,legado),
 INDEX aporte_periodo(usuario_id,tipo,data_prevista),
 FOREIGN KEY(investimento_id,usuario_id) REFERENCES investimentos(id,usuario_id) ON DELETE CASCADE
) ENGINE=InnoDB;
