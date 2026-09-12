# Relatório da evolução relacional

Entrega concluída em 08/09/2026. O projeto existente foi ampliado, sem recriação. Nenhuma migration foi aplicada ao banco real; `backend/.env` e dados pessoais não foram alterados. As alterações locais que já existiam foram preservadas.

## Arquivos criados

- `backend/sql/004_investimentos.sql`
- `backend/sql/005_metas.sql`
- `backend/sql/006_notas.sql`
- `backend/sql/007_migracao_app_estado.sql`
- `backend/src/services/relational.js`
- `backend/src/services/migrationAudit.js`
- `backend/src/controllers/relationalController.js`
- `backend/src/controllers/importController.js`
- `backend/scripts/migrate-app-state.js`
- `backend/scripts/audit-migration.js`
- `backend/tests/relational.mysql.js`
- `backend/tests/import.test.js`
- `backend/tests/import-worker.test.js`
- `backend/tests/ux.test.js`
- `backend/tests/preview.js`
- `backend/tests/fixtures/import.csv`
- `backend/tests/fixtures/import.xlsx`
- `js/ux.js`
- `js/import-schema.js`
- `js/import-worker.js`
- `js/import.js`
- `assets/finance-1.svg`, `assets/finance-2.svg`, `assets/finance-3.svg`
- `docs/ARQUITETURA-RELACIONAL.md`
- `docs/RELATORIO-EVOLUCAO.md`

## Arquivos modificados

- `backend/src/controllers/estadoController.js`: adaptador relacional e bloqueio de escrita JSON após recibo.
- `backend/src/controllers/usuariosController.js`: limpeza transacional das novas tabelas ao excluir perfil.
- `backend/src/controllers/migracaoController.js`: preservação da importação antiga e proteção contra conflito com dados relacionais.
- `backend/src/services/finance.js`: indicadores financeiros calculados no backend, com centavos exatos.
- `backend/src/routes/api.js`: rotas novas sob autenticação existente.
- `backend/src/middleware/errors.js`: mensagem genérica sem detalhes da infraestrutura.
- `backend/src/app.js`: publicação explícita de assets/scripts e bundle local ExcelJS; cache da página inicial.
- `backend/services-schema.js`: compatibilidade sem tabelas novas e detecção de instalação parcial.
- `backend/scripts/test-mysql-isolated.js`: criação/reaplicação das migrations na instância isolada e preview opcional.
- `backend/tests/integration.mysql.js`: expectativas das mensagens, confirmação e nome do botão legado.
- `backend/tests/password-reset.mysql.js`: mock SMTP inclui `verify()`, preservando o transporte real existente.
- `backend/package.json`, `backend/package-lock.json`: ExcelJS e comandos de migração/auditoria/testes.
- `js/api.js`: geração de sessão e rejeição de respostas atrasadas.
- `js/controller.js`: CRUD relacional, atualização somente GET, logout, formulários, seleção de notas e confirmações.
- `js/migration.js`: mensagem da migração legada sem detalhes de infraestrutura.
- `app.js`: renderizadores preservados, totais do backend e histórico de aportes.
- `index.html`, `auth.css`: login ilustrado, importação, notas, mensagens e ajustes responsivos/acessíveis.
- `README.md`: orientação atual de arquitetura, execução e operação.

`README.txt` e outros arquivos já apareciam alterados/não rastreados antes desta evolução. Não houve reset nem commit automático. Dependências e arquivos temporários dos testes estão ignorados pelo Git.

## Migrations e tabelas

As quatro migrations criam `investimentos`, `aportes`, `metas`, `notas` e `app_estado_migracoes`. São separadas, reaplicáveis com `CREATE TABLE IF NOT EXISTS` e não contêm exclusão destrutiva. Nenhuma delas executa transformação automaticamente.

Investimentos/metas mantêm IDs legados por usuário; aportes têm vínculo composto com investimento + usuário. O recibo guarda JSON integral, checksum, versões, contagens, rejeições e ativação. A decisão sobre FK para `usuarios` segue a compatibilidade de tipos legados e está explicada no guia.

## API nova

| Recurso | Rotas |
|---|---|
| Investimentos | GET/POST `/api/investimentos`; GET/PUT/DELETE `/api/investimentos/:id` |
| Aportes | GET/POST `/api/investimentos/:id/aportes`; PUT/DELETE `/api/aportes/:id` |
| Metas | GET/POST `/api/metas`; GET/PUT/DELETE `/api/metas/:id` |
| Notas | GET/POST `/api/notas`; GET/PUT/DELETE `/api/notas/:id` |
| Importação | GET `/api/importacao/contexto`; POST `/api/importacao` |

Rotas anteriores continuam disponíveis. Todas as finanças usam o usuário autenticado; IDs ou `usuario_id` de terceiros não concedem acesso. Escritas e ajustes de saldo usam transação.

## Compatibilidade e dados migrados nos testes

No cenário principal foram migrados **2 investimentos, 1 aporte planejado, 1 meta e 1 nota**, incluindo ID legado grande, centavos, data bissexta e conteúdo com espaços/quebras de linha. O JSON e sua versão permaneceram iguais aos originais. A reexecução não duplicou registros.

Outros cenários verificaram falha no meio da transformação com rollback integral, cópia apenas de registros válidos sem ativação quando há rejeições, auditoria sem alteração, retorno operacional à leitura legada e ausência de ressurreição de notas excluídas.

Após ativação por usuário, a leitura vem das tabelas novas e a escrita JSON é bloqueada. Antes dela, o fallback preserva o comportamento legado. `app_estado` não foi apagado. Rollback após edições exige reconciliação para não apresentar dados antigos como atuais; o procedimento está documentado sem limpeza automática.

## Comportamento da interface

- **Login:** três ilustrações locais leves, variação por acesso, transição suave/fallback, mensagens de privacidade e nenhuma fonte externa de imagem.
- **Sair:** limpa token, memória, listas, prévias e sessão antiga; rejeita respostas atrasadas e impede recuperação da sessão pelo cache de navegação. Tenta a revogação existente mesmo que a sessão local termine sem rede.
- **Atualizar dados:** seis GETs carregam todos os dados/indicadores; não grava notas, não importa nem cria registros. Bloqueia concorrência e edições durante a leitura, com loading, sucesso e erro.
- **Importar dados locais:** seleciona CSV/XLSX/JSON, valida localmente, mostra tabela e contagens, pede confirmação e importa somente registros válidos. Revalida no servidor, ignora duplicados e informa rejeições. O arquivo não vai para terceiros.
- **Migração antiga:** continua em “Migrar dados deste navegador”, com senha legada verificada localmente e confirmação.
- **Aportes:** histórico com criação, edição, realização e exclusão; realização ajusta somente a diferença no saldo, sem descontar histórico novamente do saldo livre.
- **Metas/notas:** formulários relacionais, status das metas, escolha/criação de notas e exclusões confirmadas.
- **Acessibilidade:** controles rotulados, mensagens status/alert, foco visível e diálogos nativos com cancelamento por teclado.

## Testes executados e aprovados

| Verificação | Resultado |
|---|---|
| `npm test` | **23 aprovados**, nenhum reprovado/ignorado |
| `npm run test:mysql:isolated -- --preview` | **35 entradas aprovadas**, incluindo 3 testes agregadores; nenhum reprovado/ignorado |
| `node --test tests/ux.test.js` após ajustes finais | **7 aprovados**, também incluídos nos 23 acima |
| `node --check` | **43 arquivos JavaScript** com sintaxe válida |
| `git diff --check` | Sem erros; apenas avisos de conversão LF/CRLF do Git |
| `npm run migrate:state` sem `--apply` | Informa instruções e não altera dados |

O MySQL dos testes foi inicializado separadamente na porta 33307. A aplicação de preview usou 33308 e dados fictícios. Os testes cobrem SQL, API HTTP, isolamento inclusive administradores, autenticação, bcrypt, revogação, recuperação, rollback, importação concorrente e o frontend real via DOM. SMTP foi simulado; nenhum e-mail real foi enviado.

Revisão no navegador: login desktop, login/dashboard/importação em 390×844, dashboard em 768×1024 e dashboard/histórico em 1366×768. As larguras medidas não excederam a viewport. XLSX foi selecionado no navegador e produziu 1 válido + 1 inválido; após confirmação retornou 1 importado, 0 ignorados e 1 rejeitado. A revisão interrompida por limite de uso na sessão anterior foi retomada e concluída.

## Riscos, limitações e próximos passos

1. **Ativação real ainda é manual:** revisar backup, esquema e migrations em uma cópia da base real antes da aplicação autorizada. O ambiente real não foi migrado nem auditado nesta entrega.
2. **Importação inicial delimitada:** receitas/despesas realizadas, contas/categorias existentes, até 2 MB/500 linhas; não é um importador universal de extratos. Duplicados exatos podem representar lançamentos legítimos iguais e exigem revisão.
3. **Aportes sem data:** permanecem no planejamento de qualquer período até receberem data; histórico já incluído no saldo precisa de reconciliação antes de lançar como realizado.
4. **Rollback após edição:** preserva ambos os lados, mas volta a mostrar a fotografia legada e bloqueia gravação até revisão; não há conversão reversa automática de dados posteriores.
5. **Dependências:** a auditoria npm executada nesta implementação apontou dois avisos moderados na cadeia ExcelJS/uuid, referentes ao mesmo advisory. O caminho afetado v3/v5/v6 com buffer não foi identificado no uso de v4 pelo ExcelJS instalado. Detalhes e fontes estão no guia; acompanhar correção upstream e reauditar antes de implantação.
6. **Escala:** contexto de importação e auditoria usam consultas em lote sobre o histórico; grandes bases exigem paginação/processamento limitado. O worker reduz impacto no fluxo principal, mas não oferece limite absoluto de memória para arquivos hostis.
7. **Sessão:** logout offline elimina o token local, mas não pode garantir revogação no servidor sem conexão; quando executada, a versão por usuário revoga todas as sessões, comportamento já existente.
8. **Validação externa:** testes de dispositivos físicos, entrega real Brevo e operação com a cópia do banco do usuário permanecem etapas de implantação. A edição REST usa última gravação por registro; múltiplas abas exigem coordenação.

O procedimento detalhado está em [ARQUITETURA-RELACIONAL.md](ARQUITETURA-RELACIONAL.md). Nenhuma aprovação adicional é necessária para revisar os arquivos; executar migrations no banco real continua dependendo da autorização específica solicitada pelo usuário.
