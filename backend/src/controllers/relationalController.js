import { pool, transaction } from '../config/database.js';
import { owner } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import * as v from '../services/validation.js';
import { requireActive, bump, readState } from '../services/relational.js';

const optionalDate = x => x ? v.date(x) : null;
function legacyRows(table,state,parentId) {
  if(table==='investimentos')return state.dados.investments.map(x=>({id:x.id,nome:x.name,saldo_atual:x.balance,observacao:x.note,ativo:true,legado:true}));
  if(table==='metas')return state.dados.goals.map(x=>({id:x.id,nome:x.name,descricao:x.action,valor_meta:x.target,valor_atual:x.current,data_limite:x.deadline||null,status:'ativa',legado:true}));
  if(table==='notas')return state.dados.notes?[{id:null,titulo:'Notas migradas',conteudo:state.dados.notes,legado:true}]:[];
  const investment=state.dados.investments.find(x=>String(x.id)===String(parentId));
  if(!investment)throw new HttpError(404,'Investimento não encontrado.');
  return Number(investment.contribution)>0?[{id:null,investimento_id:investment.id,valor:investment.contribution,tipo:'planejado',data_prevista:null,data_realizada:null,legado:true}]:[];
}
export function valuesFor(table,b) {
  if (table==='investimentos') {
    if(b.ativo!==undefined && ![true,false,0,1].includes(b.ativo))v.invalid('Situação inválida.');
    return {nome:v.text(b.nome,'nome',150),saldo_atual:v.amount(b.saldo_atual,'saldo',0),observacao:v.text(b.observacao,'observação',10000,true),ativo:b.ativo===undefined?1:Number(b.ativo)};
  }
  if(table==='metas') {
    if(!['ativa','concluida','cancelada'].includes(b.status||'ativa'))v.invalid('Status inválido.');
    return {nome:v.text(b.nome,'nome',150),descricao:v.text(b.descricao,'descrição',10000,true),valor_meta:v.amount(b.valor_meta),valor_atual:v.amount(b.valor_atual,'valor atual',0),data_limite:optionalDate(b.data_limite),status:b.status||'ativa'};
  }
  if(table==='notas') {
    if(typeof b.conteudo!=='string'||!b.conteudo.length||b.conteudo.length>30000)v.invalid('Conteúdo deve ter de 1 a 30000 caracteres.');
    if(b.titulo!==undefined&&b.titulo!==null&&(typeof b.titulo!=='string'||b.titulo.length>150))v.invalid('Título deve ser um texto de até 150 caracteres.');
    return {titulo:b.titulo?.trim()||null,conteudo:b.conteudo};
  }
  if(!['planejado','realizado'].includes(b.tipo))v.invalid('Tipo de aporte inválido.');
  const result={valor:v.amount(b.valor),tipo:b.tipo,data_prevista:optionalDate(b.data_prevista),data_realizada:optionalDate(b.data_realizada),observacao:v.text(b.observacao,'observação',10000,true)};
  if(b.tipo==='realizado'&&!result.data_realizada)v.invalid('Informe a data de realização.');
  return result;
}
export async function record(db,table,id,userId) {
  const [rows]=await db.execute(`SELECT * FROM ${table} WHERE id=? AND usuario_id=?`,[id,userId]);
  if(!rows.length)throw new HttpError(404,'Registro não encontrado.');
  return rows[0];
}
export async function writeRecord(db,table,userId,id,body,parentId) {
  const data=valuesFor(table,body);
  let previous;
  if(id)previous=await record(db,table,id,userId);
  if(table==='notas') {
    // Notas antigas podem continuar sem título; editar conteúdo não as renomeia.
    if(previous&&body.titulo===undefined)data.titulo=previous.titulo;
    if(!previous||previous.titulo?.trim())data.titulo=v.text(data.titulo,'título',150);
  }
  if(table==='aportes') {
    const investment=await record(db,'investimentos',parentId||previous.investimento_id,userId);
    if(!investment.ativo)throw new HttpError(409,'Investimento inativo.');
    data.investimento_id=investment.id;
    // Saldo é uma fotografia atual: aportes realizados alteram somente a diferença.
    const delta=Math.round(Number(data.tipo==='realizado'?data.valor:0)*100)-Math.round(Number(previous?.tipo==='realizado'?previous.valor:0)*100);
    const balance=(Math.round(Number(investment.saldo_atual)*100)+delta)/100;
    v.amount(balance.toFixed(2),'saldo resultante',0);
    await db.execute('UPDATE investimentos SET saldo_atual=? WHERE id=? AND usuario_id=?',[balance.toFixed(2),investment.id,userId]);
  }
  const columns=Object.keys(data),values=Object.values(data);
  if(id)await db.execute(`UPDATE ${table} SET ${columns.map(c=>c+'=?').join(',')} WHERE id=? AND usuario_id=?`,[...values,id,userId]);
  else {const [r]=await db.execute(`INSERT INTO ${table}(usuario_id,${columns.join(',')}) VALUES(${Array(values.length+1).fill('?').join(',')})`,[userId,...values]);id=r.insertId;}
  if(table==='investimentos' && !previous && body.proximo_aporte!==undefined) {
    const value=v.amount(body.proximo_aporte,'próximo aporte',0);
    if(Number(value)>0)await db.execute("INSERT INTO aportes(usuario_id,investimento_id,valor,tipo,data_prevista) VALUES(?,?,?,'planejado',?)",[userId,id,value,optionalDate(body.data_aporte)]);
  }
  await bump(db,userId);
  return record(db,table,id,userId);
}
export function relationalController(table) {
  return {
    async list(req,res) {
      const userId=owner(req);
      const state=await readState(pool,userId,req.query);
      if(state.armazenamento==='legado') {
        return res.json(legacyRows(table,state,req.params.id));
      }
      if(table==='aportes')await record(pool,'investimentos',v.id(req.params.id),userId);
      const [rows]=await pool.execute(`SELECT * FROM ${table} WHERE usuario_id=?${table==='aportes'?' AND investimento_id=?':''} ORDER BY id`,table==='aportes'?[userId,v.id(req.params.id)]:[userId]);
      res.json(rows);
    },
    async get(req,res) {
      const userId=owner(req),state=await readState(pool,userId);
      if(state.armazenamento==='legado') {
        const row=legacyRows(table,state).find(x=>String(x.id)===req.params.id);
        if(!row)throw new HttpError(404,'Registro não encontrado.');
        return res.json(row);
      }
      res.json(await record(pool,table,v.id(req.params.id),userId));
    },
    async write(req,res) {
      const userId=owner(req),nested=table==='aportes'&&req.method==='POST',id=nested?null:(req.params.id?v.id(req.params.id):null);
      const result=await transaction(async db=>{
        await db.execute('SELECT id FROM usuarios WHERE id=? FOR UPDATE',[userId]);
        await requireActive(db,userId);
        return writeRecord(db,table,userId,id,req.body,nested?v.id(req.params.id):null);
      });
      res.status(id?200:201).json(result);
    },
    async remove(req,res) {
      const userId=owner(req),id=v.id(req.params.id);
      await transaction(async db=>{
        await db.execute('SELECT id FROM usuarios WHERE id=? FOR UPDATE',[userId]);
        await requireActive(db,userId);
        const previous=await record(db,table,id,userId);
        if(table==='aportes'&&previous.tipo==='realizado') {
          const investment=await record(db,'investimentos',previous.investimento_id,userId);
          const balance=(Math.round(Number(investment.saldo_atual)*100)-Math.round(Number(previous.valor)*100))/100;
          v.amount(balance.toFixed(2),'saldo resultante',0);
          await db.execute('UPDATE investimentos SET saldo_atual=? WHERE id=? AND usuario_id=?',[balance.toFixed(2),investment.id,userId]);
        }
        await db.execute(`DELETE FROM ${table} WHERE id=? AND usuario_id=?`,[id,userId]);await bump(db,userId);
      });res.status(204).end();
    }
  };
}
