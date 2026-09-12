-- Execute como administrador. Edite a senha somente na sua cópia local;
-- não adicione essa cópia ao Git. Não usa root na aplicação.
-- Gera senha aleatória no MySQL 8.0.18+: copie o resultado para backend/.env.
-- Se finance_app já existir, não execute CREATE USER; confira SHOW GRANTS.
CREATE USER 'finance_app'@'localhost' IDENTIFIED BY RANDOM PASSWORD;
GRANT SELECT, INSERT, UPDATE, DELETE ON controle_financeiro.* TO 'finance_app'@'localhost';
SHOW GRANTS FOR 'finance_app'@'localhost';
