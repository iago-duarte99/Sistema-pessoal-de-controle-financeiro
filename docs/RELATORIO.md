# Relatório da integração MySQL

## Resultado e pendência local

Implementada a arquitetura HTML/CSS/JavaScript → API REST Node.js/Express → MySQL. Os fluxos foram exercitados contra MySQL Community Server **8.0.46**, em instâncias descartáveis na porta **33307**, com banco `controle_financeiro_test` e usuário de aplicação com apenas SELECT/INSERT/UPDATE/DELETE.

A conexão com **seu banco existente**, em localhost:3306, retornou **ER_ACCESS_DENIED_ERROR** usando finance_app sem senha. Não foi possível confirmar sua estrutura real ou operar esse banco sem configurar as credenciais. Nenhuma tabela/dado do banco existente foi alterado. Os scripts administrativos foram preparados para revisão e execução manual; não foram aplicados ao seu serviço MySQL.

Para concluir a ativação local: configure `backend/.env`, revise/aplique o SQL auxiliar, crie finance_app se necessário e execute `npm run check:db` seguido de `npm start`. O README contém o passo a passo completo.

## Arquivos criados

- `.gitignore`, `README.md`.
- `js/api.js`, `js/controller.js`, `js/migration.js`.
- `backend/package.json`, `backend/package-lock.json`, `backend/.gitignore`, `backend/.env.example`.
- `backend/.env`: arquivo local ignorado, senha MySQL vazia e segredo JWT aleatório; não deve ser versionado.
- `backend/server.js`, `backend/services-schema.js`.
- `backend/src/app.js`.
- `backend/src/config/database.js`, `backend/src/config/env.js`.
- `backend/src/controllers/usuariosController.js`, `backend/src/controllers/financeController.js`, `backend/src/controllers/estadoController.js`, `backend/src/controllers/migracaoController.js`.
- `backend/src/services/finance.js`, `backend/src/services/validation.js`.
- `backend/src/routes/api.js`.
- `backend/src/middleware/auth.js`, `backend/src/middleware/errors.js`.
- `backend/sql/001_tabelas_auxiliares.sql`, `backend/sql/002_usuario_aplicacao.sql`, `backend/sql/schema_referencia.sql`.
- `backend/scripts/check-db.js`, `backend/scripts/test-mysql-isolated.js`.
- `backend/tests/validation.test.js`, `backend/tests/integration.mysql.js`, `backend/requests.http`.
- `docs/MIGRACAO.md`, `docs/RELATORIO.md`.

Dependências, cache npm e arquivos temporários de teste foram gerados localmente e ignorados pelo Git. Os arquivos de dados das instâncias temporárias ficam em `backend/tests/.artifacts`; os servidores de teste foram encerrados ao terminar.

## Arquivos modificados e decisões estruturais

- `app.js`: preserva os renderizadores existentes e o seed como referência. A sessão, autenticação e persistência ativas deixam de depender dos arrays de usuários/localStorage. Novos perfis começam vazios. Corrigidos escape de nomes de metas e porcentagens com renda zero.
- `index.html`: mantém as telas existentes e acrescenta receitas, categorias, seleção de mês, feedback de sincronização e diálogo de migração. Campos de despesas agora incluem conta/data. Inclui os scripts separados.
- `auth.css`: preserva o estilo e acrescenta correções de `[hidden]`, visibilidade do menu do usuário no celular e disposição dos controles novos. Este arquivo já existia não rastreado antes do trabalho.
- `README.txt`: aponta para as instruções atuais de execução com MySQL, substituindo as orientações obsoletas de aplicativo apenas local.
- `styles.css`: não foi alterado.

As modificações locais prévias foram usadas como base; não houve reset, recriação do projeto ou commit automático. O controlador financeiro e o roteador são compartilhados entre contas/categorias/transações para evitar duplicação, com listas internas fixas de tabelas/colunas. A renda agregada editável passou a ser a soma de receitas individuais, necessária para manter saldo/histórico corretos. Tabelas auxiliares preservam recursos que as quatro tabelas recebidas não representavam.

## Dependências instaladas

| Produção | Versão declarada |
|---|---|
| express | ^5.2.1 |
| mysql2 | ^3.24.3 |
| dotenv | ^17.4.2 |
| cors | ^2.8.6 |
| bcryptjs | ^3.0.3 |
| jsonwebtoken | ^9.0.3 |
| helmet | ^8.3.0 |
| express-rate-limit | ^8.7.0 |

Desenvolvimento: `jsdom ^30.0.1`. Versões resolvidas estão no lockfile. A auditoria npm realizada durante a instalação reportou **0 vulnerabilidades** nas 138 dependências auditadas.

## API implementada

CRUD de usuários, contas, categorias e transações, incluindo todas as rotas `/api/usuarios/:usuarioId/{contas,categorias,transacoes}`. Também:

- `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`.
- `/api/contas/:id/saldo` e `/api/usuarios/:usuarioId/resumo`, com agrupamento por categoria.
- Filtros por usuário, tipo, conta, categoria e período inclusivo.
- `/api/estado`, `/api/planejamentos`, `/api/planejamentos/:id` e `/api/migracoes/localstorage`.
- `/api/health` e verificação de estrutura na inicialização.

O README detalha métodos, campos, respostas e regras de acesso. As finanças já são isoladas pelo usuário autenticado, inclusive contra administradores. Hashes não são retornados. Saldos usam agregação SQL sobre DECIMAL. Não há atualizações manuais de saldo após transações.

## Frontend e localStorage

Login/cadastro/perfis usam API. CRUD financeiro, notas, metas, caixinhas, projeções e dashboard carregam dados do MySQL. Cada gravação bem-sucedida atualiza os dados exibidos. A busca por descrição/categoria permanece; o período passou a ser selecionável. Despesas de realizado zero são mantidas como planejamentos, sem violar valor > 0 em transações.

O código de comunicação centraliza fetch, URL, token, timeout e erros. O JWT fica apenas em memória; recarregar requer login. Falhas são informadas, sem gravar silenciosamente dados financeiros apenas no navegador.

Nenhuma chave antiga foi apagada. A migração opcional lê o perfil correspondente ao e-mail, verifica a senha PBKDF2 localmente, importa em transação e consulta recibo antes de marcar conclusão. A única nova escrita em localStorage é o marcador de migração. Repetição idêntica é idempotente. Originais e backups antigos permanecem intactos. A inspeção do formato foi feita pelo código; os dados pessoais reais do navegador não foram acessados.

## Testes realizados

**Validações:** 4 testes aprovados, cobrindo dinheiro, IDs, e-mails, tipos, datas, períodos, isolamento e estado complementar.

**MySQL real + DOM executando os scripts reais:** 12 cenários aprovados; o runner registra 13 entradas contando o teste que os contém. Foram verificados:

1. Conexão/estrutura, criação de usuários, bcrypt e login.
2. GET usuários, perfis administrativos e rejeição de elevação de privilégio.
3. Criação e leitura de contas/categorias e tipos inválidos.
4. Receita de 500, despesa de 150 e saldo inicial 1000 → saldo 1350; resumo e categorias.
5. Filtros combinados, limites inclusivos de data, períodos inválidos, entradas de SQL injection e valores/relacionamentos inválidos.
6. Rejeição de leitura/escrita/exclusão e vínculos entre usuários, inclusive com token administrador.
7. Edição de transação, proteção de conta/categoria vinculada, exclusão e recálculo do saldo.
8. Planejamento zero, conversão atômica para transação e retorno ao planejamento; conversão repetida não duplica.
9. Investimentos, metas, notas, isolamento de complementos e conflito de versão.
10. Importação, recibo, repetição idêntica, preservação do saldo e rejeição de conteúdo inválido sem dados parciais.
11. Frontend: login, despesa de 150, cards, categorias, busca, cancelamento, receita, caixinha/projeção, meta, notas automáticas, edição/conversão/exclusão. Migração pelo formulário com senha PBKDF2, confirmação do recibo e verificação de preservação das chaves antigas/backup.
12. Autenticação obrigatória, CORS, arquivos privados inacessíveis, revogação após trocar senha e exclusão de perfil.

**Outras verificações:** sintaxe dos 22 arquivos JavaScript; `git diff --check`; `.env`, node_modules e cache ignorados pelo Git. Os testes de frontend usam jsdom com requisições HTTP à API e MySQL reais; não equivalem a uma inspeção visual em Chrome/Safari nem a uma validação em dispositivos físicos.

## Problemas encontrados e resolvidos

- Projeto inicial sem backend e sem representação de datas/contas nas despesas: adicionados campos e regra explícita de importação.
- Hashes PBKDF2 locais incompatíveis com bcrypt: cadastro novo na API e verificação antiga somente no navegador.
- Saldo legado era uma fotografia: importação ajusta o saldo inicial para evitar dupla contagem.
- Despesa realizada zero: armazenamento como planejamento e conversões atômicas.
- MySQL retornou `ER_ROW_IS_REFERENCED` sem sufixo `_2`: tratamento ampliado e vínculos conferidos explicitamente antes de excluir.
- CSS anterior podia sobrepor o atributo hidden e esconder o menu de usuário no celular: correções pontuais preservando o visual.
- Restrições do ambiente bloquearam instalação/testes na primeira tentativa: dependências e testes isolados foram executados com a permissão necessária. Nenhuma revisão automática rejeitou a tarefa.
- Acesso ao banco pessoal ainda não configurado: pendência externa indicada no início deste relatório.

## Próximos passos recomendados

Configure o banco pessoal e faça uma migração de um perfil vazio, conferindo os valores. Antes de publicar, adicione HTTPS, verificação de e-mail, recuperação de senha, auditoria e backups MySQL. Para maior volume, paginação e índices avaliados no esquema real. Para evolução funcional, normalize o histórico de investimentos/aportes, acrescente transferências e exportações; estes recursos não estavam implementados no projeto original.
