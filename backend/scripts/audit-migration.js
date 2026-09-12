import { pool, transaction } from '../src/config/database.js';
import { auditMigration } from '../src/services/migrationAudit.js';
try {
  const report=await transaction(auditMigration);
  console.log(JSON.stringify(report,null,2));
  if(report.divergencias.length)process.exitCode=2;
}catch(error){console.error('Auditoria indisponível:',error.code||error.message);process.exitCode=1;}
finally{await pool.end();}
