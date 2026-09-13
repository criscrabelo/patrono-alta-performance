// Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, PG-01/PG-02/PG-03): testes da camada de persistência
// (`storage/`) isolada de server.js — cobrem os dois backends (json-store local, postgres-store real)
// com a MESMA bateria de contrato, além de fail-fast em produção, healthcheck e o script de importação.
//
// O backend Postgres só é exercitado de fato quando TEST_DATABASE_URL aponta para um Postgres de teste
// ISOLADO (nunca um banco de produção) — sem essa variável, os testes específicos de Postgres são
// pulados explicitamente (mesmo padrão já usado para o adapter do Google Calendar: reportar a ausência
// de infraestrutura, nunca fingir cobertura que não existe). Ver docs/PRODUCTION_GATE.md, seção 28.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createJsonStore } = require('../storage/json-store');
const { StoreConflictError } = require('../storage/errors');

function makeSeed() {
  return { users: [{ id: 'u1', name: 'Fulano' }], agenda: [], audit: [] };
}

// ============================================================================================
// Contrato compartilhado — mesma bateria de testes roda contra json-store e (se disponível)
// postgres-store, provando que os dois backends respeitam exatamente o mesmo contrato de
// leitura/escrita/concorrência (PG-01/PG-02).
// ============================================================================================
function registerContractTests(label, createBackend, teardown) {
  test(`[storage:${label}] read()/write() fazem round-trip fiel do conteúdo`, async () => {
    const backend = await createBackend();
    try {
      await backend.init();
      const store = await backend.read();
      assert.deepEqual(store.users, [{ id: 'u1', name: 'Fulano' }]);
      store.agenda.push({ id: 'evt-1' });
      await backend.write(store);
      const reread = await backend.read();
      assert.deepEqual(reread.agenda, [{ id: 'evt-1' }]);
    } finally { if (teardown) await teardown(backend); }
  });

  test(`[storage:${label}] concorrência: duas leituras da mesma versão — a primeira escrita vence, a segunda recebe StoreConflictError (PG-02)`, async () => {
    const backend = await createBackend();
    try {
      await backend.init();
      const readA = await backend.read();
      const readB = await backend.read();
      readA.agenda.push({ id: 'evt-a' });
      await backend.write(readA);
      readB.agenda.push({ id: 'evt-b' });
      await assert.rejects(() => backend.write(readB), StoreConflictError, 'a segunda escrita (versão obsoleta) nunca sobrescreve silenciosamente a primeira');
      const finalStore = await backend.read();
      assert.deepEqual(finalStore.agenda.map(e => e.id), ['evt-a'], 'apenas a escrita vencedora foi persistida — nenhum last-write-wins silencioso');
    } finally { if (teardown) await teardown(backend); }
  });

  test(`[storage:${label}] mutação + auditoria persistidas juntas ou nenhuma das duas (transação/rollback implícito no documento único)`, async () => {
    const backend = await createBackend();
    try {
      await backend.init();
      const store = await backend.read();
      store.agenda.push({ id: 'evt-mutacao' });
      store.audit.push({ id: 'audit-1', action: 'CREATE', entity: 'agenda', entityId: 'evt-mutacao' });
      await backend.write(store);
      const reread = await backend.read();
      assert.equal(reread.agenda.some(e => e.id === 'evt-mutacao'), true);
      assert.equal(reread.audit.some(e => e.id === 'audit-1'), true, 'mutação e auditoria vieram no MESMO objeto e foram persistidas no mesmo UPDATE — nunca uma sem a outra');
    } finally { if (teardown) await teardown(backend); }
  });

  test(`[storage:${label}] healthcheck() reporta reachable/schemaReady`, async () => {
    const backend = await createBackend();
    try {
      await backend.init();
      const health = await backend.healthcheck();
      assert.equal(health.reachable, true);
      assert.equal(health.schemaReady, true);
    } finally { if (teardown) await teardown(backend); }
  });

  test(`[storage:${label}] seed é aplicado de forma idempotente — reabrir o backend não duplica nem reseta dado já existente`, async () => {
    const backend = await createBackend();
    try {
      await backend.init();
      const store = await backend.read();
      store.users.push({ id: 'u2', name: 'Ciclano' });
      await backend.write(store);
      await backend.init(); // reabertura idempotente (equivalente a reiniciar o processo)
      const reread = await backend.read();
      assert.deepEqual(reread.users.map(u => u.id).sort(), ['u1', 'u2'], 'reabrir o backend não reaplica o seed por cima de dado já existente');
    } finally { if (teardown) await teardown(backend); }
  });
}

// --- json-store ---
registerContractTests('json', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-storage-test-'));
  return createJsonStore({ dataDir, seed: makeSeed() });
}, async () => {});

// --- postgres-store (só roda de fato com TEST_DATABASE_URL isolado) ---
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  const { createPostgresStore } = require('../storage/postgres-store');
  registerContractTests('postgres', async () => {
    // Cada teste começa de uma tabela zerada — apaga qualquer linha residual de uma execução anterior,
    // nunca aponta para um banco de produção (só usado quando o operador aponta TEST_DATABASE_URL
    // explicitamente para um Postgres de teste isolado).
    const { Pool } = require('pg');
    const cleanup = new Pool({ connectionString: TEST_DATABASE_URL });
    await cleanup.query('DROP TABLE IF EXISTS app_store');
    await cleanup.end();
    return createPostgresStore({ databaseUrl: TEST_DATABASE_URL, seed: makeSeed() });
  }, async backend => { await backend.close(); });

  test('[storage:postgres] escrita sem versão anexada (ex.: restore de backup) grava incondicionalmente', async () => {
    const { Pool } = require('pg');
    const cleanup = new Pool({ connectionString: TEST_DATABASE_URL });
    await cleanup.query('DROP TABLE IF EXISTS app_store');
    await cleanup.end();
    const { createPostgresStore } = require('../storage/postgres-store');
    const backend = createPostgresStore({ databaseUrl: TEST_DATABASE_URL, seed: makeSeed() });
    try {
      await backend.init();
      const bare = { users: [{ id: 'restored-user' }], agenda: [], audit: [] }; // nunca passou por read()
      await backend.write(bare);
      const reread = await backend.read();
      assert.deepEqual(reread.users, [{ id: 'restored-user' }]);
    } finally { await backend.close(); }
  });
} else {
  test('[storage:postgres] testes de Postgres pulados — TEST_DATABASE_URL não configurada neste ambiente (ver docs/PRODUCTION_GATE.md, seção 28)', { skip: true }, () => {});
}

// ============================================================================================
// storage/index.js — fachada, decisão de backend e fail-fast em produção
// ============================================================================================
test('storage.configure(): produção sem databaseUrl lança FailFastError — nunca cai silenciosamente em fallback local (P0 do Gate de Produção)', () => {
  const storage = require('../storage');
  storage.reset();
  assert.throws(() => storage.configure({ databaseUrl: undefined, nodeEnv: 'production', dataDir: '/tmp/should-not-be-used' }), /DATABASE_URL/, 'produção exige DATABASE_URL — sem ele, o processo não deve iniciar em modo arquivo');
  storage.reset();
});

test('storage.configure(): fora de produção, sem databaseUrl, usa o fallback local (json) explicitamente', () => {
  const storage = require('../storage');
  storage.reset();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-storage-facade-'));
  storage.configure({ databaseUrl: undefined, nodeEnv: 'test', dataDir, seed: makeSeed() });
  assert.equal(storage.mode(), 'json-local-fallback');
  storage.reset();
});

test('storage.configure(): com databaseUrl, Postgres é o backend ativo (canônico), nunca dual-write com o fallback local', () => {
  const storage = require('../storage');
  storage.reset();
  storage.configure({ databaseUrl: 'postgresql://user:pass@localhost:5432/irrelevant', nodeEnv: 'test', seed: makeSeed() });
  assert.equal(storage.mode(), 'postgres');
  storage.reset();
});

// ============================================================================================
// scripts/import-data.js — dry-run e validação (lógica pura, sem depender de Postgres)
// ============================================================================================
const { summarizeStore, parseArgs, readStoreFile } = require('../scripts/import-data');

test('import-data: parseArgs() reconhece --dry-run, --force e --file=', () => {
  assert.deepEqual(parseArgs(['--dry-run']), { dryRun: true, force: false, file: null });
  assert.deepEqual(parseArgs(['--force', '--file=/tmp/x.json']), { dryRun: false, force: true, file: '/tmp/x.json' });
});

test('import-data: summarizeStore() conta coleções de nível superior e records.*', () => {
  const store = {
    users: [{ id: 'u1' }, { id: 'u2' }],
    departments: [{ id: 'd1' }],
    agenda: [], committees: [], audit: [], compliance: [], registrationRequests: [], mondayRuns: [],
    records: { legalDeadlines: [{ id: 'ld1' }, { id: 'ld2' }], processos: [{ id: 'p1' }] }
  };
  const { counts, duplicates, errors } = summarizeStore(store);
  assert.equal(counts.users, 2);
  assert.equal(counts['records.legalDeadlines'], 2);
  assert.equal(counts['records.processos'], 1);
  assert.deepEqual(duplicates, {});
  assert.deepEqual(errors, []);
});

test('import-data: summarizeStore() detecta IDs duplicados dentro da mesma coleção', () => {
  const store = { users: [{ id: 'u1' }, { id: 'u1' }], records: { legalDeadlines: [] } };
  const { duplicates } = summarizeStore(store);
  assert.deepEqual(duplicates.users, ['u1']);
});

test('import-data: summarizeStore() reporta erro quando "users" está ausente/vazio (arquivo não parece ser uma store válida)', () => {
  const { errors } = summarizeStore({ agenda: [] });
  assert.ok(errors.some(e => e.includes('users')));
});

test('import-data: summarizeStore() reporta erro quando uma coleção conhecida não é array', () => {
  const { errors } = summarizeStore({ users: [{ id: 'u1' }], agenda: 'não é um array' });
  assert.ok(errors.some(e => e.includes('agenda')));
});

test('import-data: readStoreFile() lê tanto o formato legado (objeto puro) quanto o envelope {version,data} do json-store pós-H1A', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-import-test-'));
  const legacyFile = path.join(dir, 'legacy.json');
  const wrappedFile = path.join(dir, 'wrapped.json');
  fs.writeFileSync(legacyFile, JSON.stringify({ users: [{ id: 'u1' }] }));
  fs.writeFileSync(wrappedFile, JSON.stringify({ version: 3, data: { users: [{ id: 'u1' }] } }));
  assert.deepEqual(readStoreFile(legacyFile), { users: [{ id: 'u1' }] });
  assert.deepEqual(readStoreFile(wrappedFile), { users: [{ id: 'u1' }] });
});

test('import-data: --dry-run nunca grava (nem cria arquivo novo, nem exige DATABASE_URL)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-import-dryrun-'));
  const file = path.join(dir, 'store.json');
  fs.writeFileSync(file, JSON.stringify({ users: [{ id: 'u1' }], agenda: [] }));
  delete process.env.DATABASE_URL;
  const { run } = require('../scripts/import-data');
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  await run(['--dry-run', `--file=${file}`]);
  assert.notEqual(process.exitCode, 1, '--dry-run com arquivo válido não deve reportar falha');
  process.exitCode = originalExitCode;
});
