# Inventário e migração do localStorage

## Inventário realizado antes das alterações

O diretório continha `index.html`, `app.js`, `styles.css`, `auth.css` e `README.txt`. Não havia package.json, módulos externos, servidor, SQL, exportações, importações, biblioteca de gráficos ou configuração Sites. Havia alterações locais prévias em app.js/index.html/README.txt e auth.css não rastreado; foram respeitadas como base do trabalho.

O HTML tinha formulários de login, cadastro, edição financeira e edição de perfis. Telas: dashboard, despesas, investimentos, contas, metas, notas e perfis. O JavaScript concentrava autenticação PBKDF2, navegação, CRUD em arrays, formatação, busca, renderizadores, projeções e persistência local. Gráficos eram barras HTML/CSS, sem canvas ou biblioteca. A renda era um único número, categorias eram texto livre nas despesas e contas guardavam uma fotografia do saldo. Não havia datas nas receitas/despesas, filtros de período, transferências, histórico ou configurações separadas.

| Chave | Conteúdo original |
|---|---|
| `controleFinanceiroUsersV2` | Array de `{id: UUID, name, email, role, createdAt, salt, hash}`; senha PBKDF2-SHA256, 210000 iterações |
| `controleFinanceiroSessionV2` | UUID da sessão local, sem token assinado |
| `controleFinanceiroDataV2:<UUID>` | Objeto financeiro abaixo |
| `controleFinanceiroDataV2:<UUID>:backup` | `{savedAt: ISO, data: objetoFinanceiro}` |

```js
{
  income: 100,
  expenses: [{id: 1, category: 'Categoria Exemplo', description: 'Despesa Exemplo', planned: 5, actual: 5}],
  investments: [{id: 1, name: 'Investimento Exemplo', balance: 10, contribution: 1, note: 'Demonstração'}],
  accounts: [{id: 1, name: 'Conta Exemplo', value: 10}],
  goals: [{id: 1, name: 'Meta Exemplo', target: 50, current: 10, deadline: '2030-01-01', action: 'Ação demonstrativa'}],
  notes: ''
}
```

Os valores acima são inteiramente fictícios e demonstrativos, sem reproduzir os dados do seed antigo. Nenhum perfil de navegador foi acessado para extrair finanças reais. O seed permanece como referência, mas novos perfis MySQL começam vazios.

## Regras da importação

1. Cadastre o usuário na API com o mesmo e-mail e uma senha nova (pode ser a mesma, se preferir). Não é possível converter diretamente hash PBKDF2 em bcrypt. Papéis antigos não são confiados nem importados.
2. Preserve uma cópia dos dados antigos. O código novo não modifica suas chaves financeiras, de usuários, backup ou sessão antigos.
3. Entre no perfil MySQL vazio, clique Importar dados locais e confirme a senha do perfil local. A verificação PBKDF2 ocorre somente no navegador.
4. Escolha uma data de referência: o armazenamento antigo não permite reconstruir datas históricas.
5. A renda vira uma receita agregada. Despesas positivas viram transações; realizado zero vira apenas planejamento. Previsto é preservado em tabela auxiliar. Categorias são deduplicadas por nome e tipo na importação.
6. Transações são associadas à primeira conta importada. Se não houver contas, é criada Conta importada. Como os saldos antigos representam valores atuais, o saldo de abertura da conta de referência é ajustado por `saldo_antigo − renda + despesas`. Isso preserva os saldos finais sem contar os lançamentos duas vezes. Não representa o histórico real da instituição; revise posteriormente conta/data se necessário.
7. Investimentos, metas e notas ficam em `app_estado`. O conteúdo original e a data ficam em `app_migracoes` para conferência; senhas/cadastros não integram esse envio.
8. Toda a importação ocorre numa transação SQL com bloqueio do usuário. Falhas causam rollback. Depois do commit, o navegador consulta o recibo e compara checksum. Só então grava `controleFinanceiroDataV2:<UUID>:mysql:<id>:migracao`.
9. Recibo é único por usuário/origem. Repetir o mesmo conteúdo e a mesma data retorna o recibo existente; conteúdo diferente é recusado. Banco com finanças já cadastradas é recusado para evitar sobreposição. Não se deve apagar o recibo para repetir uma importação.
10. Confira saldos, despesas, planos, caixinhas, metas e notas. Qualquer exclusão dos dados locais antigos é uma decisão manual posterior do usuário; não há exclusão automática.

## Dados em outra origem, file:// ou backup

localStorage é separado por origem e perfil do navegador. Ao mudar de duplo clique (`file://`) ou de outra porta para `http://localhost:3000`, dados antigos podem não estar visíveis. Não copie o array de usuários, hashes ou a sessão para o servidor.

Na página antiga, com o perfil correto selecionado, abra o console do navegador e execute:

```js
const perfilLegado = localStorage.getItem('controleFinanceiroSessionV2');
const origemLegada = `controleFinanceiroDataV2:${perfilLegado}`;
const dadosLegados = JSON.parse(localStorage.getItem(origemLegada));
copy(JSON.stringify({origem: origemLegada, data_referencia: '2026-09-04', dados: dadosLegados}));
```

`copy` é um utilitário do console do Chrome/Edge. Ajuste a data explicitamente. Salve o resultado em um arquivo privado fora do repositório. Se houver apenas `:backup`, o objeto financeiro está em `JSON.parse(localStorage.getItem(origemLegada + ':backup')).data`.

Com um token de login do perfil MySQL vazio, envie esse JSON para `POST /api/migracoes/localstorage` via REST Client/Thunder Client. A autorização será a do perfil MySQL; você é responsável por selecionar os dados locais corretos nesse procedimento manual. Consulte `GET /api/migracoes/localstorage` e confira as contagens. Não envie credenciais PBKDF2 nem chaves de sessão.

Em caso de timeout, mantenha exatamente a mesma origem/conteúdo/data ao repetir. Não tente importar por cima de um perfil com lançamentos já adicionados. Guarde o original até conferir a migração integralmente.
