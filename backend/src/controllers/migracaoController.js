import { marker } from '../services/relational.js';
import { createHash } from 'node:crypto';
import { pool, transaction } from '../config/database.js';
import { owner } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import * as v from '../services/validation.js';

export async function status(req,res) {
  const [rows]=await pool.execute('SELECT origem,checksum,contagens,criado_em FROM app_migracoes WHERE usuario_id=?',[owner(req)]);
  res.json(rows);
}
export async function migrate(req,res) {
  const userId=owner(req), body=req.body, origin=v.text(body.origem,'origem',200), day=v.date(body.data_referencia);
  const data=body.dados;
  if(!data||!Array.isArray(data.accounts)||!Array.isArray(data.expenses)||data.accounts.length>1000||data.expenses.length>5000) v.invalid('Dados legados inválidos.');
  const extras=v.extra(data), income=v.amount(data.income,'renda',0);
  const accounts=data.accounts.map(a=>({nome:v.text(a.name,'conta',100),saldo:v.amount(a.value,'saldo',-9999999999999.99)}));
  const expenses=data.expenses.map(e=>({descricao:v.text(e.description,'descricao',255),categoria:v.text(e.category,'categoria',100),previsto:v.amount(e.planned,'previsto',0),realizado:v.amount(e.actual,'realizado',0)}));
  const checksum=createHash('sha256').update(JSON.stringify({origem:origin,data_referencia:day,dados:data})).digest('hex');
  const result=await transaction(async db=>{
    await db.execute('SELECT id FROM usuarios WHERE id=? FOR UPDATE',[userId]);
    const [previous]=await db.execute('SELECT checksum,contagens FROM app_migracoes WHERE usuario_id=? AND origem=?',[userId,origin]);
    if(previous.length){
      if(previous[0].checksum!==checksum)throw new HttpError(409,'Esta origem já foi importada com outros dados ou outra data.');
      return {concluida:true,checksum,contagens:previous[0].contagens,repetida:true};
    }
    if(await marker(db,userId))throw new HttpError(409,'Importação legada requer perfil sem dados financeiros.');
    for(const table of ['contas','categorias','transacoes','app_estado','app_planejamentos']){
      const [rows]=await db.execute(`SELECT usuario_id FROM ${table} WHERE usuario_id=? LIMIT 1`,[userId]);
      if(rows.length)throw new HttpError(409,'Importação requer um perfil sem dados financeiros, para evitar duplicação.');
    }
    if(!accounts.length)accounts.push({nome:'Conta importada',saldo:'0.00'});
    // Os saldos legados são fotografias atuais. Ajusta apenas a abertura da conta
    // de referência para não somar novamente as receitas/despesas importadas.
    const cents=x=>Math.round(Number(x)*100);
    const opening=(cents(accounts[0].saldo)-cents(income)+expenses.reduce((s,e)=>s+cents(e.realizado),0))/100;
    accounts[0].saldo=v.amount(opening.toFixed(2),'saldo de abertura',-9999999999999.99);
    const ids=[];
    for(const a of accounts){const [r]=await db.execute('INSERT INTO contas(usuario_id,nome,tipo,saldo_inicial,ativa) VALUES(?,?,?,?,1)',[userId,a.nome,'corrente',a.saldo]);ids.push(r.insertId);}
    const categoryIds=new Map();
    async function category(name,type){
      const key=type+':'+name;
      if(!categoryIds.has(key)){const [r]=await db.execute('INSERT INTO categorias(usuario_id,nome,tipo) VALUES(?,?,?)',[userId,name,type]);categoryIds.set(key,r.insertId);}
      return categoryIds.get(key);
    }
    let count=0;
    if(Number(income)>0){await db.execute('INSERT INTO transacoes(usuario_id,conta_id,categoria_id,descricao,valor,tipo,data_transacao,observacao) VALUES(?,?,?,?,?,?,?,?)',[userId,ids[0],await category('Renda importada','receita'),'Renda realizada importada',income,'receita',day,'Importação localStorage: renda agregada, sem histórico de datas.']);count++;}
    for(const e of expenses){
      let transactionId=null;
      const categoryId=await category(e.categoria,'despesa');
      if(Number(e.realizado)>0){const [r]=await db.execute('INSERT INTO transacoes(usuario_id,conta_id,categoria_id,descricao,valor,tipo,data_transacao,observacao) VALUES(?,?,?,?,?,?,?,?)',[userId,ids[0],categoryId,e.descricao,e.realizado,'despesa',day,'Importação localStorage: conta e data de referência.']);transactionId=r.insertId;count++;}
      await db.execute('INSERT INTO app_planejamentos(usuario_id,transacao_id,descricao,categoria,valor_previsto,data_planejada) VALUES(?,?,?,?,?,?)',[userId,transactionId,e.descricao,e.categoria,e.previsto,day]);
    }
    await db.execute('INSERT INTO app_estado(usuario_id,dados,versao) VALUES(?,?,1)',[userId,JSON.stringify(extras)]);
    const counts={contas:ids.length,categorias:categoryIds.size,transacoes:count,planejamentos:expenses.length,investimentos:extras.investments.length,metas:extras.goals.length};
    await db.execute('INSERT INTO app_migracoes(usuario_id,origem,checksum,contagens,original) VALUES(?,?,?,?,?)',[userId,origin,checksum,JSON.stringify(counts),JSON.stringify({data_referencia:day,dados:data})]);
    return {concluida:true,checksum,contagens:counts,repetida:false};
  });
  res.status(result.repetida?200:201).json(result);
}
