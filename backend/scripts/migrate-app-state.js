import { pool, transaction } from '../src/config/database.js';
import { available, migrateUser } from '../src/services/relational.js';
// Nenhum DDL. Execução manual explícita; sem --apply apenas instrui.
try {
  if(!process.argv.includes('--apply')) {
    console.log('Nenhuma alteração executada. Faça backup, aplique SQL 004–007 manualmente e use npm run migrate:state -- --apply.');
  } else {
    if(!await available(pool))throw new Error('Aplique e confira SQL 004–007 antes da migração.');
    const [users]=await pool.execute('SELECT e.usuario_id FROM app_estado e JOIN usuarios u ON u.id=e.usuario_id ORDER BY e.usuario_id');
    const results=[];
    for(const user of users) results.push({usuario:user.usuario_id,...await transaction(db=>migrateUser(db,user.usuario_id))});
    console.log(JSON.stringify(results,null,2));
  }
} catch(error) {console.error('Migração interrompida:',error.code||error.message);process.exitCode=1;}
finally {await pool.end();}
