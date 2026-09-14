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

// --- P0 (branch demo, 2ª rodada): client CHECKED OUT via pool.connect() emitindo 'error' durante a
// transação (o crash real reportado: "Emitted 'error' event on Client instance", pg/lib/client.js) ---

// Duplica o comportamento real do driver `pg`: quando a conexão de um client cai DURANTE uma query em
// andamento, o erro chega em DOIS lugares — (1) a própria promise da query rejeita, e (2) o client emite
// 'error' nele mesmo, de forma ASSÍNCRONA (um tick à parte, não dentro do mesmo call stack síncrono da
// query). É esse (2) que crasha o processo se não houver listener — por isso o `setImmediate` abaixo, em
// vez de um throw síncrono dentro de `query()` (que qualquer try/catch já pegaria, sem provar nada sobre
// o bug real).
function makeFakeClient({ shouldFail }) {
  const { EventEmitter } = require('node:events');
  const client = new EventEmitter();
  client.released = undefined;
  client.query = (sql) => {
    // BEGIN/COMMIT/ROLLBACK sempre têm sucesso — só a query "de trabalho" dentro da transação falha,
    // reproduzindo uma queda de conexão NO MEIO da transação (depois do BEGIN), não na abertura dela.
    if (!['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) && shouldFail()) {
      const error = new Error('Connection terminated unexpectedly');
      return new Promise((resolve, reject) => {
        setImmediate(() => { client.emit('error', error); reject(error); });
      });
    }
    return Promise.resolve({ rows: [] });
  };
  client.release = (arg) => { client.released = arg; };
  return client;
}

test('[P0] withTransaction(): client emite erro de conexão DURANTE a transação — não derruba o processo, descarta o client quebrado, e o retry usa uma transação/conexão nova sem duplicar efeito', async () => {
  const { createPostgresStore } = require('../storage/postgres-store');
  const { withTransientRetry } = require('../storage/retry');

  const store = createPostgresStore({ databaseUrl: 'postgres://usuario:senha@host-inexistente:5432/db', seed: {} });
  const clients = [];
  let connectCalls = 0;
  // Substitui só o método connect() do pool real por um fake — nunca abre conexão de rede de verdade,
  // então o teste roda sem depender de um PostgreSQL disponível neste ambiente. A 1ª conexão obtida
  // sempre falha (simulando a queda real); a 2ª (nova conexão do retry) sempre funciona.
  store.getPool().connect = async () => {
    connectCalls++;
    const isFirstConnection = connectCalls === 1;
    const client = makeFakeClient({ shouldFail: () => isFirstConnection });
    clients.push(client);
    return client;
  };

  let attempt = 0;
  const insertedIds = [];
  // Confirma que NENHUMA uncaughtException escapa para o processo (rede de segurança só para o teste em
  // si — se o fix estiver correto, este handler nunca deveria disparar, porque withTransaction() já
  // registra seu próprio listener no client antes de qualquer 'error' ser emitido).
  let uncaught = null;
  const onUncaught = (error) => { uncaught = error; };
  process.on('uncaughtException', onUncaught);

  try {
    const result = await withTransientRetry(() => store.withTransaction(async (client) => {
      attempt++;
      await client.query('QUERY'); // na 1ª tentativa, rejeita (client da 1ª conexão); na 2ª, resolve
      insertedIds.push('registro-1');
      return 'ok';
    }), { maxAttempts: 3, baseDelayMs: 1 });

    assert.equal(result, 'ok');
  } finally {
    process.removeListener('uncaughtException', onUncaught);
  }

  assert.equal(uncaught, null, 'emitir "error" no client durante a transação nunca pode virar uncaughtException/derrubar o processo');
  assert.equal(attempt, 2, 'a transação inteira deve ser tentada de novo (não só a query que falhou)');
  assert.equal(clients.length, 2, 'o retry deve pegar uma conexão NOVA do pool, nunca reaproveitar o client quebrado');
  assert.equal(clients[0].released, true, 'o client quebrado precisa ser descartado do pool ao liberar (release(true)), nunca devolvido saudável');
  assert.notEqual(clients[1].released, true, 'o client da tentativa bem-sucedida deve voltar normalmente ao pool');
  assert.deepEqual(insertedIds, ['registro-1'], 'o efeito da tentativa que falhou nunca é aplicado — só a tentativa bem-sucedida grava, sem duplicar');

  await store.close();
});

// --- P0 (branch demo, 3ª rodada): conflito de CAS após erro AMBÍGUO de conexão (a escrita anterior pode
// ter sido efetivada no Postgres antes de a conexão cair, sem o client receber a confirmação) ---

test('[P0] reconcileMondayBoardAfterConflict(): relê o canônico, reaplica só o board corrente sem duplicar, preserva outros boards e a auditoria (nunca overwrite cego)', async (t) => {
  const serverModule = require('../server');
  const { reconcileMondayBoardAfterConflict, storage, seed } = serverModule;

  // Estado "canônico" simulado no banco: o board 'pesquisas' já contém um item que a escrita anterior
  // (ambígua) pode ter persistido de verdade, mesmo externalId que a rodada atual também tenta upsertar;
  // 'acessos' representa outro board já persistido por uma escrita anterior BEM-SUCEDIDA, que não pode
  // ser perdido nem sobrescrito.
  const canonical = structuredClone(seed);
  canonical.records = {
    pesquisas: [{ id: 'existing-1', source: 'monday', externalId: '1', module: 'pesquisas', boardId: '9535379620', boardName: 'Pesquisas', title: 'Item 1', group: 'G1', columns: {}, columnsByTitle: {}, version: 1 }],
    acessos: [{ id: 'other-board-1', source: 'monday', externalId: '9', module: 'acessos', title: 'Preexistente', columns: {}, columnsByTitle: {}, version: 1 }]
  };
  canonical.audit = [{ id: 'audit-preexistente', action: 'SYNC' }];

  const originalReadStore = storage.readStore;
  const originalWriteStore = storage.writeStore;
  const writes = [];
  storage.readStore = async () => structuredClone(canonical);
  storage.writeStore = async (s) => { writes.push(structuredClone(s)); return s; };
  t.after(() => { storage.readStore = originalReadStore; storage.writeStore = originalWriteStore; });

  // `store` em memória, com uma versão desatualizada (a que causou o StoreConflictError) — vazio de
  // propósito, para provar que a reconciliação vem do banco, nunca de um estado local presumido.
  const store = { records: {} };
  const board = { id: '9535379620', name: 'Pesquisas' };
  // Mesmo item que o canônico já tem (id Monday '1') — simula exatamente o item cuja escrita anterior
  // pode ter sido efetivada de forma ambígua.
  const items = [{ id: '1', name: 'Item 1', created_at: '2026-01-01', group: { title: 'G1' }, column_values: [] }];

  const counts = await reconcileMondayBoardAfterConflict(store, 'pesquisas', board, items);

  assert.equal(counts.created, 0, 'item já persistido pela escrita ambígua deve ser reconhecido por externalId, nunca duplicado');
  assert.equal(counts.unchanged, 1);
  assert.equal(store.records.pesquisas.length, 1, 'nenhuma duplicação no board reconciliado');
  assert.equal(store.records.acessos.length, 1, 'outro board já persistido no canônico é preservado — nunca um overwrite cego');
  assert.deepEqual(store.audit, canonical.audit, 'auditoria preexistente é preservada, nunca descartada pela reconciliação');

  const lastWrite = writes.at(-1);
  assert.equal(lastWrite.records.pesquisas.length, 1, 'a gravação final reflete o estado reconciliado, sem duplicar');
  assert.equal(lastWrite.records.acessos.length, 1, 'a gravação final preserva o outro board intacto');
});

test('[P0] runMondaySync(): persistBoard rejeitando com StoreConflictError aciona a reconciliação — o board conflitante é recuperado (status "ok", reconciled:true) e os demais boards seguem normalmente', async (t) => {
  const { runMondaySync } = require('../server');
  process.env.MONDAY_TOKEN = 'token-de-teste';
  t.after(() => { delete process.env.MONDAY_TOKEN; });

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => mondayItemsPage([{ id: 'x', name: 'Item', created_at: '2026-01-01', group: { title: 'G' }, column_values: [] }], null) });
  t.after(() => { global.fetch = originalFetch; });

  const { StoreConflictError } = require('../storage/errors');
  const { storage, seed } = require('../server');
  // A reconciliação real (já coberta isoladamente pelo teste acima) chama readStore()/writeStore() —
  // mockados aqui para não escrever no arquivo local real (data/store.json) durante o teste.
  const canonical = structuredClone(seed);
  canonical.records = { pesquisas: [] };
  const originalReadStore = storage.readStore;
  const originalWriteStore = storage.writeStore;
  storage.readStore = async () => structuredClone(canonical);
  storage.writeStore = async (s) => s;
  t.after(() => { storage.readStore = originalReadStore; storage.writeStore = originalWriteStore; });

  const store = { records: {} };
  const persisted = [];
  const run = await runMondaySync(store, 'Teste', ['pesquisas', 'acessos'], {
    persistBoard: async ({ moduleName }) => {
      if (moduleName === 'pesquisas') throw new StoreConflictError();
      persisted.push(moduleName);
    }
  });

  const pesquisas = run.modules.find(m => m.module === 'pesquisas');
  const acessos = run.modules.find(m => m.module === 'acessos');
  assert.equal(pesquisas.status, 'ok', 'após reconciliação bem-sucedida, o board deixa de ser reportado como falho');
  assert.equal(pesquisas.reconciled, true);
  assert.equal(acessos.status, 'ok', 'boards sem conflito continuam funcionando normalmente');
  assert.deepEqual(persisted, ['acessos']);
  assert.equal(run.status, 'completed', 'um conflito reconciliado com sucesso não deve marcar a execução como parcial/falha');
});
