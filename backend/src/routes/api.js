import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, publicUser } from '../middleware/auth.js';
import * as users from '../controllers/usuariosController.js';
import { controller, saldo, resumo } from '../controllers/financeController.js';
import * as state from '../controllers/estadoController.js';
import * as migration from '../controllers/migracaoController.js';
import { pool } from '../config/database.js';
import { passwordResetController } from '../controllers/passwordResetController.js';

import * as fileImport from '../controllers/importController.js';
import { relationalController } from '../controllers/relationalController.js';

export const api=Router();
const loginLimit=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas tentativas. Aguarde 15 minutos.'}});
api.get('/health',async(req,res)=>{await pool.execute('SELECT 1');res.json({status:'ok',database:'ok'});});
api.post('/auth/register',loginLimit,users.register);
api.post('/auth/login',loginLimit,users.login);
const recovery = passwordResetController();
const forgotLimit=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas tentativas. Aguarde 15 minutos.'}});
const resetLimit=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas tentativas. Aguarde 15 minutos.'}});
api.post('/auth/forgot-password',forgotLimit,recovery.forgot);
api.post('/auth/validate-reset-token',resetLimit,recovery.validate);
api.post('/auth/reset-password',resetLimit,recovery.reset);
api.use(authenticate);
api.get('/auth/me',(req,res)=>res.json(publicUser(req.user)));
api.post('/auth/logout',async(req,res)=>{
  await pool.execute("INSERT INTO app_perfis(usuario_id,papel,versao_token) VALUES(?,'user',1) ON DUPLICATE KEY UPDATE versao_token=versao_token+1",[req.user.id]);
  res.status(204).end();
});
api.get('/usuarios',users.list);
api.post('/usuarios',users.post);
api.get('/usuarios/:id',users.get);
api.put('/usuarios/:id',users.put);
api.delete('/usuarios/:id',users.remove);
api.get('/usuarios/:usuarioId/resumo',resumo);
api.get('/contas/:id/saldo',saldo);
for(const table of ['contas','categorias','transacoes']){
  const c=controller(table);
  api.get('/'+table,c.list);
  api.get('/'+table+'/:id',c.get);
  api.post('/'+table,c.write);
  api.put('/'+table+'/:id',c.write);
  api.delete('/'+table+'/:id',c.remove);
  api.get('/usuarios/:usuarioId/'+table,c.list);
}
for(const table of ['investimentos','metas','notas']) {
  const c=relationalController(table);
  api.get('/'+table,c.list); api.get('/'+table+'/:id',c.get);
  api.post('/'+table,c.write); api.put('/'+table+'/:id',c.write); api.delete('/'+table+'/:id',c.remove);
}
const contributions=relationalController('aportes');
api.get('/investimentos/:id/aportes',contributions.list);
api.post('/investimentos/:id/aportes',contributions.write);
api.put('/aportes/:id',contributions.write); api.delete('/aportes/:id',contributions.remove);
api.get('/importacao/contexto',fileImport.getContext);
api.post('/importacao',fileImport.commit);
api.get('/estado',state.get);
api.put('/estado',state.put);
api.get('/planejamentos',state.listPlans);
api.post('/planejamentos',state.writePlan);
api.put('/planejamentos/:id',state.writePlan);
api.delete('/planejamentos/:id',state.deletePlan);
api.get('/migracoes/localstorage',migration.status);
api.post('/migracoes/localstorage',migration.migrate);
