// Somente servidor temporário do runner de testes. Nunca usa o banco da aplicação.
import { app } from '../src/app.js';
import { pool } from '../src/config/database.js';
import { config } from '../src/config/env.js';
if(process.env.MYSQL_INTEGRATION!=='1'||!process.env.DB_NAME?.endsWith('_test')||process.env.DB_PORT!=='33307')throw new Error('Preview exige instância isolada.');
config.origins.push('http://127.0.0.1:33308');
const server=app.listen(33308,'127.0.0.1',()=>console.log('Preview isolado disponível em http://127.0.0.1:33308'));
const stop=()=>server.close(async()=>{await pool.end();process.exit();});
app.post('/__stop_preview',(req,res)=>{res.end('ok');stop();});
setTimeout(stop,15*60*1000).unref();
