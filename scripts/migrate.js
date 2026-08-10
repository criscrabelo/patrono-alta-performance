const fs = require('node:fs');
const path = require('node:path');
const { query, configured } = require('../database');
if (!configured()) { console.error('Defina DATABASE_URL antes de executar migrations.'); process.exit(1); }
(async()=>{ const sql=fs.readFileSync(path.join(__dirname,'..','migrations','001_foundation.sql'),'utf8'); await query(sql); console.log('Migration 001 aplicada.'); })().catch(err=>{ console.error(err.message); process.exit(1); });
