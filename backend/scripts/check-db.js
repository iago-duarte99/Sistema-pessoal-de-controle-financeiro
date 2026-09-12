import { pool } from '../src/config/database.js';
import { checkSchema } from '../services-schema.js';
try { await checkSchema();console.log('Conexão MySQL e estrutura verificadas.'); }
catch(error){console.error('Verificação falhou:',error.code||error.message);process.exitCode=1;}
finally{await pool.end();}
