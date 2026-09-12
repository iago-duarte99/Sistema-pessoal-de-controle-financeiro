import { pool, transaction } from '../config/database.js';
import { owner } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import * as v from '../services/validation.js';
import { transactionValues, filters, summary } from '../services/finance.js';

const accountSelect = "SELECT c.*,c.saldo_inicial+COALESCE(SUM(CASE WHEN t.tipo='receita' THEN t.valor ELSE -t.valor END),0) saldo_atual FROM contas c LEFT JOIN transacoes t ON t.conta_id=c.id AND t.usuario_id=c.usuario_id";
export function controller(table) {
  const isTransaction = table === 'transacoes';
  async function list(req,res) {
    const userId = owner(req);
    let rows;
    if (table === 'contas') [rows] = await pool.execute(accountSelect + ' WHERE c.usuario_id=? GROUP BY c.id ORDER BY c.nome', [userId]);
    else if (isTransaction) {
      const f = filters(req.query,userId);
      [rows] = await pool.execute(`SELECT t.*,c.nome categoria_nome,a.nome conta_nome,p.valor_previsto FROM transacoes t JOIN categorias c ON c.id=t.categoria_id JOIN contas a ON a.id=t.conta_id LEFT JOIN app_planejamentos p ON p.transacao_id=t.id AND p.usuario_id=t.usuario_id WHERE ${f.sql} ORDER BY t.data_transacao DESC,t.id DESC`, f.values);
    } else {
      const values = [userId]; let condition = '';
      if (req.query.tipo !== undefined) { condition = ' AND tipo=?'; values.push(v.type(req.query.tipo)); }
      [rows] = await pool.execute('SELECT * FROM categorias WHERE usuario_id=?' + condition + ' ORDER BY nome',values);
    }
    res.json(rows);
  }
  async function get(req,res) {
    const userId = owner(req), recordId = v.id(req.params.id);
    const [rows] = await pool.execute(table === 'contas' ? accountSelect+' WHERE c.id=? AND c.usuario_id=? GROUP BY c.id' : `SELECT * FROM ${table} WHERE id=? AND usuario_id=?`, [recordId,userId]);
    if (!rows.length) throw new HttpError(404,'Registro não encontrado.');
    res.json(rows[0]);
  }
  async function write(req,res) {
    const userId=owner(req), recordId=req.params.id ? v.id(req.params.id) : null, body=req.body;
    const resultId = await transaction(async db => {
      // Serializa gravações do usuário com importações e validações relacionais.
      await db.execute('SELECT id FROM usuarios WHERE id=? FOR UPDATE',[userId]);
      if (recordId) {
        const [rows]=await db.execute(`SELECT id FROM ${table} WHERE id=? AND usuario_id=? FOR UPDATE`,[recordId,userId]);
        if (!rows.length) throw new HttpError(404,'Registro não encontrado.');
      }
      if (isTransaction && recordId && body.converter_planejamento === true) {
        const [existing] = await db.execute('SELECT tipo FROM transacoes WHERE id=? AND usuario_id=?',[recordId,userId]);
        if(existing[0].tipo!=='despesa') v.invalid('Apenas despesas podem virar planejamento.');
        await db.execute('DELETE FROM app_planejamentos WHERE transacao_id=? AND usuario_id=?',[recordId,userId]);
        await db.execute('INSERT INTO app_planejamentos(usuario_id,descricao,categoria,valor_previsto,data_planejada) VALUES(?,?,?,?,?)',[userId,v.text(body.descricao,'descricao',255),v.text(body.categoria,'categoria',100),v.amount(body.valor_previsto,'valor_previsto',0),v.date(body.data_planejada)]);
        await db.execute('DELETE FROM transacoes WHERE id=? AND usuario_id=?',[recordId,userId]);
        return null;
      }
      let columns, values;
      if (isTransaction) {
        columns=['conta_id','categoria_id','descricao','valor','tipo','data_transacao','observacao'];
        values=await transactionValues(db,body,userId);
      } else if (table==='contas') {
        columns=['nome','tipo','saldo_inicial','ativa'];
        if (body.ativa !== undefined && ![true,false,0,1].includes(body.ativa)) v.invalid('ativa deve ser booleano.');
        values=[v.text(body.nome,'nome',100),v.text(body.tipo,'tipo',50),v.amount(body.saldo_inicial,'saldo_inicial',-9999999999999.99),body.ativa===undefined?1:Number(body.ativa)];
      } else {
        columns=['nome','tipo']; values=[v.text(body.nome,'nome',100),v.type(body.tipo)];
        if (recordId) {
          const [used]=await db.execute('SELECT id FROM transacoes WHERE categoria_id=? AND usuario_id=? AND tipo<>? LIMIT 1',[recordId,userId,body.tipo]);
          if (used.length) throw new HttpError(409,'Categoria já utilizada por transações de outro tipo.');
        }
      }
      let savedId=recordId;
      if (recordId) await db.execute(`UPDATE ${table} SET ${columns.map(c=>c+'=?').join(',')} WHERE id=? AND usuario_id=?`,[...values,recordId,userId]);
      else {
        const [result]=await db.execute(`INSERT INTO ${table}(usuario_id,${columns.join(',')}) VALUES(${Array(values.length+1).fill('?').join(',')})`,[userId,...values]);
        savedId=result.insertId;
      }
      if (isTransaction) {
        if(body.planejamento_id !== undefined){
          if(recordId||body.tipo!=='despesa') v.invalid('Conversão de planejamento inválida.');
          const [deleted]=await db.execute('DELETE FROM app_planejamentos WHERE id=? AND usuario_id=? AND transacao_id IS NULL',[v.id(body.planejamento_id),userId]);
          if(!deleted.affectedRows)throw new HttpError(409,'Planejamento não encontrado ou já realizado.');
        }
        if (body.tipo === 'receita') await db.execute('DELETE FROM app_planejamentos WHERE transacao_id=? AND usuario_id=?',[savedId,userId]);
        else if (body.valor_previsto !== undefined) {
          const planned=v.amount(body.valor_previsto,'valor_previsto',0);
          await db.execute('INSERT INTO app_planejamentos(usuario_id,transacao_id,descricao,categoria,valor_previsto,data_planejada) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE descricao=VALUES(descricao),categoria=VALUES(categoria),valor_previsto=VALUES(valor_previsto),data_planejada=VALUES(data_planejada)',[userId,savedId,body.descricao,'',planned,body.data_transacao]);
        }
      }
      return savedId;
    });
    if(resultId===null)return res.json({convertida:true});
    const [rows]=await pool.execute(`SELECT * FROM ${table} WHERE id=? AND usuario_id=?`,[resultId,userId]);
    res.status(recordId?200:201).json(rows[0]);
  }
  async function remove(req,res) {
    const userId=owner(req), recordId=v.id(req.params.id);
    await transaction(async db=>{
      await db.execute('SELECT id FROM usuarios WHERE id=? FOR UPDATE',[userId]);
      if(table==='contas'||table==='categorias'){
        const column=table==='contas'?'conta_id':'categoria_id';
        const [linked]=await db.execute(`SELECT id FROM transacoes WHERE ${column}=? AND usuario_id=? LIMIT 1`,[recordId,userId]);
        if(linked.length)throw new HttpError(409,'Registro possui transações vinculadas. Remova os vínculos ou desative a conta.');
      }
      if (isTransaction) await db.execute('DELETE FROM app_planejamentos WHERE transacao_id=? AND usuario_id=?',[recordId,userId]);
      const [result]=await db.execute(`DELETE FROM ${table} WHERE id=? AND usuario_id=?`,[recordId,userId]);
      if (!result.affectedRows) throw new HttpError(404,'Registro não encontrado.');
    });
    res.status(204).end();
  }
  return { list,get,write,remove };
}
export async function saldo(req,res) {
  const userId=owner(req);
  const [rows]=await pool.execute(accountSelect+' WHERE c.id=? AND c.usuario_id=? GROUP BY c.id',[v.id(req.params.id),userId]);
  if (!rows.length) throw new HttpError(404,'Conta não encontrada.');
  res.json({ conta_id: rows[0].id, saldo_inicial: rows[0].saldo_inicial, saldo_atual: rows[0].saldo_atual });
}
export async function resumo(req,res) { res.json(await transaction(db=>summary(db,owner(req),req.query))); }
