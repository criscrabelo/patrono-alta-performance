// Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, seções 18/19): importação explícita e separada de
// data/store.json (ou um arquivo apontado por --file) para dentro de PostgreSQL (tabela `app_store`,
// ver migrations/003_app_store.sql). NUNCA roda automaticamente (não faz parte do boot do servidor,
// nem de nenhuma rota HTTP) e NUNCA apaga o arquivo JSON de origem — mesmo depois de uma importação
// real bem-sucedida, o JSON permanece intacto no disco.
//
// Uso:
//   node scripts/import-data.js --dry-run [--file=data/store.json]
//   DATABASE_URL=... node scripts/import-data.js [--file=data/store.json] [--force]
//
// --dry-run: lê e valida o arquivo, reporta contagem por coleção e possíveis duplicados/erros, SEM
// gravar nada (nem em Postgres, nem em qualquer outro lugar).
// --force: only necessário quando já existir uma linha em `app_store` — sem --force, a importação real
// recusa sobrescrever dado já existente no banco (nunca um "silenciosamente por cima").
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { dryRun: false, force: false, file: null };
  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
    else if (raw === '--force') args.force = true;
    else if (raw.startsWith('--file=')) args.file = raw.slice('--file='.length);
  }
  return args;
}

// Mesma normalização de envelope usada por storage/json-store.js: um arquivo anterior ao H1A é o
// objeto puro da store (sem o wrapper {version,data}); um arquivo já gravado pelo backend json-store
// pós-H1A já vem embrulhado. Duplicar aqui (em vez de importar de storage/json-store.js) mantém este
// script utilizável de forma independente, sem acoplar ao runtime do servidor.
function readStoreFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const isLegacyShape = !parsed || typeof parsed !== 'object' || !('data' in parsed) || !('version' in parsed);
  return isLegacyShape ? parsed : parsed.data;
}

// Coleções conhecidas no nível superior da store (ver server.js, `seed` + backfills de
// ensureStore()/ensureProjectStore()) — usadas só para o relatório de contagem, nunca para validar
// regra de negócio (essa validação já existe no motor de entidades de server.js e não é duplicada aqui).
const TOP_LEVEL_ARRAY_COLLECTIONS = [
  'users', 'departments', 'financials', 'agenda', 'committees', 'audit', 'compliance',
  'registrationRequests', 'mondayRuns', 'dashboardPreferences', 'budgetImports',
  'projects', 'strategicObjectives', 'projectWorkstreams', 'projectActions', 'projectMilestones',
  'projectRisks', 'projectIndicators', 'projectTargets', 'recoveryCases', 'recoveryNegotiations',
  'legalNegotiationHistory', 'projectApprovalRules', 'projectManagementItems', 'projectAssignments',
  'projectRecoverySettings'
];

function summarizeStore(store) {
  const counts = {};
  const duplicates = {};
  const errors = [];
  for (const key of TOP_LEVEL_ARRAY_COLLECTIONS) {
    const value = store[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) { errors.push(`"${key}" deveria ser um array, encontrado ${typeof value}`); continue; }
    counts[key] = value.length;
    const seen = new Set(); const dupes = new Set();
    for (const item of value) { if (item && typeof item === 'object' && item.id) { if (seen.has(item.id)) dupes.add(item.id); seen.add(item.id); } }
    if (dupes.size) duplicates[key] = [...dupes];
  }
  if (store.records && typeof store.records === 'object') {
    for (const [type, rows] of Object.entries(store.records)) {
      const key = `records.${type}`;
      if (!Array.isArray(rows)) { errors.push(`"${key}" deveria ser um array, encontrado ${typeof rows}`); continue; }
      counts[key] = rows.length;
      const seen = new Set(); const dupes = new Set();
      for (const item of rows) { if (item && typeof item === 'object' && item.id) { if (seen.has(item.id)) dupes.add(item.id); seen.add(item.id); } }
      if (dupes.size) duplicates[key] = [...dupes];
    }
  }
  if (!store.users || !Array.isArray(store.users) || !store.users.length) errors.push('"users" ausente ou vazio — arquivo não parece ser uma store válida do Patrono');
  return { counts, duplicates, errors };
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const dataDir = process.env.COEVO_DATA_DIR ? path.resolve(process.env.COEVO_DATA_DIR) : path.join(__dirname, '..', 'data');
  const filePath = args.file ? path.resolve(args.file) : path.join(dataDir, 'store.json');

  if (!fs.existsSync(filePath)) { console.error(`Arquivo não encontrado: ${filePath}`); process.exitCode = 1; return; }
  let store;
  try { store = readStoreFile(filePath); }
  catch (error) { console.error(`Não foi possível ler/parsear ${filePath}: ${error.message}`); process.exitCode = 1; return; }

  const { counts, duplicates, errors } = summarizeStore(store);
  console.log(`Arquivo: ${filePath}`);
  console.log('Contagem por coleção:');
  for (const [key, count] of Object.entries(counts)) console.log(`  ${key}: ${count}`);
  if (Object.keys(duplicates).length) {
    console.log('IDs duplicados encontrados (dentro da mesma coleção):');
    for (const [key, ids] of Object.entries(duplicates)) console.log(`  ${key}: ${ids.join(', ')}`);
  }
  if (errors.length) {
    console.log('Erros de validação:');
    for (const error of errors) console.log(`  - ${error}`);
  }

  if (args.dryRun) {
    console.log('\n--dry-run: nenhuma gravação foi realizada.');
    process.exitCode = errors.length ? 1 : 0;
    return;
  }

  if (errors.length) { console.error('\nImportação abortada: corrija os erros de validação acima antes de importar de verdade.'); process.exitCode = 1; return; }

  const { configured, pool } = require('../database');
  if (!configured()) { console.error('DATABASE_URL não configurada — importação real exige um destino PostgreSQL.'); process.exitCode = 1; return; }

  const client = pool();
  try {
    const migrated = await client.query(
      "SELECT 1 FROM schema_migrations WHERE version = '003_app_store'"
    ).catch(() => ({ rows: [] }));
    if (!migrated.rows.length) {
      console.error('\nImportação abortada: schema do PostgreSQL não está migrado (migration "003_app_store" ausente). Rode "npm run migrate" antes de importar.');
      process.exitCode = 1;
      return;
    }
    const { rows } = await client.query('SELECT version FROM app_store WHERE id = 1');
    if (rows.length && !args.force) {
      console.error(`\nImportação abortada: já existe uma store em PostgreSQL (version=${rows[0].version}). Use --force para sobrescrever explicitamente — o arquivo JSON de origem nunca é apagado por este script, então nada é perdido ao repetir a operação com cautela.`);
      process.exitCode = 1;
      return;
    }
    await client.query('BEGIN');
    try {
      if (rows.length) await client.query('UPDATE app_store SET data = $1, version = version + 1, updated_at = now() WHERE id = 1', [JSON.stringify(store)]);
      else await client.query('INSERT INTO app_store (id, data, version) VALUES (1, $1, 1)', [JSON.stringify(store)]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log('\nImportação concluída com sucesso. O arquivo JSON de origem NÃO foi removido.');
  } catch (error) {
    console.error(`\nFalha na importação: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) run();
module.exports = { run, summarizeStore, readStoreFile, parseArgs };
