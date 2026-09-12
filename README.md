# Controle Financeiro Web + MySQL

O projeto original foi integrado a uma API Express sem substituir o layout. O navegador acessa a API REST; somente o backend acessa o MySQL. Abra a aplicação pelo servidor HTTP, não mais por duplo clique no HTML.

## Evolução relacional de investimentos, metas e notas

A nova versão mantém autenticação, recuperação de senha, SMTP e layout, e acrescenta `investimentos`, `aportes`, `metas`, `notas` e `app_estado_migracoes`. As migrations **004–007 são manuais**. A inicialização da API não as executa e não transforma dados existentes.

O [guia de arquitetura e operação](docs/ARQUITETURA-RELACIONAL.md) documenta tabelas, endpoints, mapeamento, validação, auditoria, rollback, importação, segurança e limitações. Consulte também o [relatório desta evolução](docs/RELATORIO-EVOLUCAO.md).

Depois de revisar as migrations, fazer backup e aplicá-las manualmente no banco escolhido:

```powershell
cd backend
npm ci
npm run migrate:state                 # Apenas orienta; não migra
npm run migrate:state -- --apply      # Transforma dados: exige revisão/autorização prévia
npm run audit:migration              # Somente leitura
npm run check:db
npm test
npm run test:mysql:isolated           # Cria uma instância temporária própria
```

A migração guarda cópia integral do JSON e mapeamento dos IDs, valida o resultado e ativa a leitura relacional por usuário. Rejeições impedem a ativação. `app_estado` permanece intacto; após ativação, não recebe escrita dupla. O rollback operacional volta à leitura legada sem apagar as tabelas novas, bloqueando gravações até reconciliação.

O dashboard recebe os totais do backend. Aportes planejados respeitam o período; os antigos, sem data, continuam visíveis até serem datados. A realização de um aporte ajusta o saldo do investimento, sem descontar novamente o histórico do saldo livre mensal.

“Importar dados locais” seleciona CSV/XLSX/JSON, valida localmente e apresenta prévia antes de confirmar. Nesta fase importa receitas/despesas realizadas, com contas e categorias já cadastradas: até 2 MB e 500 registros. A migração antiga permanece em “Migrar dados deste navegador”. “Atualizar dados” faz somente GETs, com loading e bloqueio de cliques concorrentes. “Sair” limpa a sessão local mesmo sem rede e tenta a revogação existente no servidor.

O login usa ilustrações locais leves e mensagens de privacidade. Os formulários mantêm navegação por teclado, mensagens acessíveis e confirmações para exclusões/importação. SMTP Brevo e recuperação continuam configurados como descrito abaixo; `backend/.env` não deve ser sobrescrito.

## Instalação e execução

Requisitos: Node.js 22 ou superior, npm e MySQL 8 com o banco `controle_financeiro` existente e tabelas InnoDB.

```powershell
cd backend
npm ci
# Apenas se o arquivo ainda não existir:
Copy-Item .env.example .env
```

Configure `backend/.env` localmente apenas se necessário. Não sobrescreva uma configuração já preenchida e nunca envie credenciais ao Git. Os valores reais não são pressupostos por esta documentação.

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_USER=finance_app
DB_PASSWORD=
DB_NAME=controle_financeiro
PORT=3000
HOST=127.0.0.1
NODE_ENV=development
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
JWT_SECRET=
ADMIN_EMAIL=
```

Para gerar `JWT_SECRET` em uma nova instalação:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copie a saída para `.env`. Defina `ADMIN_EMAIL` com seu e-mail antes de cadastrar o primeiro administrador. Faça esse cadastro localmente antes de expor o serviço a terceiros: esta versão não verifica a posse do e-mail. Outros cadastros públicos sempre recebem perfil comum, independentemente do papel enviado pelo navegador. Para uma conta já existente, há um comando de promoção manual comentado no SQL auxiliar. Administradores gerenciam perfis, mas não acessam finanças alheias.

No MySQL Workbench, usando uma conexão administrativa:

1. Confira a estrutura real das quatro tabelas existentes. `backend/sql/schema_referencia.sql` descreve os campos esperados; não substitui nem altera seu banco atual.
2. Revise e execute `backend/sql/001_tabelas_auxiliares.sql` no banco existente. Cria somente tabelas auxiliares, com `CREATE TABLE IF NOT EXISTS`.
3. Se `finance_app` ainda não existir, execute `backend/sql/002_usuario_aplicacao.sql`. O MySQL gera uma senha aleatória; copie-a para `DB_PASSWORD`. Se o usuário já existir, confira suas permissões e use sua senha atual. O script não redefine senhas existentes.

A aplicação usa apenas `SELECT`, `INSERT`, `UPDATE` e `DELETE` em `controle_financeiro.*`. Ela não aplica SQL administrativo na inicialização e não aceita `root` como usuário de execução. Não é necessário `FLUSH PRIVILEGES` após `CREATE USER`/`GRANT`.

```powershell
npm run check:db
npm start
# Desenvolvimento:
npm run dev
```

Abra [Controle Financeiro](http://localhost:3000). O mesmo Express serve o frontend e `/api`, evitando a necessidade de outro servidor. Os arquivos públicos são enumerados explicitamente: `.env`, SQL e backend nunca são servidos.

Frontend separado é opcional: acrescente `<meta name="api-url" content="http://localhost:3000/api">` no HTML e inclua a origem exata do frontend em `CORS_ORIGINS`. Reinicie o backend após mudar `.env`. `file://` não é um modo de execução suportado para a nova versão.

## Funcionalidades e dados

- Dashboard, barras CSS, investimentos, projeções, metas, notas, busca textual, perfis e responsividade preservados.
- Receitas agora são lançamentos individuais, com categoria, conta e data. A antiga renda editável mostra a soma das receitas do mês; altere seus lançamentos em **Receitas**.
- Despesas mantêm previsto, realizado e diferença. Realizado zero é planejamento, sem criar uma transação inválida de valor zero. As conversões entre planejamento e despesa são atômicas.
- Selecione o mês acima do dashboard. Receitas, despesas e orçamento usam esse período. Investimentos, metas e notas continuam representando o estado atual, pois não tinham histórico mensal.
- Contas exibem saldo inicial + todas as receitas − todas as despesas. Contas inativas continuam entrando no saldo patrimonial, mas não aceitam novos lançamentos. A edição altera o **saldo inicial**, não sobrescreve um saldo calculado. Contas e categorias vinculadas não podem ser excluídas.
- Saldo livre do mês = receitas do período − despesas do período − aportes planejados. Aportes planejados não são debitados de contas automaticamente. Aportes realizados ajustam o saldo do investimento; patrimônio considera apenas investimentos ativos.
- Notas são salvas automaticamente após uma pausa na digitação. A aplicação informa falhas e mantém o texto enquanto a página está aberta. Aguarde a confirmação antes de fechar.
- Não existiam exportações no projeto original. Backups JSON legados são preservados, mas não substituem backups regulares do MySQL.

## Autenticação e segurança

Senhas são processadas com bcryptjs (custo 12), com mínimo de 8 caracteres e máximo de 72 bytes. `senha_hash` nunca aparece nas respostas. JWT HS256 com emissor e destinatário definidos expira em duas horas e permanece apenas em memória do navegador: recarregar a página exige novo login. Logout e troca de senha revogam os tokens anteriores. Permissões são consultadas no banco a cada requisição.

Todas as rotas financeiras usam o usuário do token. `usuario_id` no corpo, rota ou query deve coincidir com o autenticado, inclusive para administradores. Vínculos verificam dono, existência, tipo da categoria e conta ativa. Queries são parametrizadas; identificadores SQL dinâmicos vêm exclusivamente de listas internas. Valores monetários permanecem `DECIMAL` no banco e são retornados normalmente como strings decimais.

Há validação de entradas, tratamento global de erros sem credenciais, CORS por lista de origens, Helmet, limite de payload e limitação de tentativas de login/cadastro. Investimentos, metas e notas têm controle de versão para detectar gravações concorrentes. Não há fallback silencioso para localStorage em caso de falha: o indicador de salvamento depende da resposta do servidor.

Referências utilizadas: [segurança no Express](https://expressjs.com/en/advanced/best-practice-security/) e [pool e promises no mysql2](https://sidorares.github.io/node-mysql2/docs/documentation/promise-wrapper).

## Estrutura

```text
index.html                  Interface original ampliada
styles.css / auth.css       Estilos preservados
app.js                      Renderizadores existentes e exemplo legado
js/api.js                   URL, fetch, JWT e erros HTTP
js/controller.js            Formulários, navegação e sincronização
js/migration.js             Migração opcional do navegador
backend/
  server.js                 Inicialização e encerramento
  services-schema.js        Verificação somente leitura da estrutura
  src/
    app.js                  Express e arquivos públicos
    config/                 Ambiente e pool mysql2/promise
    controllers/            Usuários, finanças, extras e migração
    services/               Validações, relacionamentos e resumo
    routes/api.js           Rotas REST
    middleware/             Autenticação, autorização e erros
  sql/                      Scripts manuais e esquema de referência
  scripts/                  Verificação e instância MySQL de teste
  tests/                    Validação e integração com frontend
  requests.http             Requisições de exemplo
  .env.example              Configuração sem segredos
docs/                       Inventário, migração e relatório
```

As tabelas existentes `usuarios`, `contas`, `categorias`, `transacoes` são usadas diretamente. As auxiliares são `app_perfis` (papéis/revogação), `app_estado` (compatibilidade legada em JSON versionado; a nova estrutura usa investimentos/aportes/metas/notas e recibo próprio), `app_planejamentos` (valores previstos e realizados zero) e `app_migracoes` (recibos e cópia do conteúdo importado). As auxiliares não acrescentam FKs à estrutura aproximada recebida; seus vínculos são validados e removidos em transações pela API.

## Endpoints

Todos começam com `/api`. Exceto cadastro, login e health, exigem `Authorization: Bearer <token>`.

| Recurso | Rotas |
|---|---|
| Autenticação | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` |
| Usuários | `GET, POST /usuarios`; `GET, PUT, DELETE /usuarios/:id` |
| Contas | `GET, POST /contas`; `GET, PUT, DELETE /contas/:id`; `GET /usuarios/:usuarioId/contas` |
| Categorias | `GET, POST /categorias`; `GET, PUT, DELETE /categorias/:id`; `GET /usuarios/:usuarioId/categorias` |
| Transações | `GET, POST /transacoes`; `GET, PUT, DELETE /transacoes/:id`; `GET /usuarios/:usuarioId/transacoes` |
| Saldos | `GET /contas/:id/saldo`; `GET /usuarios/:usuarioId/resumo` |
| Investimentos e metas | `GET, POST /investimentos`, `GET, PUT, DELETE /investimentos/:id`; mesmas operações em `/metas` |
| Notas com título | `GET, POST /notas`; `GET, PUT, DELETE /notas/:id` |
| Aportes | `GET, POST /investimentos/:id/aportes`; `PUT, DELETE /aportes/:id` |
| Importação | `GET /importacao/contexto`; `POST /importacao` |
| Complementos | `GET, PUT /estado` |
| Planejamento | `GET, POST /planejamentos`; `PUT, DELETE /planejamentos/:id` |
| Migração | `GET, POST /migracoes/localstorage` |
| Conexão | `GET /health` |

`GET /usuarios` lista todos os perfis para administradores e apenas o próprio para usuários comuns. Criação administrativa e exclusão de usuários exigem administrador. Exclusão de perfil remove seus registros financeiros em transação; a UI pede confirmação. O administrador não pode excluir ou rebaixar a si próprio.

Filtros combináveis em transações: `usuario_id`, `tipo`, `conta_id`, `categoria_id`, `data_inicio`, `data_fim`. Resumo aceita os mesmos filtros para os indicadores de período e retorna `saldo_total` global independente deles. Datas inclusivas em `YYYY-MM-DD`. Sem período, a API considera todo o histórico. Categorias aceitam filtro `tipo`. Planejamentos aceitam datas.

O resumo retorna `saldo_total`, `receitas`, `despesas`, `saldo_periodo`, `quantidade_transacoes`, `receitas_por_categoria`, `despesas_por_categoria`.

Exemplo de despesa (substitua os IDs por conta/categoria do usuário autenticado):

```http
POST http://localhost:3000/api/transacoes
Authorization: Bearer SEU_TOKEN
Content-Type: application/json

{
  "conta_id": 1,
  "categoria_id": 2,
  "descricao": "Supermercado",
  "valor": "150.00",
  "tipo": "despesa",
  "data_transacao": "2026-09-04",
  "observacao": "Compra semanal",
  "valor_previsto": "200.00"
}
```

`PUT` espera os campos completos editáveis. Respostas: 201 criação, 200 consulta/edição, 204 exclusão, 400 validação, 401 sessão inválida, 403 permissão, 404 inexistente/não pertencente ao usuário, 409 conflito/vínculo, 503 indisponibilidade. Para transformar planejamento em lançamento, envie `planejamento_id` ao criar a despesa. Para voltar ao previsto sem realizado, o frontend usa `PUT /transacoes/:id` com `converter_planejamento: true`, `descricao`, `categoria`, `valor_previsto` e `data_planejada`.

## Migração

Veja [o plano completo](docs/MIGRACAO.md). Após cadastrar uma conta MySQL com o mesmo e-mail do perfil antigo, use **Migrar dados deste navegador**. O perfil de destino precisa estar vazio. A senha antiga é verificada no navegador; nunca é enviada na importação. Escolha a data, revise a regra de associação à primeira conta e confirme. A aplicação só marca conclusão após gravar e consultar o recibo. Repetições idênticas não duplicam dados. Nenhuma chave antiga é apagada.

## Testes

```powershell
cd backend
npm test
npm run check:db
npm run test:mysql:isolated
```

O último comando, voltado a Windows, usa uma instalação local do MySQL Server; configure `MYSQLD_PATH` para o executável `mysqld` quando necessário. Inicializa uma instância temporária própria em `127.0.0.1:33307` e um banco `controle_financeiro_test`, cria `finance_app` temporário com senha aleatória e executa os testes reais. Não toca a porta 3306. O administrador sem senha existe apenas na inicialização dessa instância local, nunca no runtime da aplicação. Ao terminar, encerra o servidor isolado. Seus arquivos ficam em `backend/tests/.artifacts`, ignorados pelo Git. Testes devem usar apenas dados descartáveis.

`npm run test:integration` é uma opção avançada: exige `MYSQL_INTEGRATION=1`, banco com sufixo `_test`, esquema preparado e credenciais de teste. Os testes criam perfis/lançamentos e não devem ser apontados ao banco pessoal. O harness isolado configura tudo automaticamente.

## Problemas comuns

- **ER_ACCESS_DENIED_ERROR:** configure `DB_PASSWORD`, confirme a existência de `finance_app@localhost` e suas permissões. Não troque para root.
- **Estrutura incompleta:** execute o SQL auxiliar após revisar e compare as colunas existentes com o esquema de referência. A inicialização recusa estrutura incompleta ou tabelas sem InnoDB.
- **ECONNREFUSED:** confirme serviço, host e porta MySQL. **EADDRINUSE:** a porta HTTP já está ocupada; ajuste `PORT` e `CORS_ORIGINS` juntos.
- **Origem não autorizada:** inclua a origem exata (protocolo, host, porta), reinicie e use HTTP em vez de `file://`.
- **Sem dados antigos:** localStorage pertence à origem/perfil do navegador. Dados de `file://` ou outra porta não aparecem em localhost:3000. Siga a exportação manual em `docs/MIGRACAO.md`.
- **Usuário antigo não entra:** o PBKDF2 local não é um usuário MySQL. Cadastre o e-mail na API antes de importar. Usuários já presentes no banco precisam de hash bcrypt compatível.
- **Conflito ao salvar notas/metas/investimentos:** outra janela alterou os complementos. Copie o texto pendente antes de recarregar, entre novamente e reaplique sua alteração.
- **Falha de rede durante POST:** não repita imediatamente, pois a gravação pode ter sido confirmada no banco. Use Atualizar dados antes de repetir; somente a migração possui chave idempotente.

Para publicar: HTTPS, verificação de e-mail/recuperação de senha, criação administrativa sem cadastro público privilegiado, backups MySQL, limites distribuídos de autenticação, paginação e auditoria são próximos passos. Investimentos e aportes já possuem tabelas próprias nesta evolução; transferências bancárias e projeções históricas avançadas ficam para uma etapa posterior.


## Recuperação de senha

O link **Esqueci minha senha** abre um formulário no cartão de login existente. A resposta para e-mails válidos é sempre: “Se existir uma conta com este e-mail, enviaremos instruções para redefinir a senha.” Login, cadastro, bcryptjs (custo 12), JWT e isolamento financeiro continuam usando a autenticação existente.

### Banco e configuração

Antes de iniciar esta versão, selecione o banco correto no MySQL Workbench e execute `backend/sql/003_password_reset.sql` com uma conexão administrativa. O script cria apenas `password_reset_tokens`, com índices no hash, usuário e expiração. Não modifica as tabelas existentes. `check:db` verifica também essa tabela e seu mecanismo InnoDB.

A tabela segue a compatibilidade legada das auxiliares: não impõe FK porque o tipo/signedness de `usuarios.id` pode variar. A API valida o usuário, bloqueia sua linha na transação e exclui seus tokens ao excluir o perfil. Exclusões manuais no banco exigem limpar os registros órfãos.

Adicione as variáveis abaixo ao seu `backend/.env` **sem sobrescrever os valores existentes**:

```dotenv
APP_URL=http://localhost:3000
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

Para envio real, informe host, porta, remetente autorizado e credenciais fornecidas pelo serviço SMTP. Porta 465 usa TLS direto; outras portas exigem STARTTLS. Relays sem autenticação podem deixar usuário e senha vazios; se um for definido, o outro também é obrigatório. Credenciais nunca devem entrar no Git. Em produção, configure `NODE_ENV=production`, `APP_URL=https://seu-dominio` e SMTP_HOST/SMTP_FROM; o servidor recusa inicialização sem essa configuração. A disponibilidade e autorização do remetente dependem do provedor.

### Teste manual local

1. Execute a migration acima e, na pasta `backend`, rode `npm ci`, `npm run check:db` e `npm run dev`.
2. Use `NODE_ENV=development` e `APP_URL=http://localhost:3000`. Sem SMTP_HOST/SMTP_FROM, solicite recuperação para um usuário cadastrado.
3. Configure SMTP de desenvolvimento para receber o link por e-mail. Sem SMTP, apenas em `NODE_ENV=development`, o terminal informa que o envio não está configurado, sem registrar link, token ou destinatário. Nenhum ambiente registra tokens ou links completos de recuperação. A API nunca retorna esse token.
4. A página `/reset-password?token=...` valida o token pela API antes de habilitar os campos. O segredo é removido da barra de endereço e fica em memória; se recarregar a página, reabra o link original.
5. Informe e confirme uma senha de pelo menos 8 caracteres e até 72 bytes, diferente do e-mail e não composta só de espaços. Após sucesso, o login reaparece com “Senha redefinida com sucesso. Faça login com sua nova senha.”
6. Confira que a senha antiga falha, a nova funciona e o link não pode ser reutilizado. Sessões anteriores recebem 401 na próxima chamada protegida.

### Endpoints e garantias

- `POST /api/auth/forgot-password` — `{ "email": "usuario@exemplo.com" }`; máximo de 5 solicitações por IP a cada 15 minutos, inclusive e-mails inválidos/inexistentes.
- `POST /api/auth/validate-reset-token` — `{ "token": "..." }`; verifica existência, validade e uso, sem consumir o link.
- `POST /api/auth/reset-password` — `{ "token": "...", "novaSenha": "..." }`; revalida o token dentro da transação. Validação e reset compartilham limite de 30 tentativas por IP a cada 15 minutos.

O token é gerado com `crypto.randomBytes(32)` (256 bits) e só o SHA-256 vai para o MySQL. Expira em **15 minutos**, usando o relógio UTC do banco. Nova solicitação invalida links anteriores. O reset bloqueia o usuário e revalida o token, grava bcrypt, marca todos os tokens desse usuário como usados e incrementa `app_perfis.versao_token` na mesma transação. Perfis legados ausentes são criados sem conceder privilégios. O middleware existente já compara a versão do JWT com o banco. Alterações de senha/e-mail pela edição de perfil também revogam links pendentes.

Há um tempo mínimo aleatório de 350–449 ms para pedidos válidos, e o envio SMTP ocorre depois da resposta para não expor sua latência. Isso reduz diferenças de timing, mas não garante tempo constante sob sobrecarga. Falhas internas e de envio não expõem dados da conta; apenas uma mensagem operacional sem segredo é registrada.

### Testes automatizados e limites operacionais

Na pasta `backend`:

```powershell
npm test
npm run test:mysql:isolated
```

O segundo comando cria uma instância temporária MySQL na porta 33307 e executa os testes existentes e os de recuperação. Não toca no serviço 3306. Requer MySQL Server instalado; ajuste MYSQLD_PATH se necessário. Artefatos ficam em `backend/tests/.artifacts/`, ignorado pelo Git. O transporte SMTP é simulado nos testes; o fluxo SQL, bcrypt, JWT e HTTP usa MySQL real. Os testes não imprimem tokens nem senhas.

O rate limit atual usa memória de um processo: múltiplas instâncias exigem armazenamento compartilhado. Atrás de proxy, configure trust proxy apenas para proxies confiáveis antes de escalar. O envio em segundo plano não tem fila persistente nem retentativa automática: se o processo parar ou SMTP falhar após a resposta, o usuário deve solicitar outro link. Uma nova solicitação revoga o link anterior mesmo se a entrega falhar. Para entrega garantida, evolua para uma fila persistente. Tokens usados/expirados ficam armazenados para manutenção posterior; planeje limpeza periódica conforme a política de retenção. Proxies e serviços externos devem omitir a query string de `/reset-password` dos logs de acesso, pois ela contém o segredo. A aplicação não registra essa URL em produção.


### Arquivos desta implementação

Criados:
- `backend/sql/003_password_reset.sql`
- `backend/src/controllers/passwordResetController.js`
- `backend/src/services/resetMail.js`
- `js/password-reset.js`
- `backend/tests/password-reset.test.js`
- `backend/tests/password-reset-ui.test.js`
- `backend/tests/password-reset.mysql.js`

Modificados:
- `index.html`: link e formulários, reutilizando as classes visuais existentes.
- `backend/src/routes/api.js`: endpoints públicos com limites próprios, antes do middleware de autenticação.
- `backend/src/app.js`: rota de redefinição e publicação explícita do novo JavaScript.
- `backend/src/controllers/usuariosController.js`: revogação dos links ao alterar credenciais e limpeza ao excluir perfil.
- `backend/src/config/env.js` e `backend/.env.example`: configuração de URL e SMTP.
- `backend/services-schema.js`: validação da nova tabela/InnoDB.
- `backend/package.json` e `backend/package-lock.json`: Nodemailer e comando de testes.
- `backend/scripts/test-mysql-isolated.js`: migration e suíte de recuperação no ambiente isolado.
- `README.md`: configuração, fluxo, testes e limitações.

O middleware JWT existente não precisou ser alterado: já rejeita versões antigas. O `.env` real não foi modificado, e a migration não foi aplicada ao banco da aplicação durante a implementação.

### Testes de notas

`npm test`, na pasta `backend`, inclui `tests/notes.test.js` e o helper de interface: valida título, criação explícita, autosave, falhas, exclusão e compatibilidade legada. Não usa o banco real.

`tests/notes.mysql.js` é um teste opt-in separado e não integra `npm test`, `test:integration` nem o harness isolado atual. Ele grava e exclui fixtures no banco configurado. Para executá-lo futuramente, prepare um banco descartável com esquema existente, configure as credenciais de teste apenas no processo e habilite `NOTES_MYSQL_TEST=1` antes de `node --test tests/notes.mysql.js`. Não o execute apontando para o banco pessoal: o opt-in não valida o sufixo `_test`.
