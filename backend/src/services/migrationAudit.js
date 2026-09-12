import { hash, parseLegacy } from './relational.js';
export async function auditMigration(db) {
  const [users]=await db.execute('SELECT e.usuario_id,CAST(e.dados AS CHAR) original,m.original snapshot,m.checksum,m.ativo,m.versao,m.versao_original FROM app_estado e LEFT JOIN app_estado_migracoes m ON m.usuario_id=e.usuario_id ORDER BY e.usuario_id');
  const report={usuarios_analisados:users.length,investimentos_encontrados:0,investimentos_migrados:0,metas_encontradas:0,metas_migradas:0,notas_encontradas:0,notas_migradas:0,divergencias:[]};
  // Consultas em lote, nunca uma consulta por registro.
  const tables={};
  for(const table of ['investimentos','aportes','metas','notas']) [tables[table]]=await db.execute(`SELECT * FROM ${table}`);
  for(const u of users) {
    const {data,rejected}=parseLegacy(u.snapshot||u.original), issues=[...rejected];
    if(!u.snapshot)issues.push('Sem recibo de migração');
    if(u.snapshot && (hash(u.snapshot)!==u.checksum||u.original!==u.snapshot))issues.push('Original ou checksum divergente');
    if(u.snapshot&&!u.ativo)issues.push('Migração não ativada');
    report.investimentos_encontrados+=data.investments.length;report.metas_encontradas+=data.goals.length;report.notas_encontradas+=data.notes?1:0;
    for(const [key,table,fields] of [['investments','investimentos',{name:'nome',balance:'saldo_atual',note:'observacao'}],['goals','metas',{name:'nome',target:'valor_meta',current:'valor_atual',deadline:'data_limite',action:'descricao'}]]) {
      for(const x of data[key]) {
        const row=tables[table].find(r=>r.usuario_id===u.usuario_id&&String(r.legado_id)===String(x.id));
        if(row)report[table==='investimentos'?'investimentos_migrados':'metas_migradas']++;
        if(!row||Object.entries(fields).some(([a,b])=>String(x[a]??'')!==String(row[b]??'')))issues.push(`${table}: conteúdo divergente (legado ${x.id})`);
        if(key==='investments'&&Number(x.contribution)>0) {
          const a=row&&tables.aportes.find(a=>a.usuario_id===u.usuario_id&&a.investimento_id===row.id&&a.legado===1);
          if(!a||Number(a.valor)!==Number(x.contribution)||a.tipo!=='planejado')issues.push(`aporte legado ${x.id}: divergente`);
        }
      }
    }
    if(data.notes) {
      const note=tables.notas.find(n=>n.usuario_id===u.usuario_id&&n.legado===1);
      if(note)report.notas_migradas++;
      if(!note||note.conteudo!==data.notes)issues.push('Nota divergente');
    }
    if(issues.length)report.divergencias.push({usuario:u.usuario_id,alterado_apos_migracao:u.versao!==u.versao_original,avisos:issues});
  }
  return report;
}
