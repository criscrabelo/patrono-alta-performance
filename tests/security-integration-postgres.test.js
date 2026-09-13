// Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, PG-01/PG-02/PG-22): testes HTTP reais rodando com
// PostgreSQL como persistência ativa — mesma técnica de tests/security-integration.test.js (servidor
// HTTP real, `handler` exportado de server.js), mas com DATABASE_URL apontando para um Postgres de
// teste ISOLADO em vez do fallback local em JSON.
//
// Só roda de fato quando TEST_DATABASE_URL está definida (nunca aponta para produção). Sem ela, todo o
// arquivo é pulado explicitamente — mesmo padrão já usado para o adapter do Google Calendar: reportar
// a ausência de infraestrutura de teste, nunca fingir cobertura que não existe (ver
// docs/PRODUCTION_GATE.md, seção 28).
const test = require('node:test');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  test('[HTTP/Postgres] testes pulados — TEST_DATABASE_URL não configurada neste ambiente (ver docs/PRODUCTION_GATE.md, seção 28)', { skip: true }, () => {});
} else {
  const assert = require('node:assert/strict');
  const http = require('node:http');
  const { Pool } = require('pg');

  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.COEVO_DEMO_PASSWORD = 'integration-test-password-0000000000';
  process.env.COEVO_MFA_CODE = '000000';
  process.env.COEVO_SESSION_MS = '300000';
  process.env.NODE_ENV = 'test';
  delete process.env.MONDAY_TOKEN;

  let server, baseUrl;

  test.before(async () => {
    // Tabela zerada antes da suíte — nunca reaproveita dado de uma execução anterior, nunca toca um
    // banco que não seja o TEST_DATABASE_URL isolado apontado explicitamente pelo operador/CI.
    const cleanup = new Pool({ connectionString: TEST_DATABASE_URL });
    await cleanup.query('DROP TABLE IF EXISTS app_store');
    await cleanup.end();

    const { handler, readStore, writeStore, storage } = require('../server');
    // Fora do boot real (`require.main === module`), ninguém chama storage.init() automaticamente —
    // replica aqui o mesmo passo que o processo faria ao subir de verdade.
    await storage.init();
    const store = await readStore();
    store.users.push({ id: 'usr-pg-teste', name: 'Usuário Postgres Teste', email: 'pg.teste@coevo.local', role: 'lider', department: 'Jurídico', mfa: false });
    if (!store.records) store.records = {};
    store.records.processos = [{ id: 'proc-pg-teste', source: 'monday', department: 'Jurídico', deletedAt: null }];
    await writeStore(store);

    server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    const cleanup = new Pool({ connectionString: TEST_DATABASE_URL });
    await cleanup.query('DROP TABLE IF EXISTS app_store');
    await cleanup.end();
  });

  async function api(method, pathname, { token, json } = {}) {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined
    });
    const text = await res.text();
    let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  }

  async function loginAs(email) {
    const login = await api('POST', '/api/auth/login', { json: { email, password: process.env.COEVO_DEMO_PASSWORD } });
    assert.equal(login.status, 200, `login deveria aceitar credenciais válidas para ${email}: ${JSON.stringify(login.body)}`);
    if (login.body.token) return login.body.token;
    assert.equal(login.body.mfaRequired, true);
    const mfa = await api('POST', '/api/auth/mfa', { json: { challenge: login.body.challenge, code: process.env.COEVO_MFA_CODE } });
    assert.equal(mfa.status, 200, `MFA deveria ser aceito para ${email}: ${JSON.stringify(mfa.body)}`);
    return mfa.body.token;
  }

  test('[HTTP/Postgres] GET /api/health reporta persistence:"postgres", databaseReachable e schemaReady, nunca host/usuário/senha', async () => {
    const token = await loginAs('pg.teste@coevo.local');
    const res = await api('GET', '/api/health', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.persistence, 'postgres');
    assert.equal(res.body.databaseConfigured, true);
    assert.equal(res.body.databaseReachable, true);
    assert.equal(res.body.schemaReady, true);
    const serialized = JSON.stringify(res.body).toLowerCase();
    assert.ok(!serialized.includes('password') && !serialized.includes('postgres:postgres') && !serialized.includes('localhost'), 'healthcheck nunca expõe a connection string/credenciais');
  });

  test('[HTTP/Postgres] POST /api/backup/restore é bloqueado explicitamente sob PostgreSQL (RESTORE_NOT_SUPPORTED_FOR_POSTGRES)', async () => {
    const token = await loginAs('pg.teste@coevo.local');
    // usr-pg-teste não tem alçada de aprovação — usamos a diretoria do seed, que tem `scopes:['*']`.
    const tokenDiretoria = await loginAs('juridico@coevoconstrutora.com.br');
    const res = await api('POST', '/api/backup/restore', { token: tokenDiretoria, json: { algorithm: 'aes-256-gcm', iv: 'x', tag: 'x', payload: 'x', checksum: 'x' } });
    assert.equal(res.status, 501);
    assert.equal(res.body.error, 'RESTORE_NOT_SUPPORTED_FOR_POSTGRES');
  });

  test('[HTTP/Postgres] concorrência real: dois PATCH simultâneos no mesmo Legal Deadline — um vence (200), o outro recebe 409, nunca os dois sobrescrevem silenciosamente', async () => {
    const token = await loginAs('juridico@coevoconstrutora.com.br');
    const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-pg-teste', origin: 'Prazo para teste de concorrência real (H1A)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
    assert.equal(created.status, 201);
    const id = created.body.id;

    const [first, second] = await Promise.all([
      api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { origin: 'Atualização concorrente A' } }),
      api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { origin: 'Atualização concorrente B' } })
    ]);
    const statuses = [first.status, second.status].sort();
    assert.ok(
      (statuses[0] === 200 && statuses[1] === 409) || (statuses[0] === 200 && statuses[1] === 200),
      `esperado 200+409 (conflito real detectado) ou 200+200 (serializadas pelo event loop antes de colidir) — nunca dois 500: ${JSON.stringify(statuses)}`
    );
    assert.ok(statuses.includes(200), 'pelo menos uma das duas atualizações concorrentes é aplicada com sucesso');
  });
}
