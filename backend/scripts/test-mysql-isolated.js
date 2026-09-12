import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';

// Inicializa SOMENTE uma instância temporária própria; não toca o serviço 3306.
const binary=process.env.MYSQLD_PATH||'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqld.exe';
const root=resolve('tests/.artifacts/mysql-'+Date.now());
const data=resolve(root,'data'),port=33307;
await mkdir(root,{recursive:true});
const waitExit=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
const init=spawn(binary,['--no-defaults','--initialize-insecure','--datadir='+data,'--log-error='+resolve(root,'initialize.log')],{windowsHide:true,stdio:'ignore'});
if(await waitExit(init)!==0)throw new Error('Inicialização do MySQL isolado falhou; veja '+root);
const server=spawn(binary,['--no-defaults','--datadir='+data,'--port='+port,'--bind-address=127.0.0.1','--mysqlx=0','--log-error='+resolve(root,'server.log')],{windowsHide:true,stdio:'ignore'});
let admin;
try{
  for(let attempt=0;attempt<60;attempt++){
    try{admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root',connectTimeout:1000});break;}catch{await new Promise(r=>setTimeout(r,500));}
  }
  if(!admin)throw new Error('MySQL isolado não iniciou; veja '+root);
  await admin.query('CREATE DATABASE controle_financeiro_test CHARACTER SET utf8mb4');
  await admin.changeUser({database:'controle_financeiro_test'});
  for(const file of ['sql/schema_referencia.sql','sql/001_tabelas_auxiliares.sql','sql/003_password_reset.sql','sql/004_investimentos.sql','sql/005_metas.sql','sql/006_notas.sql','sql/007_migracao_app_estado.sql']){
    const script=(await readFile(file,'utf8')).replace(/^\s*--.*$/gm,'').replace(/USE controle_financeiro;/,'');
    for(const sql of script.split(';').map(x=>x.trim()).filter(Boolean))await admin.query(sql);
    if(/00[4-7]_/.test(file))for(const sql of script.split(';').map(x=>x.trim()).filter(Boolean))await admin.query(sql);
  }
  const password=randomBytes(24).toString('hex');
  await admin.query("CREATE USER 'finance_app'@'localhost' IDENTIFIED BY ?",[password]);
  await admin.query("GRANT SELECT,INSERT,UPDATE,DELETE ON controle_financeiro_test.* TO 'finance_app'@'localhost'");
  const env={...process.env,DB_HOST:'127.0.0.1',DB_PORT:String(port),DB_USER:'finance_app',DB_PASSWORD:password,DB_NAME:'controle_financeiro_test',JWT_SECRET:randomBytes(48).toString('hex'),ADMIN_EMAIL:'admin-test@example.test',MYSQL_INTEGRATION:'1',NODE_ENV:'test'};
  const tests=spawn(process.execPath,['--test','--test-concurrency=1','tests/integration.mysql.js','tests/password-reset.mysql.js','tests/relational.mysql.js'],{env,windowsHide:true,stdio:'inherit'});
  process.exitCode=await waitExit(tests);
  if(process.argv.includes('--preview')) {
    const preview=spawn(process.execPath,['tests/preview.js'],{env,windowsHide:true,stdio:'inherit'});
    await waitExit(preview);
  }
}finally{
  if(admin){try{await admin.query('SHUTDOWN');}catch{}await admin.end().catch(()=>{});}
  if(server.exitCode===null){const timer=setTimeout(()=>server.kill(),5000);await waitExit(server);clearTimeout(timer);}
  console.log('Arquivos da instância isolada (ignorados pelo Git): '+root);
}
