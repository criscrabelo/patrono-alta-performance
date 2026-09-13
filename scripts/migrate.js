// Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, PG-03): runner de migrations determinístico —
// aplica migrations/*.sql em ordem, registra cada uma em `schema_migrations` (criada aqui se ainda não
// existir), nunca reaplica uma migration já registrada, e nunca aplica automaticamente em produção sem
// intervenção explícita (é sempre `npm run migrate`, nunca parte do boot do servidor).
const fs = require('node:fs');
const path = require('node:path');
const { pool, configured } = require('../database');

async function run() {
  if (!configured()) { console.error('Defina DATABASE_URL antes de executar migrations.'); process.exitCode = 1; return; }
  const client = pool();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows: applied } = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(applied.map(row => row.version));
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (appliedSet.has(version)) { console.log(`${version}: já aplicada, pulando.`); continue; }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
      console.log(`${version}: aplicada.`);
    }
    console.log('Migrations concluídas.');
  } catch (error) {
    console.error('Falha ao aplicar migrations:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) run();
module.exports = { run };
