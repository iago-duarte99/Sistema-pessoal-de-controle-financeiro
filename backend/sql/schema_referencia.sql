-- REFERÊNCIA para banco novo de desenvolvimento/teste.
-- Não execute para substituir o banco existente. Selecione o banco antes.
CREATE TABLE IF NOT EXISTS usuarios (
 id INT AUTO_INCREMENT PRIMARY KEY,
 nome VARCHAR(120) NOT NULL,
 email VARCHAR(150) NOT NULL UNIQUE,
 senha_hash VARCHAR(255) NOT NULL,
 criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS contas (
 id INT AUTO_INCREMENT PRIMARY KEY,
 usuario_id INT NOT NULL,
 nome VARCHAR(100) NOT NULL,
 tipo VARCHAR(50) NOT NULL,
 saldo_inicial DECIMAL(15,2) NOT NULL DEFAULT 0,
 ativa BOOLEAN NOT NULL DEFAULT TRUE,
 criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS categorias (
 id INT AUTO_INCREMENT PRIMARY KEY,
 usuario_id INT NOT NULL,
 nome VARCHAR(100) NOT NULL,
 tipo ENUM('receita','despesa') NOT NULL,
 criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS transacoes (
 id INT AUTO_INCREMENT PRIMARY KEY,
 usuario_id INT NOT NULL,
 conta_id INT NOT NULL,
 categoria_id INT NOT NULL,
 descricao VARCHAR(255) NOT NULL,
 valor DECIMAL(15,2) NOT NULL,
 tipo ENUM('receita','despesa') NOT NULL,
 data_transacao DATE NOT NULL,
 observacao TEXT,
 criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
 FOREIGN KEY(conta_id) REFERENCES contas(id),
 FOREIGN KEY(categoria_id) REFERENCES categorias(id),
 INDEX idx_transacoes_usuario_data(usuario_id,data_transacao)
) ENGINE=InnoDB;
