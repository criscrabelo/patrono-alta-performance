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
