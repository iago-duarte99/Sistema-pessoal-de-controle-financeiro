import { pool } from './src/config/database.js';
export async function checkSchema(){
  const required={password_reset_tokens:['id','usuario_id','token_hash','expira_em','usado_em','criado_em'],usuarios:['id','nome','email','senha_hash','criado_em','atualizado_em'],contas:['id','usuario_id','nome','tipo','saldo_inicial','ativa','criado_em'],categorias:['id','usuario_id','nome','tipo','criado_em'],transacoes:['id','usuario_id','conta_id','categoria_id','descricao','valor','tipo','data_transacao','observacao','criado_em','atualizado_em'],app_perfis:['usuario_id','papel','versao_token'],app_estado:['usuario_id','dados','versao'],app_planejamentos:['id','usuario_id','transacao_id','descricao','categoria','valor_previsto','data_planejada'],app_migracoes:['usuario_id','origem','checksum','contagens','original','criado_em']};
  const [columns]=await pool.execute('SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
  const relational={investimentos:['id','usuario_id','legado_id','nome','saldo_atual','observacao','ativo'],aportes:['id','usuario_id','investimento_id','legado','valor','tipo','data_prevista','data_realizada','observacao'],metas:['id','usuario_id','legado_id','nome','descricao','valor_meta','valor_atual','data_limite','status'],notas:['id','usuario_id','legado','titulo','conteudo'],app_estado_migracoes:['usuario_id','original','checksum','versao_original','versao','ativo','contagens','rejeitados']};
  // Zero tabelas novas mantém a versão legada operacional. Instalação parcial falha claramente.
  if(columns.some(c=>relational[c.TABLE_NAME]))Object.assign(required,relational);
  const missing=[];
  for(const [table,names]of Object.entries(required))for(const name of names)if(!columns.some(c=>c.TABLE_NAME===table&&c.COLUMN_NAME===name))missing.push(table+'.'+name);
  if(missing.length)throw new Error('Estrutura incompleta. Confira os scripts SQL. Faltam: '+missing.join(', '));
  const [tables]=await pool.execute('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  if(tables.some(t=>required[t.TABLE_NAME]&&t.ENGINE!=='InnoDB'))throw new Error('As tabelas utilizadas devem ser InnoDB para garantir transações e rollback.');
  return true;
}
