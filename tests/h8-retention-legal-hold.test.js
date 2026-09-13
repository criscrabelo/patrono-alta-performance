// Sprint 2, Hardening H8 (docs/PRODUCTION_GATE.md, PG-18/PG-19; docs/DECISIONS.md, PROD-H8-01/02/03):
// retenção, legal hold e metadados de auditoria. Mesma técnica de tests/h2-auth-sessions.test.js —
// servidor HTTP real sobre um banco Postgres ISOLADO próprio deste arquivo. Gated por TEST_DATABASE_URL.
const test = require('node:test');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  test('[H8] testes pulados — TEST_DATABASE_URL não configurada neste ambiente (ver docs/PRODUCTION_GATE.md, seção 28)', { skip: true }, () => {});
} else {
  const assert = require('node:assert/strict');
  const http = require('node:http');
  const { Pool } = require('pg');
  const authCrypto = require('../auth/crypto');

  process.env.COEVO_DEMO_PASSWORD = 'h8-integration-test-password-0000000000';
  process.env.COEVO_SESSION_MS = '300000';
  process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY || 'test-mfa-encryption-key-at-least-32-characters';
  process.env.NODE_ENV = 'test';
  delete process.env.MONDAY_TOKEN;
  delete process.env.AUDIT_IP_HMAC_KEY;

  const ISOLATED_DB_NAME = `patrono_h8_test_${process.pid}_${Date.now()}`;
  let isolatedDatabaseUrl;

  async function createIsolatedDatabase() {
    const admin = new Pool({ connectionString: TEST_DATABASE_URL });
    await admin.query(`CREATE DATABASE ${ISOLATED_DB_NAME}`);
    await admin.end();
    isolatedDatabaseUrl = TEST_DATABASE_URL.replace(/\/[^/]+$/, `/${ISOLATED_DB_NAME}`);
    process.env.DATABASE_URL = isolatedDatabaseUrl;
  }
  async function dropIsolatedDatabase() {
    const admin = new Pool({ connectionString: TEST_DATABASE_URL });
    try { await admin.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB_NAME} WITH (FORCE)`); }
    finally { await admin.end(); }
  }

  let server, baseUrl, storage, readStore, writeStore;
  async function startInstance(mod) {
    const s = http.createServer(mod.handler);
    await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
    return { server: s, baseUrl: `http://127.0.0.1:${s.address().port}` };
  }
  function makeApi(baseUrlForInstance) {
    return async function api(method, pathname, { token, json } = {}) {
      const res = await fetch(`${baseUrlForInstance}${pathname}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: json !== undefined ? JSON.stringify(json) : undefined
      });
      const text = await res.text();
      let bodyOut; try { bodyOut = text ? JSON.parse(text) : null; } catch { bodyOut = text; }
      return { status: res.status, body: bodyOut };
    };
  }
  let api;

  const EMAILS = { diretoria: 'h8.diretoria@coevo.local', colaborador: 'h8.colaborador@coevo.local' };
  const SECRET_DIRETORIA = authCrypto.generateTotpSecret();

  async function loginAs(email, mfaSecret) {
    const login = await api('POST', '/api/auth/login', { json: { email, password: process.env.COEVO_DEMO_PASSWORD } });
    assert.equal(login.status, 200, `login deveria aceitar credenciais válidas para ${email}: ${JSON.stringify(login.body)}`);
    if (login.body.token) return login.body.token;
    const mfa = await api('POST', '/api/auth/mfa/verify', { json: { challenge: login.body.challenge, code: authCrypto.totpAt(mfaSecret, Date.now()) } });
    assert.equal(mfa.status, 200, `MFA deveria ser aceito: ${JSON.stringify(mfa.body)}`);
    return mfa.body.token;
  }

  test.before(async () => {
    await createIsolatedDatabase();
    delete require.cache[require.resolve('../scripts/migrate')];
    const { run: migrate } = require('../scripts/migrate');
    await migrate();
    const cutoverPool = new Pool({ connectionString: isolatedDatabaseUrl });
    await cutoverPool.query("INSERT INTO data_migrations (key) VALUES ('h1b_core_relational_cutover') ON CONFLICT (key) DO NOTHING");
    await cutoverPool.end();

    delete require.cache[require.resolve('../server')];
    delete require.cache[require.resolve('../storage')];
    delete require.cache[require.resolve('../auth/rate-limit')];
    delete require.cache[require.resolve('../retention/legal-hold')];
    delete require.cache[require.resolve('../retention/runner')];
    delete require.cache[require.resolve('../retention/policy')];
    const serverModule = require('../server');
    ({ readStore, writeStore, storage } = serverModule);
    await storage.init();

    const store = await readStore();
    store.users.push(
      { id: 'usr-h8-diretoria', name: 'H8 Diretoria', email: EMAILS.diretoria, role: 'diretoria', department: null, mfa: true, passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: true, mfaMethod: 'totp', mfaSecretEncrypted: authCrypto.encryptSecret(SECRET_DIRETORIA), mfaEnrolledAt: new Date().toISOString(), failedLoginCount: 0 },
      { id: 'usr-h8-colaborador', name: 'H8 Colaborador', email: EMAILS.colaborador, role: 'colaborador', department: 'Jurídico', mfa: false, passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 }
    );
    await writeStore(store);

    ({ server, baseUrl } = await startInstance(serverModule));
    api = makeApi(baseUrl);
  });

  test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await storage.close();
    await dropIsolatedDatabase();
  });

  // --- retention/policy.js (unitário, sem rede) ---------------------------------------------------
  const policy = require('../retention/policy');

  test('[H8-policy-A] defaults documentados são retornados quando nenhuma env var está definida', () => {
    const original = process.env.RETENTION_SECURITY_AUDIT_DAYS;
    delete process.env.RETENTION_SECURITY_AUDIT_DAYS;
    try {
      const resolved = policy.resolveRetentionValue('SECURITY_AUDIT');
      assert.equal(resolved.value, 365);
      assert.equal(resolved.source, 'default');
    } finally { if (original !== undefined) process.env.RETENTION_SECURITY_AUDIT_DAYS = original; }
  });

  test('[H8-policy-B] env var válida sobrescreve o default', () => {
    const original = process.env.RETENTION_OPERATIONAL_LOG_DAYS;
    process.env.RETENTION_OPERATIONAL_LOG_DAYS = '30';
    try {
      const resolved = policy.resolveRetentionValue('OPERATIONAL_LOG');
      assert.equal(resolved.value, 30);
      assert.equal(resolved.source, 'env');
    } finally { if (original === undefined) delete process.env.RETENTION_OPERATIONAL_LOG_DAYS; else process.env.RETENTION_OPERATIONAL_LOG_DAYS = original; }
  });

  test('[H8-policy-C] env var inválida (não-inteiro/negativa) lança erro explícito', () => {
    const original = process.env.RETENTION_OPERATIONAL_LOG_DAYS;
    process.env.RETENTION_OPERATIONAL_LOG_DAYS = 'abc';
    try {
      assert.throws(() => policy.resolveRetentionValue('OPERATIONAL_LOG'), /inválida/);
      process.env.RETENTION_OPERATIONAL_LOG_DAYS = '-5';
      assert.throws(() => policy.resolveRetentionValue('OPERATIONAL_LOG'), /inválida/);
    } finally { if (original === undefined) delete process.env.RETENTION_OPERATIONAL_LOG_DAYS; else process.env.RETENTION_OPERATIONAL_LOG_DAYS = original; }
  });

  test('[H8-policy-D] validatePolicyForProduction() propaga a mesma falha de validação', () => {
    const original = process.env.RETENTION_BACKUP_METADATA_DAYS;
    process.env.RETENTION_BACKUP_METADATA_DAYS = '0';
    try {
      assert.throws(() => policy.validatePolicyForProduction(), /inválida/);
    } finally { if (original === undefined) delete process.env.RETENTION_BACKUP_METADATA_DAYS; else process.env.RETENTION_BACKUP_METADATA_DAYS = original; }
  });

  test('[H8-policy-E] retentionMs() converte corretamente dias e horas', () => {
    assert.equal(policy.retentionMs('OPERATIONAL_LOG'), 90 * 24 * 60 * 60 * 1000);
    assert.equal(policy.retentionMs('RATE_LIMIT'), 24 * 60 * 60 * 1000);
    assert.equal(policy.retentionMs('BUSINESS_AUDIT'), null, 'BUSINESS_AUDIT não tem purge automático nesta rodada');
  });

  // --- observability/audit-context.js (unitário) --------------------------------------------------
  const { pseudonymizeIp, summarizeUserAgent } = require('../observability/audit-context');

  test('[H8-ip-A] pseudonymizeIp() usa HMAC-SHA256 quando AUDIT_IP_HMAC_KEY está definida', () => {
    process.env.AUDIT_IP_HMAC_KEY = 'chave-de-teste-h8';
    try {
      const hmac = pseudonymizeIp('203.0.113.5');
      assert.match(hmac, /^[a-f0-9]{64}$/);
      assert.ok(!hmac.includes('203.0.113.5'));
    } finally { delete process.env.AUDIT_IP_HMAC_KEY; }
  });

  test('[H8-ip-B] sem chave configurada fora de produção, retorna null (nunca IP em texto puro)', () => {
    delete process.env.AUDIT_IP_HMAC_KEY;
    assert.equal(pseudonymizeIp('203.0.113.5'), null);
  });

  test('[H8-ip-C] em produção, sem chave configurada, lança erro explícito (fail-fast)', () => {
    const originalEnv = process.env.NODE_ENV;
    delete process.env.AUDIT_IP_HMAC_KEY;
    process.env.NODE_ENV = 'production';
    try {
      assert.throws(() => pseudonymizeIp('203.0.113.5'), /AUDIT_IP_HMAC_KEY/);
    } finally { process.env.NODE_ENV = originalEnv; }
  });

  test('[H8-ua-A] summarizeUserAgent() nunca retorna a string crua, apenas família/plataforma', () => {
    const raw = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const summary = summarizeUserAgent(raw);
    assert.equal(summary, 'chrome/desktop');
    assert.ok(!summary.includes('Windows'));
    assert.ok(!summary.includes('537.36'));
  });

  // --- retention/legal-hold.js (contra Postgres real) ----------------------------------------------
  const legalHold = require('../retention/legal-hold');

  test('[H8-hold-A] createLegalHold() rejeita reason vazio', async () => {
    const pool = storage.getPool();
    await assert.rejects(() => legalHold.createLegalHold(pool, { scopeType: 'GLOBAL', reason: '  ', startedByUserId: 'usr-h8-diretoria' }), /reason/);
  });

  test('[H8-hold-B] createLegalHold() rejeita scopeType inválido', async () => {
    const pool = storage.getPool();
    await assert.rejects(() => legalHold.createLegalHold(pool, { scopeType: 'NAO_EXISTE', reason: 'motivo', startedByUserId: 'usr-h8-diretoria' }), /scopeType inválido/);
  });

  test('[H8-hold-C] createLegalHold() rejeita GLOBAL com scopeValue e escopo não-GLOBAL sem scopeValue', async () => {
    const pool = storage.getPool();
    await assert.rejects(() => legalHold.createLegalHold(pool, { scopeType: 'GLOBAL', scopeValue: 'algo', reason: 'motivo', startedByUserId: 'usr-h8-diretoria' }), /scopeValue deve ser omitido/);
    await assert.rejects(() => legalHold.createLegalHold(pool, { scopeType: 'ENTITY', reason: 'motivo', startedByUserId: 'usr-h8-diretoria' }), /scopeValue é obrigatório/);
  });

  test('[H8-hold-D] createLegalHold()/releaseLegalHold() ciclo completo — nunca deleta a linha', async () => {
    const pool = storage.getPool();
    const hold = await legalHold.createLegalHold(pool, { scopeType: 'ENTITY', scopeValue: 'user:teste-ciclo', reason: 'investigação interna', startedByUserId: 'usr-h8-diretoria' });
    assert.equal(hold.status, 'active');
    await assert.rejects(() => legalHold.releaseLegalHold(pool, { id: hold.id, releasedByUserId: 'usr-h8-diretoria', releaseReason: '' }), /reason/);
    const released = await legalHold.releaseLegalHold(pool, { id: hold.id, releasedByUserId: 'usr-h8-diretoria', releaseReason: 'investigação concluída' });
    assert.equal(released.status, 'released');
    assert.ok(released.releasedAt);
    const list = await legalHold.listLegalHolds(pool, { scopeValue: 'user:teste-ciclo' });
    assert.equal(list.length, 1, 'a linha continua existindo — legal hold nunca é deletado historicamente');
    await assert.rejects(() => legalHold.releaseLegalHold(pool, { id: hold.id, releasedByUserId: 'usr-h8-diretoria', releaseReason: 'de novo' }), /não encontrado ou já liberado/);
  });

  test('[H8-hold-E] listLegalHolds() com filtro de escopo nunca vaza hold de outro escopo (cross-scope)', async () => {
    const pool = storage.getPool();
    await legalHold.createLegalHold(pool, { scopeType: 'ENTITY', scopeValue: 'user:escopo-a', reason: 'motivo A', startedByUserId: 'usr-h8-diretoria' });
    await legalHold.createLegalHold(pool, { scopeType: 'ENTITY', scopeValue: 'user:escopo-b', reason: 'motivo B', startedByUserId: 'usr-h8-diretoria' });
    const listA = await legalHold.listLegalHolds(pool, { scopeValue: 'user:escopo-a' });
    assert.ok(listA.every(h => h.scopeValue === 'user:escopo-a'));
    assert.ok(!listA.some(h => h.scopeValue === 'user:escopo-b'));
  });

  test('[H8-hold-F] isUnderLegalHold(): GLOBAL bloqueia tudo; DATA_CLASS bloqueia a classe; ENTITY bloqueia só a entidade', async () => {
    const pool = storage.getPool();
    assert.equal(await legalHold.isUnderLegalHold(pool, { dataClass: 'AUTH_SESSION' }), false);

    const dataClassHold = await legalHold.createLegalHold(pool, { scopeType: 'DATA_CLASS', scopeValue: 'AUTH_SESSION', reason: 'revisão de classe', startedByUserId: 'usr-h8-diretoria' });
    assert.equal(await legalHold.isUnderLegalHold(pool, { dataClass: 'AUTH_SESSION' }), true);
    assert.equal(await legalHold.isUnderLegalHold(pool, { dataClass: 'AUTH_RESET_TOKEN' }), false);
    await legalHold.releaseLegalHold(pool, { id: dataClassHold.id, releasedByUserId: 'usr-h8-diretoria', releaseReason: 'fim da revisão' });

    const entityHold = await legalHold.createLegalHold(pool, { scopeType: 'ENTITY', scopeValue: 'user:isolado-1', reason: 'preservação', startedByUserId: 'usr-h8-diretoria' });
    assert.equal(await legalHold.isUnderLegalHold(pool, { dataClass: 'AUTH_SESSION', entityScopeValue: 'user:isolado-1' }), true);
    assert.equal(await legalHold.isUnderLegalHold(pool, { dataClass: 'AUTH_SESSION', entityScopeValue: 'user:isolado-2' }), false);
    await legalHold.releaseLegalHold(pool, { id: entityHold.id, releasedByUserId: 'usr-h8-diretoria', releaseReason: 'fim' });
  });

  // --- retention/runner.js (contra Postgres real) --------------------------------------------------
  const runner = require('../retention/runner');

  async function insertExpiredSession(pool, userId, expiresAgo) {
    await pool.query(
      `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, credentials_version) VALUES ($1,$2,$3, now() - ($4 || ' days')::interval, 1)`,
      [`sess-${crypto.randomUUID()}`, userId, `hash-${Math.random()}`, expiresAgo]
    );
  }
  const crypto = require('node:crypto');

  test('[H8-runner-A] dry-run nunca apaga nada, mesmo com linhas elegíveis', async () => {
    const pool = storage.getPool();
    await insertExpiredSession(pool, 'usr-h8-colaborador', 30);
    const before = await pool.query('SELECT count(*)::int AS c FROM auth_sessions');
    const result = await runner.runRetention(pool, { mode: 'dry_run', classes: ['AUTH_SESSION'], createdBy: 'test' });
    const after = await pool.query('SELECT count(*)::int AS c FROM auth_sessions');
    assert.equal(before.rows[0].c, after.rows[0].c, 'dry-run nunca deveria mudar a contagem de linhas');
    assert.ok(result.summary.AUTH_SESSION.eligible >= 1);
    assert.equal(result.policyVersion, policy.POLICY_VERSION);
  });

  test('[H8-runner-B] execute apaga somente o elegível, nunca o que está sob legal hold (ENTITY)', async () => {
    const pool = storage.getPool();
    await pool.query("DELETE FROM auth_sessions"); // isola este teste do anterior
    await insertExpiredSession(pool, 'usr-h8-colaborador', 30); // elegível, sem hold
    await insertExpiredSession(pool, 'usr-h8-diretoria', 30); // elegível, mas sob ENTITY hold

    const hold = await legalHold.createLegalHold(pool, { scopeType: 'ENTITY', scopeValue: 'user:usr-h8-diretoria', reason: 'preservar evidência', startedByUserId: 'usr-h8-diretoria' });
    try {
      const result = await runner.runRetention(pool, { mode: 'execute', classes: ['AUTH_SESSION'], createdBy: 'test' });
      assert.equal(result.summary.AUTH_SESSION.deleted, 1, 'só a sessão sem hold deveria ter sido removida');
      const remaining = await pool.query('SELECT user_id FROM auth_sessions');
      assert.deepEqual(remaining.rows.map(r => r.user_id), ['usr-h8-diretoria'], 'a sessão sob legal hold nunca deveria ser removida');
    } finally {
      await legalHold.releaseLegalHold(pool, { id: hold.id, releasedByUserId: 'usr-h8-diretoria', releaseReason: 'fim do teste' });
      await pool.query("DELETE FROM auth_sessions WHERE user_id = 'usr-h8-diretoria'");
    }
  });

  test('[H8-runner-C] runRetention() registra retention_runs com policyVersion/status/summary', async () => {
    const pool = storage.getPool();
    const result = await runner.runRetention(pool, { mode: 'dry_run', classes: ['RATE_LIMIT'], createdBy: 'test-run' });
    const { rows } = await pool.query('SELECT * FROM retention_runs WHERE id = $1', [result.runId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'completed');
    assert.equal(rows[0].mode, 'dry_run');
    assert.equal(rows[0].policy_version, policy.POLICY_VERSION);
    assert.ok(rows[0].summary);
    assert.equal(rows[0].error_code, null);
  });

  test('[H8-runner-D] retention_runs nunca contém payload sensível no summary', async () => {
    const pool = storage.getPool();
    const result = await runner.runRetention(pool, { mode: 'dry_run', classes: ['AUTH_SESSION', 'AUTH_RESET_TOKEN', 'RATE_LIMIT'], createdBy: 'test' });
    const { rows } = await pool.query('SELECT summary FROM retention_runs WHERE id = $1', [result.runId]);
    const summaryText = JSON.stringify(rows[0].summary);
    assert.ok(!/token_hash|password|secret/i.test(summaryText));
  });

  test('[H8-runner-E] runRetention() registra evento de auditoria RETENTION_DRY_RUN/RETENTION_EXECUTED resumido (nunca um por registro)', async () => {
    const pool = storage.getPool();
    const dryRun = await runner.runRetention(pool, { mode: 'dry_run', classes: ['RATE_LIMIT'], createdBy: 'test' });
    const dryRunRows = await pool.query("SELECT * FROM audit_log WHERE entity = 'retention_run' AND entity_id = $1 AND action = 'RETENTION_DRY_RUN'", [dryRun.runId]);
    assert.equal(dryRunRows.rows.length, 1, 'exatamente um evento resumido por execução, nunca um por registro');
    assert.equal(dryRunRows.rows[0].responsible, 'system:retention-runner');

    const execRun = await runner.runRetention(pool, { mode: 'execute', classes: ['RATE_LIMIT'], createdBy: 'test' });
    const execRows = await pool.query("SELECT * FROM audit_log WHERE entity = 'retention_run' AND entity_id = $1 AND action = 'RETENTION_EXECUTED'", [execRun.runId]);
    assert.equal(execRows.rows.length, 1);
  });

  test('[H8-runner-F] runRetention() registra RETENTION_ITEM_SKIPPED_LEGAL_HOLD resumido por classe quando há hold ativo', async () => {
    const pool = storage.getPool();
    await pool.query("DELETE FROM auth_sessions WHERE user_id = 'usr-h8-diretoria'");
    await insertExpiredSession(pool, 'usr-h8-diretoria', 30);
    const hold = await legalHold.createLegalHold(pool, { scopeType: 'ENTITY', scopeValue: 'user:usr-h8-diretoria', reason: 'preservar evidência', startedByUserId: 'usr-h8-diretoria' });
    try {
      const result = await runner.runRetention(pool, { mode: 'execute', classes: ['AUTH_SESSION'], createdBy: 'test' });
      const skipped = await pool.query("SELECT * FROM audit_log WHERE entity = 'retention_run' AND entity_id = $1 AND action = 'RETENTION_ITEM_SKIPPED_LEGAL_HOLD'", [result.runId]);
      assert.equal(skipped.rows.length, 1, 'um evento resumido por classe sob hold, nunca um por registro individual');
      assert.equal(skipped.rows[0].after.dataClass, 'AUTH_SESSION');
    } finally {
      await legalHold.releaseLegalHold(pool, { id: hold.id, releasedByUserId: 'usr-h8-diretoria', releaseReason: 'fim do teste' });
      await pool.query("DELETE FROM auth_sessions WHERE user_id = 'usr-h8-diretoria'");
    }
  });

  test('[H8-runner-G] runRetention() registra RETENTION_FAILED e retention_runs.status=failed quando a política é inválida em runtime', async () => {
    const pool = storage.getPool();
    const original = process.env.RETENTION_RATE_LIMIT_HOURS;
    process.env.RETENTION_RATE_LIMIT_HOURS = 'nao-e-um-inteiro';
    try {
      let thrown = null;
      let runIdSeen = null;
      const originalQuery = pool.query.bind(pool);
      pool.query = async (text, params) => {
        const result = await originalQuery(text, params);
        if (typeof text === 'string' && text.includes('INSERT INTO retention_runs')) runIdSeen = params[0];
        return result;
      };
      try {
        await runner.runRetention(pool, { mode: 'dry_run', classes: ['RATE_LIMIT'], createdBy: 'test' });
      } catch (error) {
        thrown = error;
      } finally {
        pool.query = originalQuery;
      }
      assert.ok(thrown, 'runRetention deveria propagar o erro de política inválida');
      assert.ok(runIdSeen);
      const runRow = await pool.query('SELECT status, error_code FROM retention_runs WHERE id = $1', [runIdSeen]);
      assert.equal(runRow.rows[0].status, 'failed');
      assert.equal(runRow.rows[0].error_code, 'RETENTION_RUN_FAILED');
      const failedAudit = await pool.query("SELECT * FROM audit_log WHERE entity = 'retention_run' AND entity_id = $1 AND action = 'RETENTION_FAILED'", [runIdSeen]);
      assert.equal(failedAudit.rows.length, 1);
    } finally {
      if (original === undefined) delete process.env.RETENTION_RATE_LIMIT_HOURS;
      else process.env.RETENTION_RATE_LIMIT_HOURS = original;
    }
  });

  // --- HTTP: RBAC + audit metadata (requestId, sem segredo) ----------------------------------------
  test('[H8-http-A] colaborador comum recebe 403 ao tentar criar legal hold', async () => {
    const token = await loginAs(EMAILS.colaborador);
    const res = await api('POST', '/api/legal-holds', { token, json: { scopeType: 'GLOBAL', reason: 'tentativa não autorizada' } });
    assert.equal(res.status, 403);
  });

  test('[H8-http-B] diretoria consegue criar, listar e liberar legal hold; audit_log registra requestId e nunca token/segredo', async () => {
    const token = await loginAs(EMAILS.diretoria, SECRET_DIRETORIA);
    const create = await api('POST', '/api/legal-holds', { token, json: { scopeType: 'ENTITY', scopeValue: 'user:http-teste', reason: 'processo em andamento' } });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    assert.equal(create.body.status, 'active');

    const list = await api('GET', '/api/legal-holds?scopeValue=user:http-teste', { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);

    const release = await api('POST', `/api/legal-holds/${create.body.id}/release`, { token, json: { releaseReason: 'processo concluído' } });
    assert.equal(release.status, 200);
    assert.equal(release.body.status, 'released');

    const pool = storage.getPool();
    const { rows } = await pool.query("SELECT * FROM audit_log WHERE entity = 'legal_hold' AND entity_id = $1 ORDER BY date", [create.body.id]);
    assert.equal(rows.length, 2, 'deveria haver exatamente 2 eventos: criação e liberação');
    assert.equal(rows[0].action, 'LEGAL_HOLD_CREATED');
    assert.equal(rows[1].action, 'LEGAL_HOLD_RELEASED');
    for (const row of rows) {
      assert.ok(row.request_id, 'requestId deveria estar presente (reaproveitado de H6)');
      const serialized = JSON.stringify(row);
      assert.ok(!serialized.includes(token), 'o token de sessão nunca deveria aparecer no audit_log');
      assert.ok(!/bearer/i.test(serialized));
    }
  });

  test('[H8-http-C] reason vazio é rejeitado pela rota HTTP (nunca cria hold sem motivo)', async () => {
    const token = await loginAs(EMAILS.diretoria, SECRET_DIRETORIA);
    const res = await api('POST', '/api/legal-holds', { token, json: { scopeType: 'GLOBAL', reason: '' } });
    assert.equal(res.status, 422);
  });

  test('[H8-http-D] MASTER_HANDOFF.md permanece intocado (H8 nunca o altera)', () => {
    const { execSync } = require('node:child_process');
    const diffStat = execSync('git diff --stat origin/master -- docs/MASTER_HANDOFF.md || true', { cwd: require('node:path').join(__dirname, '..') }).toString();
    assert.equal(diffStat.trim(), '', `docs/MASTER_HANDOFF.md não deveria ter sido alterado: ${diffStat}`);
  });
}
