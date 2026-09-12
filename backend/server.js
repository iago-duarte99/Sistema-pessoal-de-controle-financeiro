import { app } from './src/app.js';
import { config, validateConfig } from './src/config/env.js';
import { pool } from './src/config/database.js';
import { checkSchema } from './services-schema.js';

try {
  validateConfig();
  await checkSchema();
  const server=app.listen(config.port,config.host,()=>console.log(`Controle Financeiro: http://localhost:${config.port}`));
  server.on('error',error=>{console.error('Falha ao iniciar:',error.code);process.exitCode=1;pool.end();});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await pool.end();process.exit(0);}));
} catch(error) {
  console.error('Não foi possível iniciar:',error.code||error.message);
  console.error('Confira backend/.env e execute npm run check:db.');
  await pool.end();process.exitCode=1;
}
