// Integração completa do workspace Jurídico do Monday (docs/DEMO_DEPLOY.md): testes de integridade do
// catálogo único (legal-source-catalog.js) e de generalização da sincronização (runMondaySync(),
// extraída de POST /api/monday/sync para ser reutilizada também por scripts/sync-monday.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { LEGAL_SOURCE_CATALOG, enabledMondaySources } = require('../legal-source-catalog');

test('[Catálogo] toda entrada tem key/mondayBoardId únicos; sourceType/readOnly sempre "monday"/true', () => {
  const keys = LEGAL_SOURCE_CATALOG.map(e => e.key);
  const ids = LEGAL_SOURCE_CATALOG.map(e => e.mondayBoardId);
  assert.equal(new Set(keys).size, keys.length, 'nenhuma key do catálogo pode se repetir');
  assert.equal(new Set(ids).size, ids.length, 'nenhum board id do catálogo pode se repetir');
  for (const entry of LEGAL_SOURCE_CATALOG) {
    assert.equal(entry.sourceType, 'monday');
    assert.equal(entry.readOnly, true, `entrada "${entry.key}" precisa continuar somente leitura`);
  }
});

test('[Catálogo] enabledMondaySources() exclui a duplicata explicitamente desabilitada', () => {
  const enabled = enabledMondaySources();
  assert.ok(enabled.every(entry => entry.enabled));
  assert.ok(!enabled.some(entry => entry.key === 'entregaChavesCarpeDienDuplicata'), 'duplicata de Entrega de Chaves Carpe Diem deve permanecer desabilitada nesta rodada');
  assert.ok(enabled.some(entry => entry.key === 'processos' && entry.mondayBoardId === '5959705266'));
});

test('[server.js] MONDAY_BOARDS é derivado do catálogo (uma única fonte de verdade, sem lista paralela)', () => {
  const { MONDAY_BOARDS, LEGAL_MODULES } = require('../server');
  const enabled = enabledMondaySources();
  assert.equal(Object.keys(MONDAY_BOARDS).length, enabled.length);
  for (const entry of enabled) {
    assert.ok(MONDAY_BOARDS[entry.key], `MONDAY_BOARDS deve conter a key "${entry.key}"`);
    assert.equal(MONDAY_BOARDS[entry.key].name, entry.label);
  }
  assert.equal(LEGAL_MODULES.size, enabled.length + 1, 'LEGAL_MODULES = boards habilitados + honorariosJudiciais (derivado, não um board próprio)');
});

// --- runMondaySync(): mock de fetch global para simular o Monday sem rede real ---
function mondayItemsPage(items, cursor = null) {
  return { data: { boards: [{ columns: [{ id: 'status', title: 'Status' }], items_page: { cursor, items } }] } };
}

test('[Sync] runMondaySync(): pagina até o fim, faz upsert por externalId, conta created/updated/unchanged, e nunca envia mutation ao Monday', async (t) => {
  const { runMondaySync } = require('../server');
  process.env.MONDAY_TOKEN = 'token-de-teste';
  t.after(() => { delete process.env.MONDAY_TOKEN; });

  const requestBodies = [];
  let call = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    requestBodies.push(JSON.parse(options.body));
    call++;
    // Primeira chamada (cursor=null): devolve página 1 com cursor 'page2'; segunda chamada: página final.
    if (call === 1) return { ok: true, json: async () => mondayItemsPage([{ id: '1', name: 'Item 1', created_at: '2026-01-01', group: { title: 'G1' }, column_values: [{ id: 'status', text: 'Ativo' }] }], 'page2') };
    return { ok: true, json: async () => mondayItemsPage([{ id: '2', name: 'Item 2', created_at: '2026-01-02', group: { title: 'G1' }, column_values: [{ id: 'status', text: 'Ativo' }] }], null) };
  };
  t.after(() => { global.fetch = originalFetch; });

  const store = { records: {} };
  const run = await runMondaySync(store, 'Teste', ['pesquisas']);

  assert.equal(run.status, 'completed');
  assert.equal(run.modules[0].read, 2, 'as duas páginas do cursor devem ser somadas (paginação até o fim)');
  assert.equal(run.modules[0].created, 2);
  assert.equal(store.records.pesquisas.length, 2);
  assert.ok(requestBodies.every(body => !/mutation/i.test(body.query)), 'nenhuma requisição ao Monday pode conter uma operação GraphQL "mutation"');

  // Segunda execução com os MESMOS dados: nada de novo é criado/atualizado (dedup por externalId + detecção de mudança real).
  call = 0;
  const run2 = await runMondaySync(store, 'Teste', ['pesquisas']);
  assert.equal(run2.modules[0].created, 0, 'não deve duplicar registros já sincronizados');
  assert.equal(run2.modules[0].updated, 0, 'conteúdo idêntico não deve contar como atualizado');
  assert.equal(run2.modules[0].unchanged, 2);
  assert.equal(store.records.pesquisas.length, 2, 'sincronizar de novo nunca duplica registros existentes');
});

test('[Sync] runMondaySync(): falha em um board não interrompe os demais, e nunca cria LegalDeadline automaticamente', async (t) => {
  const { runMondaySync } = require('../server');
  process.env.MONDAY_TOKEN = 'token-de-teste';
  t.after(() => { delete process.env.MONDAY_TOKEN; });

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.variables.boardId === '9535379620') return { ok: false, status: 500, json: async () => ({ errors: [{ message: 'Board temporariamente indisponível' }] }) };
    return { ok: true, json: async () => mondayItemsPage([{ id: '1', name: 'Item OK', created_at: '2026-01-01', group: { title: 'G1' }, column_values: [] }], null) };
  };
  t.after(() => { global.fetch = originalFetch; });

  const store = { records: {} };
  const run = await runMondaySync(store, 'Teste', ['pesquisas', 'acessos']);

  assert.equal(run.status, 'partial');
  const pesquisas = run.modules.find(m => m.module === 'pesquisas');
  const acessos = run.modules.find(m => m.module === 'acessos');
  assert.equal(pesquisas.status, 'error');
  assert.equal(acessos.status, 'ok', 'falha em um board não pode impedir a sincronização dos demais');
  assert.equal(acessos.created, 1);
  assert.equal(store.records.legalDeadlines?.length || 0, 0, 'sincronização Monday nunca cria LegalDeadline automaticamente (D1)');
});

test('[Sync] runMondaySync(): sem MONDAY_TOKEN, cada board falha individualmente (nenhum dado fictício é gravado)', async (t) => {
  const { runMondaySync } = require('../server');
  delete process.env.MONDAY_TOKEN;

  const store = { records: {} };
  const run = await runMondaySync(store, 'Teste', ['pesquisas']);

  assert.equal(run.status, 'partial');
  assert.equal(run.modules[0].status, 'error');
  assert.match(run.modules[0].error, /MONDAY_TOKEN/);
  assert.equal((store.records.pesquisas || []).length, 0);
});

test('[Read-only] nenhuma operação GraphQL "mutation" existe no código-fonte de integração com o Monday', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../server'), 'utf8');
  const mondaySection = source.slice(source.indexOf('async function mondayQuery'), source.indexOf('async function runMondaySync') + 1);
  assert.ok(!/mutation\s*[({]/i.test(mondaySection), 'o caminho de integração com o Monday não pode conter nenhuma operação GraphQL "mutation"');
});

// --- P0 (branch demo): correção do crash de conexão observado no sync Monday/Postgres ---

test('[P0] pool.on("error") é registrado no pool de PostgreSQL (evita uncaughtException/crash do processo)', () => {
  const { createPostgresStore } = require('../storage/postgres-store');
  const store = createPostgresStore({ databaseUrl: 'postgres://usuario:senha@host-inexistente:5432/db', seed: {} });
  const pool = store.getPool();
  assert.ok(pool.listenerCount('error') >= 1, 'o pool precisa ter pelo menos um listener de "error" registrado');
  // Emitir um erro de conexão idle sintético (o que o driver `pg` faz quando um client ocioso perde a
  // conexão) não deve derrubar o processo de teste — se não houvesse listener, isto seria uma
  // uncaughtException e o processo do test runner cairia neste ponto.
  assert.doesNotThrow(() => pool.emit('error', new Error('Connection terminated unexpectedly')));
  return store.close();
});

test('[P0] database.js: pool() também registra listener de "error" (scripts administrativos)', () => {
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://usuario:senha@host-inexistente:5432/db';
  try {
    delete require.cache[require.resolve('../database')];
    const database = require('../database');
    const pool = database.pool();
    assert.ok(pool.listenerCount('error') >= 1);
    assert.doesNotThrow(() => pool.emit('error', new Error('Connection terminated unexpectedly')));
    return pool.end();
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});

test('[P0] withTransientRetry(): erro transitório de conexão tenta de novo até um limite, com backoff', async () => {
  const { withTransientRetry, isTransientDbError } = require('../storage/retry');
  assert.ok(isTransientDbError(new Error('the database system is not yet accepting connections')));
  assert.ok(isTransientDbError(new Error('Connection terminated unexpectedly')));
  assert.ok(!isTransientDbError(new Error('violação de restrição única')), 'erro de dado/negócio não deve ser tratado como transitório');

  let attempts = 0;
  const retries = [];
  const result = await withTransientRetry(async () => {
    attempts++;
    if (attempts < 3) throw new Error('the database system is not yet accepting connections');
    return 'ok';
  }, { maxAttempts: 5, baseDelayMs: 1, onRetry: (info) => retries.push(info) });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3, 'deve tentar de novo até dar certo, sem exceder o necessário');
  assert.equal(retries.length, 2);
});

test('[P0] withTransientRetry(): erro persistente (nunca transitório de verdade) é reportado após o limite de tentativas, nunca em loop infinito', async () => {
  const { withTransientRetry } = require('../storage/retry');
  let attempts = 0;
  await assert.rejects(
    withTransientRetry(async () => { attempts++; throw new Error('Connection terminated unexpectedly'); }, { maxAttempts: 3, baseDelayMs: 1 }),
    /Connection terminated unexpectedly/
  );
  assert.equal(attempts, 3, 'nunca deve exceder maxAttempts');
});

test('[P0] runMondaySync(): falha de PERSISTÊNCIA (não de leitura do Monday) em um board é reportada com stage "persist" e não interrompe os demais boards', async (t) => {
  const { runMondaySync } = require('../server');
  process.env.MONDAY_TOKEN = 'token-de-teste';
  t.after(() => { delete process.env.MONDAY_TOKEN; });

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => mondayItemsPage([{ id: 'x', name: 'Item', created_at: '2026-01-01', group: { title: 'G' }, column_values: [] }], null) });
  t.after(() => { global.fetch = originalFetch; });

  const store = { records: {} };
  const persisted = [];
  const run = await runMondaySync(store, 'Teste', ['pesquisas', 'acessos'], {
    persistBoard: async ({ moduleName }) => {
      if (moduleName === 'pesquisas') throw new Error('erro de persistência definitivo, não transitório');
      persisted.push(moduleName);
    }
  });

  assert.equal(run.status, 'partial');
  const pesquisas = run.modules.find(m => m.module === 'pesquisas');
  const acessos = run.modules.find(m => m.module === 'acessos');
  assert.equal(pesquisas.status, 'error');
  assert.equal(pesquisas.stage, 'persist', 'a falha foi ao persistir, não ao ler do Monday — o estágio precisa refletir isso');
  assert.match(pesquisas.error, /Falha ao persistir/);
  assert.equal(acessos.status, 'ok', 'falha ao persistir um board não pode impedir os demais');
  assert.deepEqual(persisted, ['acessos']);
  // O item de 'pesquisas' continua em memória (não perdido) mesmo com a persistência falha — será levado
  // "de carona" na próxima gravação bem-sucedida, nunca descartado silenciosamente.
  assert.equal(store.records.pesquisas.length, 1);
});

test('[P0] runMondaySync(): persistBoard com falha TRANSITÓRIA tenta de novo e não duplica registros (dedup preservado após retry)', async (t) => {
  const { runMondaySync } = require('../server');
  process.env.MONDAY_TOKEN = 'token-de-teste';
  t.after(() => { delete process.env.MONDAY_TOKEN; });

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => mondayItemsPage([{ id: 'x', name: 'Item', created_at: '2026-01-01', group: { title: 'G' }, column_values: [] }], null) });
  t.after(() => { global.fetch = originalFetch; });

  const store = { records: {} };
  let persistCalls = 0;
  const run = await runMondaySync(store, 'Teste', ['pesquisas'], {
    persistBoard: async () => {
      persistCalls++;
      if (persistCalls === 1) throw new Error('the database system is not yet accepting connections');
    }
  });

  assert.equal(run.status, 'completed');
  assert.equal(persistCalls, 2, 'deve tentar de novo exatamente uma vez após a falha transitória');
  assert.equal(run.modules[0].status, 'ok');
  assert.equal(store.records.pesquisas.length, 1, 'retry de persistência nunca duplica o item já upsertado em memória');
});
