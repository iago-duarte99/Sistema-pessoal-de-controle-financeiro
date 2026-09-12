import { pool, transaction } from '../config/database.js';
import { owner } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import * as v from '../services/validation.js';

import { readState, marker } from '../services/relational.js';

export const emptyState = () => ({ investments: [], goals: [], notes: '' });
export async function get(req,res) {
  res.json(await transaction(db=>readState(db,owner(req),req.query)));
}
export async function put(req,res) {
  const userId=owner(req), data=v.extra(req.body.dados), version=req.body.versao;
  if (!Number.isSafeInteger(version)||version<0) v.invalid('Versão inválida.');
  await transaction(async db=>{
    await db.execute('SELECT id FROM usuarios WHERE id=? FOR UPDATE',[userId]);
    if(await marker(db,userId)) throw new HttpError(409,'Use os formulários atualizados para alterar estes registros.');
    const [rows]=await db.execute('SELECT versao FROM app_estado WHERE usuario_id=? FOR UPDATE',[userId]);
    if ((rows[0]?.versao||0)!==version) throw new HttpError(409,'Dados alterados em outra janela. Recarregue antes de salvar.');
    await db.execute('INSERT INTO app_estado(usuario_id,dados,versao) VALUES(?,?,?) ON DUPLICATE KEY UPDATE dados=VALUES(dados),versao=VALUES(versao)',[userId,JSON.stringify(data),version+1]);
  });
  res.json({dados:data,versao:version+1});
}
export async function listPlans(req,res) {
  const {start,end}=v.period(req.query), values=[owner(req)];
  let where='usuario_id=? AND transacao_id IS NULL';
  if(start){where+=' AND data_planejada>=?';values.push(start);}
  if(end){where+=' AND data_planejada<=?';values.push(end);}
  const [rows]=await pool.execute('SELECT * FROM app_planejamentos WHERE '+where+' ORDER BY id',values);
  res.json(rows);
}
export async function writePlan(req,res) {
  const userId=owner(req), body=req.body, recordId=req.params.id?v.id(req.params.id):null;
  const values=[v.text(body.descricao,'descricao',255),v.text(body.categoria,'categoria',100),v.amount(body.valor_previsto,'valor_previsto',0),v.date(body.data_planejada)];
  const savedId=await transaction(async db=>{
    await db.execute('SELECT id FROM usuarios WHERE id=? FOR UPDATE',[userId]);
    if(recordId){
      const [r]=await db.execute('UPDATE app_planejamentos SET descricao=?,categoria=?,valor_previsto=?,data_planejada=? WHERE id=? AND usuario_id=? AND transacao_id IS NULL',[...values,recordId,userId]);
      if(!r.affectedRows)throw new HttpError(404,'Planejamento não encontrado.');
      return recordId;
    }
    const [r]=await db.execute('INSERT INTO app_planejamentos(descricao,categoria,valor_previsto,data_planejada,usuario_id) VALUES(?,?,?,?,?)',[...values,userId]);return r.insertId;
  });
  res.status(recordId?200:201).json({id:savedId});
}
export async function deletePlan(req,res) {
  const [r]=await pool.execute('DELETE FROM app_planejamentos WHERE id=? AND usuario_id=? AND transacao_id IS NULL',[v.id(req.params.id),owner(req)]);
  if(!r.affectedRows)throw new HttpError(404,'Planejamento não encontrado.');
  res.status(204).end();
}
