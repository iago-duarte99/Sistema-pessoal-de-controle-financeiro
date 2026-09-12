CREATE TABLE IF NOT EXISTS metas (
 id INT AUTO_INCREMENT PRIMARY KEY,
 usuario_id INT NOT NULL,
 legado_id BIGINT NULL,
 nome VARCHAR(150) NOT NULL,
 descricao TEXT NULL,
 valor_meta DECIMAL(15,2) NOT NULL,
 valor_atual DECIMAL(15,2) NOT NULL DEFAULT 0,
 data_limite DATE NULL,
 status ENUM('ativa','concluida','cancelada') NOT NULL DEFAULT 'ativa',
 criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY meta_legado(usuario_id,legado_id),
 INDEX meta_status(usuario_id,status,data_limite)
) ENGINE=InnoDB;
