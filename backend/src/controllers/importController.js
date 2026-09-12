import '../../../js/import-schema.js';
import { pool, transaction } from '../config/database.js';
import { owner } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { hash } from '../services/relational.js';
const schema=globalThis.FinanceImport;
export async function context(db,userId) {
  const [accounts]=await db.execute('SELECT id,nome,ativa FROM contas WHERE usuario_id=?',[userId]);
  const [categories]=await db.execute('SELECT id,nome,tipo FROM categorias WHERE usuario_id=?',[userId]);
  const [rows]=await db.execute('SELECT t.tipo,t.descricao,t.valor,t.data_transacao data,c.nome categoria,a.nome conta FROM transacoes t JOIN contas a ON a.id=t.conta_id AND a.usuario_id=t.usuario_id JOIN categorias c ON c.id=t.categoria_id AND c.usuario_id=t.usuario_id WHERE t.usuario_id=?',[userId]);
  return {accounts,categories,existing:rows.map(r=>schema.fingerprint({...r,valor:Number(r.valor).toFixed(2),status:'realizado'}))};
}
export async function getContext(req,res){res.json(await transaction(db=>context(db,owner(req))));}
export async function commit(req,res) {
  const userId=owner(req);
  if(req.body.confirmado!==true)throw new HttpError(400,'Confirme a prévia antes de importar.');
  if(!Array.isArray(req.body.registros)||req.body.registros.length<1||req.body.registros.length>500)throw new HttpError(400,'Informe de 1 a 500 registros.');
  const raw=JSON.stringify(req.body.registros),checksum=hash(raw),origin='arquivo:'+checksum;
  const result=await transaction(async db=>{
    await db.execute('SELECT id FROM usuarios WHERE id=? FOR UPDATE',[userId]);
    const [receipt]=await db.execute('SELECT contagens FROM app_migracoes WHERE usuario_id=? AND origem=?',[userId,origin]);
    if(receipt.length)return {...(typeof receipt[0].contagens==='string'?JSON.parse(receipt[0].contagens):receipt[0].contagens),repetida:true};
    let preview;try{preview=schema.preview(req.body.registros,await context(db,userId));}catch(e){throw new HttpError(400,e.message);}
    const counts={importados:0,ignorados:0,rejeitados:0};
    for(const item of preview) {
      if(item.status==='inválido'){counts.rejeitados++;continue;}
      if(item.status==='duplicado'){counts.ignorados++;continue;}
      const r=item.row;
      await db.execute('INSERT INTO transacoes(usuario_id,conta_id,categoria_id,descricao,valor,tipo,data_transacao) VALUES(?,?,?,?,?,?,?)',[userId,item.conta_id,item.categoria_id,r.descricao,r.valor,r.tipo,r.data]);counts.importados++;
    }
    await db.execute('INSERT INTO app_migracoes(usuario_id,origem,checksum,contagens,original) VALUES(?,?,?,?,?)',[userId,origin,checksum,JSON.stringify(counts),raw]);
    return counts;
  });res.json(result);
}
