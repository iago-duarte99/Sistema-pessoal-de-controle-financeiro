# Evolução relacional — operação e validação

## Base analisada e preservada

O projeto recebido já tinha frontend HTML/CSS/JavaScript, API Express, MySQL, JWT em memória, bcryptjs, perfis, recuperação com tokens temporários, SMTP Brevo, revogação por `app_perfis.versao_token` e importação de localStorage. A análise foi feita pelo código, SQL, documentação e testes; não houve leitura dos dados pessoais do banco real ou do navegador.

Havia alterações locais anteriores, inclusive arquivos não rastreados. Elas foram usadas como base, sem reset, recriação ou commit. `backend/.env` não foi alterado. Nenhuma migration foi aplicada ao banco real.

## Estrutura

```text
usuarios
├── contas / categorias / transacoes
├── investimentos ── aportes
├── metas
├── notas
├── password_reset_tokens
└── app_perfis

Transição: app_estado + app_estado_migracoes
Planejamento existente: app_planejamentos
Recibos de importação: app_migracoes
```

| Migration manual | Tabelas e finalidade |
|---|---|
| `004_investimentos.sql` | `investimentos`, `aportes`; valores DECIMAL, situação, datas e histórico |
| `005_metas.sql` | `metas`; valor objetivo, progresso, prazo e status |
| `006_notas.sql` | `notas`; título e conteúdo |
| `007_migracao_app_estado.sql` | `app_estado_migracoes`; snapshot integral, SHA-256, versões, contagens, rejeições e ativação |

Índices abrangem usuário/situação/período e IDs legados únicos por usuário. `aportes` possui FK composta `(investimento_id, usuario_id)` para o investimento, com exclusão em cascata. Os tipos dessas duas tabelas são controlados pelos novos scripts.

Não foi adicionada FK de `usuario_id` para `usuarios`: as tabelas auxiliares existentes já documentavam possíveis diferenças de tipo/signedness na base legada. A API valida o proprietário a partir do JWT, bloqueia a linha do usuário nas gravações e exclui os novos registros em transação ao excluir um perfil. Antes de adicionar essa FK no banco real, conferir `SHOW CREATE TABLE usuarios`, signedness, engine e eventuais órfãos. Não alterar os tipos legados automaticamente.

## Aplicação manual em fases

1. Parar gravações durante a janela de atualização, fazer backup completo e testar a restauração em uma cópia. Manter também a versão anterior do código.
2. Confirmar MySQL 8/InnoDB e selecionar explicitamente o banco desejado no cliente SQL administrativo.
3. Revisar e executar **manualmente** os quatro arquivos 004–007, nessa ordem. Não há `USE`, `DROP` ou `TRUNCATE` nesses arquivos. DDL MySQL tem commit implícito: não contar com rollback de DDL. Se a aplicação encontrar apenas parte das novas tabelas, sua validação de esquema interrompe a inicialização até concluir/corrigir a instalação.
4. Instalar as dependências com `npm ci`, na pasta `backend`. O início normal da API não executa DDL nem transforma dados legados.
5. Executar o comando abaixo primeiro sem `--apply`. Ele apenas explica o procedimento; não consulta nem transforma dados.

```powershell
npm run migrate:state
# Somente após autorização e revisão do banco selecionado:
npm run migrate:state -- --apply
npm run audit:migration
npm run check:db
```

O script com `--apply` usa a configuração já existente. Não imprime credenciais. Cada usuário é uma transação independente: falha em um usuário desfaz integralmente suas inserções/recibo e interrompe o script; usuários anteriores já confirmados permanecem migrados. Pode repetir com segurança: recibos existentes impedem duplicação.

## Transformação e compatibilidade

- Lê `app_estado.dados` como texto da representação armazenada pelo MySQL; grava esse texto integral em `original` com checksum antes das inserções. O MySQL já normaliza a representação de colunas JSON: não é possível recuperar a formatação que existia antes da primeira gravação no banco.
- Valida listas, IDs, dinheiro, datas e textos. Copia apenas registros válidos e registra o índice/aviso dos inválidos, sem imprimir seu conteúdo.
- `investments.name/balance/note` vira `nome/saldo_atual/observacao`. `contribution > 0` cria **um aporte planejado sem data**, marcado como legado.
- `goals.name/action/target/current/deadline` vira `nome/descricao/valor_meta/valor_atual/data_limite`.
- A string de notas vira “Notas migradas”, preservando espaços/quebras de linha. Uma string vazia não cria nota.
- IDs antigos ficam em `legado_id BIGINT`, únicos por usuário. IDs relacionais são novos INTs; não se presume que coincidam.
- Reconsulta os registros inseridos e compara valores, textos, datas e contagens antes de ativar a leitura relacional.
- Se houver qualquer rejeição, o snapshot e os registros válidos permanecem, mas `ativo=0`. Não mistura dados parciais com o legado. Dados legados inválidos produzem aviso de revisão na interface; não são silenciosamente descartados na leitura.
- Sem novas tabelas, o aplicativo continua usando `/estado`. Com tabelas instaladas, usuários sem `app_estado` começam diretamente no modelo relacional quando gravam seu primeiro registro. GET não cria recibos nem registros.
- Usuários legados só mudam de fonte depois do script validado. Após isso, GET `/estado` é um **adaptador de leitura** das novas tabelas; o frontend usa os novos endpoints para escrever. PUT `/estado` é bloqueado se houver recibo, inclusive durante rollback/revisão.
- Uma lista relacional vazia depois de exclusões **continua vazia**. O marcador explícito impede que o fallback ressuscite registros apagados.
- O JSON antigo não recebe escrita dupla após a ativação e não é apagado nesta fase.

Os endpoints de coleção também oferecem fallback de leitura no formato de seus campos REST, com `legado:true`; IDs legados não autorizam escrita relacional. Notas e aportes legados sem ID próprio retornam `id:null`. A interface existente usa o adaptador `/estado`, que informa `armazenamento` e `versao`.

Registros rejeitados exigem revisão do responsável. A reexecução não tenta corrigir ou apagar automaticamente uma migração parcial. Corrigir e reconciliar em uma cópia, conferir mapeamentos/recibos e só então planejar a correção manual na base principal.

## Auditoria e rollback

`npm run audit:migration` usa somente SELECTs em uma transação para uma visão consistente. Informa usuários analisados, investimentos/metas/notas encontrados e migrados, divergências, integridade do snapshot, valores/textos/datas e aporte legado. Código de saída: 0 sem divergências, 2 com divergências, 1 se não consegue auditar.

A comparação utiliza o snapshot original e o JSON preservado. Depois de edições/exclusões legítimas nas novas tabelas, divergências são esperadas e recebem `alterado_apos_migracao:true`, conforme a versão do recibo. A auditoria não interpreta isso automaticamente como corrupção nem sobrescreve o estado atual. Guarde o primeiro relatório sem divergências antes de liberar gravações.

**Rollback operacional sem apagar dados:** interromper gravações, exportar as novas tabelas e os recibos, conferir a versão e executar manualmente, para um usuário previamente revisado:

```sql
-- Trocar 123 pelo usuário revisado. Não executar indiscriminadamente.
UPDATE app_estado_migracoes SET ativo=0 WHERE usuario_id=123;
```

Isso volta a exibir o legado e mantém o modelo relacional intacto. As gravações de investimentos/metas/notas ficam bloqueadas para evitar divergências adicionais. Restaurar `ativo=1` reativa os dados relacionais preservados. Não há exclusão automática de tabelas/linhas para “desfazer” a migration.

Se já houve edições relacionais, o JSON antigo estará desatualizado. Voltar à versão anterior do aplicativo sem reconciliar essas edições pode apresentar dados antigos e permitir escritas divergentes. Para um rollback completo com escrita, exportar e reconciliar essas mudanças primeiro em uma cópia; exigir revisão do responsável antes de restaurar dados. O snapshot/backup permite recuperar a situação anterior, mas não substitui esse processo.

**Remoção futura do fallback:** migrar todos os usuários, resolver rejeições, guardar auditoria inicial e backups, monitorar leituras legadas, eliminar o PUT e o adaptador de compatibilidade numa versão separada. Somente depois da política de retenção e de aprovação específica considerar arquivar/remover `app_estado`. Não há comando de remoção nesta entrega.

## API autenticada

| Recurso | Métodos/caminhos |
|---|---|
| Investimentos | GET/POST `/api/investimentos`; GET/PUT/DELETE `/api/investimentos/:id` |
| Aportes | GET/POST `/api/investimentos/:id/aportes`; PUT/DELETE `/api/aportes/:id` |
| Metas | GET/POST `/api/metas`; GET/PUT/DELETE `/api/metas/:id` |
| Notas | GET/POST `/api/notas`; GET/PUT/DELETE `/api/notas/:id` |
| Importação | GET `/api/importacao/contexto`; POST `/api/importacao` |

Todos usam o middleware autenticado existente e `owner(req)`; nunca confiam em `usuario_id` para escolher o proprietário. Vínculos são consultados com usuário + ID, queries parametrizadas e mutações em transação. Informar ID alheio não dá acesso, inclusive para administradores.

PUT recebe o formulário completo. Campos:

```json
{"nome":"Reserva","saldo_atual":"1000.00","observacao":"","ativo":true}
{"valor":"50.00","tipo":"planejado","data_prevista":"2026-09-05","data_realizada":null,"observacao":""}
{"nome":"Viagem","descricao":"Poupar","valor_meta":"2000.00","valor_atual":"500.00","data_limite":"2027-01-01","status":"ativa"}
{"titulo":"Planejamento","conteudo":"Revisar despesas."}
```

POST investimento aceita ainda `proximo_aporte` e `data_aporte` para criar seu primeiro planejamento na mesma transação. PUT investimento não cria aporte adicional: a edição do histórico é explícita.

## Regras financeiras

O resumo no backend é a fonte dos indicadores. Valores são somados em centavos inteiros com BigInt, sem arredondamento binário dos totais. O frontend formata os resultados e renderiza gráficos/progresso.

- Patrimônio = saldo atual dos investimentos ativos.
- Planejamento = aportes planejados dos investimentos ativos no período inclusivo selecionado.
- Aportes sem data são exibidos em qualquer período, para preservar o comportamento legado. Não significam recorrência real. Atribua datas pelo histórico para planejar um mês específico.
- Patrimônio após aportes = patrimônio + planejamento.
- Saldo livre = receitas realizadas − despesas realizadas − planejamento.
- Ao criar um aporte realizado, seu valor aumenta o saldo atual. Editar usa somente a diferença entre valor realizado antigo e novo; converter para planejado ou excluir reverte o valor realizado. Saldo negativo resultante é rejeitado.
- Esse ajuste não cria transação bancária nem desconta de uma conta: transferências/vínculos bancários não existiam no modelo e não são inferidos. Ao registrar histórico que **já esteja incluído** na fotografia do saldo, primeiro reconciliar a abertura do investimento; lançar novamente como realizado somará novamente ao saldo.
- Não subtrai aportes históricos do saldo livre mensal. Contas preservam saldo inicial + receitas − despesas de todo o histórico.

## Interface, privacidade e sessão

O layout foi mantido. O login recebe três ilustrações vetoriais locais pequenas, produzidas no projeto, com variação por acesso, transição de opacidade, dimensões explícitas, prioridade da primeira imagem e fallback textual. Não há imagens externas, rastreadores nem download de fotos pesadas. Movimento reduzido é respeitado. As imagens são conceituais, sem previsão de rendimento.

As frases solicitadas foram substituídas. Mensagens de sincronização/erros não mostram detalhes de infraestrutura, SQL ou credenciais. As instruções técnicas ficam nesta documentação.

“Sair” está no menu do usuário. Inicia a revogação existente no servidor e termina a sessão local mesmo sem rede; limpa token em memória, arrays, perfis, notas, conteúdo de listas, diálogos, prévia de importação e worker. A chave antiga de sessão é removida, mas chaves financeiras/backups de localStorage permanecem. Respostas atrasadas são rejeitadas por geração de sessão. `pagehide/pageshow` impede restauração de uma sessão via cache de navegação. Recarregar exige autenticação nova.

Se a chamada de logout não alcançar o servidor, o token já emitido não foi revogado no servidor e permanece sujeito à sua expiração; o navegador não o retém. Quando a revogação funciona, o mecanismo preexistente invalida **todas** as sessões desse usuário, pois usa uma versão por usuário. Não foi introduzida blacklist.

“Atualizar dados” faz seis GETs independentes, sem POST, salvamento ou importação. Carrega contas, categorias, transações, planejamento, investimentos/aportes/metas/notas pelo adaptador e resumo; rerenderiza saldos/gráficos. Bloqueia cliques concorrentes, informa loading/sucesso/erro e pede aguardar notas pendentes, em vez de gravá-las como efeito da atualização.

Exclusões e importação usam diálogo nativo com confirmação, foco contido, Escape/cancelamento e retorno ao acionador. Notas agora podem ser escolhidas/criadas separadamente. O histórico de aportes permite criar, editar e excluir. Mensagens têm `role=status/alert`, foco visível e controles rotulados.

Login, cadastro e recuperação foram mantidos. SMTP Brevo, bcryptjs e revogação por versão continuam com a configuração existente; os testes simulam o transporte, sem enviar e-mail real. Não houve modificação do `.env` real.

## Importação por arquivo

Escopo inicial: receitas e despesas **realizadas**. Não interpreta automaticamente extratos arbitrários, saldos, metas, investimentos, aportes ou exportações legadas completas. Para o formato antigo, o botão separado **Migrar dados deste navegador** mantém a validação PBKDF2, confirmação e recibo existentes.

CSV/XLSX usam cabeçalho `tipo, descricao, valor, data, categoria, conta, status`; `status` é opcional e vale `realizado`. JSON usa uma lista de objetos com esses campos. Campos desconhecidos são rejeitados. Conta e categoria precisam existir, ser únicas pelo nome informado e ter tipo/situação compatíveis; não são criadas silenciosamente.

```csv
tipo;descricao;valor;data;categoria;conta;status
receita;Salário;2500,00;2026-09-05;Salário;Conta principal;realizado
despesa;Mercado;125,30;2026-09-05;Alimentação;Conta principal;realizado
```

Limites: arquivo de 2 MB, até 500 registros; XLSX com uma aba, até 7 colunas, diretório ZIP declarado de até 20 MB/2000 entradas e processamento em worker com limite de 10 segundos. Fórmulas, links, células complexas e arquivos criptografados não são aceitos. CSV trata aspas, BOM, separadores vírgula/ponto e vírgula/tab, UTF-8 e fallback Windows-1252. JSON exige UTF-8. Datas aceitam ISO ou DD/MM/AAAA; dinheiro admite vírgula decimal brasileira e até duas casas.

Extensão/MIME/tamanho são verificados antes da leitura. Conteúdo é analisado em worker; nunca é executado. ExcelJS é servido localmente e carregado apenas para XLSX. Arquivo não vai para terceiros nem é enviado bruto à API. Antes da confirmação, a API recebe apenas GET para obter contexto do próprio usuário.

A prévia mostra os oito campos solicitados, totais e avisos. Detecta duplicados dentro do arquivo e contra todo o histórico (tipo, descrição, valor, data, categoria, conta e status). Eventos legítimos com todos esses campos idênticos serão considerados duplicados; revise antes de importar.

Depois da confirmação explícita, envia os registros à própria API. O backend valida de novo sob bloqueio do usuário, ignora duplicados, rejeita inválidos e insere os válidos atomicamente. Guarda recibo SHA-256 em `app_migracoes`, permitindo repetir após falha de rede sem duplicar. Retorna importados/ignorados/rejeitados. Nenhum registro existente é substituído.

## Dependências e limites conhecidos

Foi adicionado [ExcelJS 4.4.0](https://github.com/exceljs/exceljs), com lockfile. A auditoria npm encontrou dois avisos moderados: ExcelJS e sua dependência uuid, ambos referentes ao mesmo [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). O advisory trata de v3/v5/v6 com buffer de saída; a inspeção do ExcelJS instalado identificou uso de v4, sem esse caminho. Isso não equivale a ausência de vulnerabilidades. Não se aplicou downgrade automático sugerido pelo npm nem um override incompatível; acompanhar atualização upstream e reauditar antes de implantação.

Os limites ZIP usam metadados do arquivo e não equivalem a sandbox de memória absoluta; arquivos hostis ainda podem consumir recursos do worker/navegador. Para importação pública de alto volume, considerar parser com descompressão incremental limitada. O endpoint de contexto carrega fingerprints do histórico inteiro, e a auditoria administrativa lê tabelas em lote: para bases grandes, evoluir paginação/consulta por fingerprints e processamento em lotes limitados.

O modelo relacional usa última escrita por registro nos formulários REST. A proteção otimista antiga de `/estado` continua só para usuários legados; múltiplas abas editando o mesmo registro relacional exigem coordenação. Backups regulares, HTTPS, revisão de permissões e teste com uma cópia da base real continuam necessários antes de implantação.

## Testes

```powershell
cd backend
npm test
npm run test:mysql:isolated
# Revisão visual opcional: banco/servidor temporários, encerrados em até 15 minutos
npm run test:mysql:isolated -- --preview
```

O runner cria sua própria instância em 33307, usa credenciais efêmeras, aplica/reaplica migrations somente nessa instância, executa testes e encerra o processo. Não acessa o serviço 3306. O preview usa 33308 e só inicia se receber a configuração de teste isolada. Artefatos temporários permanecem ignorados pelo Git para diagnóstico. Não executar os testes de integração apontando para uma base de produção.

Cobertura: compatibilidade legada, normalização, IDs, valores, aportes, CRUD, isolamento, idempotência, falha com rollback, JSON preservado, auditoria, não ressurreição, cálculos exatos, importação concorrente, CSV/JSON/XLSX, validação, confirmação/cancelamento, logout, respostas atrasadas, atualização GET, login/fallback, cadastro e recuperação. Os testes SMTP usam transporte simulado; a entrega real Brevo não é verificada automaticamente.
