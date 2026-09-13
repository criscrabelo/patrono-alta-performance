// Sprint 2, Hardening H1B (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H1B-01): testes do núcleo
// canônico normalizado (users/legalProcesses/legalDeadlines/audit em tabelas relacionais próprias, com
// FK real Legal Deadline → Legal Process/users). Mesma técnica de tests/security-integration-postgres
// .test.js (servidor HTTP real via `handler` exportado de server.js) mais testes diretos da ponte
// relacional (storage/index.js) e do script de migração de dados H1A→H1B.
//
// Só roda de fato quando TEST_DATABASE_URL está definida (nunca aponta para produção). Sem ela, todo o
// arquivo é pulado explicitamente — mesmo padrão já usado em H1A (docs/PRODUCTION_GATE.md, seção 28).
const test = require('node:test');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  test('[H1B] testes pulados — TEST_DATABASE_URL não configurada neste ambiente (ver docs/PRODUCTION_GATE.md, seção 28)', { skip: true }, () => {});
} else {
  const assert = require('node:assert/strict');
  const http = require('node:http');
  const { Pool } = require('pg');

  // Sprint 2, Hardening H2: ver tests/security-integration.test.js para a explicação completa da
  // migração de senha global/código MFA global para credenciais individuais reais.
  process.env.COEVO_DEMO_PASSWORD = 'integration-test-password-0000000000';
  process.env.COEVO_SESSION_MS = '300000';
  process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY || 'test-mfa-encryption-key-at-least-32-characters';
  process.env.NODE_ENV = 'test';
  delete process.env.MONDAY_TOKEN;

  // Banco ISOLADO e próprio deste arquivo (não o database default de TEST_DATABASE_URL) — evita colidir
  // com tests/storage.test.js e tests/security-integration-postgres.test.js, que rodam em paralelo (o
  // runner de testes do Node executa arquivos de teste concorrentemente) e também fazem DROP/CREATE
  // TABLE em `app_store`/`schema_migrations` no banco default. Sem isolamento, um arquivo podia derrubar
  // a tabela que o outro estava usando no meio do teste ("relation app_store does not exist").
  const ISOLATED_DB_NAME = `patrono_h1b_core_test_${process.pid}_${Date.now()}`;
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
    try {
      // `WITH (FORCE)` (Postgres 13+) evita a corrida entre `pool.end()` do backend Postgres do
      // servidor de teste (test.after() já chamou `storage.close()` acima) e a liberação efetiva da
      // conexão no lado do servidor — sem isso, um DROP DATABASE imediato pode ver a conexão ainda
      // "em uso" por uma fração de segundo e falhar (55006).
      await admin.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB_NAME} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }

  let server, baseUrl, storage, readStore, writeStore;

  test.before(async () => {
    await createIsolatedDatabase();
    delete require.cache[require.resolve('../scripts/migrate')];
    const { run: migrate } = require('../scripts/migrate');
    await migrate();
    // Este arquivo testa o núcleo relacional/bridge em si (não o script de cutover, coberto à parte
    // pelos testes "[H1B-cutover ...]" abaixo) — grava o marcador de cutover diretamente para simular
    // "cutover já concluído, tabelas vazias, prontas para a ponte gravar" (equivalente a uma instalação
    // nova que acabou de rodar `migrate:h1b:data` sobre um app_store igualmente vazio).
    const cutoverPool = new Pool({ connectionString: isolatedDatabaseUrl });
    await cutoverPool.query("INSERT INTO data_migrations (key) VALUES ('h1b_core_relational_cutover') ON CONFLICT (key) DO NOTHING");
    await cutoverPool.end();
    delete require.cache[require.resolve('../server')];
    const serverModule = require('../server');
    ({ readStore, writeStore, storage } = serverModule);
    await storage.init();
    const store = await readStore();
    store.users.push(
      { id: 'usr-h1b-lider', name: 'Líder Jurídico H1B', email: 'h1b.lider@coevo.local', role: 'lider', department: 'Jurídico', mfa: false },
      { id: 'usr-h1b-ti', name: 'Líder TI H1B', email: 'h1b.ti@coevo.local', role: 'lider', department: 'TI', mfa: false },
      { id: 'usr-h1b-admin', name: 'Administrador H1B', email: 'h1b.admin@coevo.local', role: 'administrador', department: null, mfa: false },
      { id: 'usr-h1b-inativo', name: 'Usuário Inativo H1B', email: 'h1b.inativo@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, deletedAt: new Date().toISOString() },
      // O marcador de cutover é gravado diretamente (sem rodar a migração de dados real — ver comentário
      // acima), então `app_users` está genuinamente vazio: o seed padrão de `server.js`
      // (usr-diretoria/usr-juridico/usr-ti) nunca chega a existir aqui. Precisa de um usuário com alçada
      // global própria (`diretoria`, único papel com a ação `restore`) para os testes que exercitam
      // permissões que nenhum dos 4 usuários acima cobre.
      { id: 'usr-h1b-diretoria', name: 'Diretoria H1B', email: 'h1b.diretoria@coevo.local', role: 'diretoria', department: null, mfa: false }
    );
    store.records.processos = [
      { id: 'proc-h1b-1', source: 'monday', department: 'Jurídico', title: 'Processo H1B 1', deletedAt: null, version: 1 },
      { id: 'proc-h1b-ti', source: 'monday', department: 'TI', title: 'Processo H1B TI', deletedAt: null, version: 1 }
    ];
    await writeStore(store);
    server = http.createServer(serverModule.handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await storage.close();
    await dropIsolatedDatabase();
  });

  // Sprint 2, Hardening H3 (docs/DECISIONS.md, PROD-H3-01): este arquivo faz login repetidas vezes por
  // identidade/IP (uso legítimo de teste, não abuso) — zera os buckets de rate limit antes de cada
  // teste para não interferir com a semântica H1B sendo validada aqui (H3 tem sua própria suíte
  // dedicada em tests/h3-rate-limiting.test.js).
  test.beforeEach(async () => {
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    await pool.query('DELETE FROM rate_limit_buckets');
    await pool.end();
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

  const authCrypto = require('../auth/crypto');
  const DEV_SEED_TOTP_SECRET = process.env.COEVO_SEED_TOTP_SECRET || 'JBSWY3DPEHPK3PXP';
  // Revisão pós-PR #13 (docs/DECISIONS.md, PROD-H2-01): o teste [H1B-B] logo abaixo insere
  // deliberadamente um segundo usuário com o MESMO e-mail de `usr-h1b-lider` (para provar que
  // `app_users.email` continua sem UNIQUE — gap documentado em PROD-H1B-01) — a partir dessa inserção,
  // login por e-mail para `h1b.lider@coevo.local` passa a ser ambíguo (exatamente o comportamento que a
  // correção de identidade de login única exige rejeitar). `loginAs()` usa o `login_identifier` (login
  // técnico único) para não depender de um e-mail que o próprio teste torna ambíguo de propósito.
  const EMAIL_TO_LOGIN_IDENTIFIER = { 'h1b.lider@coevo.local': 'usr-h1b-lider' };
  async function loginAs(email) {
    const payload = EMAIL_TO_LOGIN_IDENTIFIER[email]
      ? { login: EMAIL_TO_LOGIN_IDENTIFIER[email], password: process.env.COEVO_DEMO_PASSWORD }
      : { email, password: process.env.COEVO_DEMO_PASSWORD };
    const login = await api('POST', '/api/auth/login', { json: payload });
    assert.equal(login.status, 200, `login deveria aceitar credenciais válidas para ${email}: ${JSON.stringify(login.body)}`);
    if (login.body.token) return login.body.token;
    assert.equal(login.body.mfaRequired, true);
    const code = authCrypto.totpAt(DEV_SEED_TOTP_SECRET, Date.now());
    const mfa = await api('POST', '/api/auth/mfa/verify', { json: { challenge: login.body.challenge, code } });
    assert.equal(mfa.status, 200, `MFA deveria ser aceito para ${email}: ${JSON.stringify(mfa.body)}`);
    return mfa.body.token;
  }

  // A. users: persistido via bridge relacional (não mais no blob) --------------------------------
  test('[H1B-A] users: persistidos na tabela relacional (bootstrap seed + registro criado pela ponte)', async () => {
    const store = await readStore();
    assert.ok(store.users.some(u => u.id === 'usr-h1b-lider'));
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const { rows } = await pool.query('SELECT id FROM app_users WHERE id = $1', ['usr-h1b-lider']);
    await pool.end();
    assert.equal(rows.length, 1, 'usuário criado via store.users.push()+writeStore() deve existir fisicamente em app_users');
  });

  // B. e-mail único: NÃO é imposto por constraint de banco (matriz de normalização H1B — regra vigente
  // no runtime nunca foi de unicidade rígida; seed já tinha dois usuários com o mesmo email) ----------
  test('[H1B-B] users: e-mail duplicado é permitido no schema relacional (preserva a regra vigente, não uma nova unicidade rígida)', async () => {
    const store = await readStore();
    store.users.push({ id: 'usr-h1b-dup', name: 'Duplicado', email: 'h1b.lider@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false });
    await writeStore(store);
    const reread = await readStore();
    assert.equal(reread.users.filter(u => u.email === 'h1b.lider@coevo.local').length, 2, 'sem UNIQUE(email) — mesmo comportamento já existente antes de H1B');
  });

  // C. deletedAt preservado ----------------------------------------------------------------------
  test('[H1B-C] users: deletedAt preservado na tabela relacional — login rejeitado para usuário inativo', async () => {
    const store = await readStore();
    const inactive = store.users.find(u => u.id === 'usr-h1b-inativo');
    assert.ok(inactive.deletedAt, 'deletedAt deve sobreviver ao round-trip pela ponte relacional');
    const login = await api('POST', '/api/auth/login', { json: { email: 'h1b.inativo@coevo.local', password: process.env.COEVO_DEMO_PASSWORD } });
    assert.equal(login.status, 401);
  });

  test('[H1B] users: ordem de leitura preserva a ordem de inserção (não a ordem lexicográfica de id) — "primeiro usuário com este email" continua determinístico como antes de H1B', async () => {
    const store = await readStore();
    const before = store.users.map(u => u.id);
    store.users.push({ id: 'usr-aaa-ordem', name: 'Ordem', email: 'ordem@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false });
    await writeStore(store);
    const reread = await readStore();
    const after = reread.users.map(u => u.id);
    assert.deepEqual(after.slice(0, before.length), before, 'usuários já existentes continuam na mesma ordem relativa; o novo aparece depois, mesmo tendo id lexicograficamente menor que alguns dos anteriores');
  });

  // D. Legal Process persistido -------------------------------------------------------------------
  test('[H1B-D] legalProcesses: persistido na tabela relacional (não mais em store.records.processos dentro do blob)', async () => {
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const { rows } = await pool.query('SELECT id, source FROM legal_processes WHERE id = $1', ['proc-h1b-1']);
    const blob = await pool.query('SELECT data FROM app_store WHERE id = 1');
    await pool.end();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'monday');
    assert.equal(Boolean(blob.rows[0].data.records && blob.rows[0].data.records.processos), false, 'processos não deve mais existir dentro do blob (sem dual-write)');
  });

  let createdDeadlineId;

  // E. Legal Deadline persistido ------------------------------------------------------------------
  test('[H1B-E] legalDeadlines: criado via API é persistido na tabela relacional', async () => {
    const token = await loginAs('h1b.lider@coevo.local');
    const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-h1b-1', origin: 'Prazo H1B', date: '2026-12-15', originType: 'JUDICIAL_PROCESSUAL' } });
    assert.equal(created.status, 201);
    createdDeadlineId = created.body.id;
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const { rows } = await pool.query('SELECT id, process_id FROM legal_deadlines WHERE id = $1', [createdDeadlineId]);
    await pool.end();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].process_id, 'proc-h1b-1');
  });

  // F. FK processId — órfão rejeitado --------------------------------------------------------------
  test('[H1B-F] legalDeadlines: processId inexistente é rejeitado antes de chegar ao banco (validateLegalDeadline)', async () => {
    const token = await loginAs('h1b.lider@coevo.local');
    const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-nao-existe', origin: 'x', date: '2026-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
    assert.equal(res.status, 422);
  });

  test('[H1B-F2] legal_deadlines: FK real no banco também rejeita processId inexistente (segunda linha de defesa, bypassando a validação de aplicação)', async () => {
    const { legalDeadlines } = require('../storage/repositories');
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    await assert.rejects(
      () => legalDeadlines.insert(pool, { id: 'ld-fk-teste', processId: 'proc-definitivamente-nao-existe', origin: 'x', date: '2026-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', version: 1 }),
      /integridade referencial/
    );
    await pool.end();
  });

  // G. FK responsibleUserId — órfão rejeitado -------------------------------------------------------
  test('[H1B-G] legalDeadlines: responsibleUserId inexistente é rejeitado (validação de aplicação)', async () => {
    const token = await loginAs('h1b.lider@coevo.local');
    const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-h1b-1', origin: 'x', date: '2026-01-01', originType: 'JUDICIAL_PROCESSUAL', responsibleUserId: 'usr-nao-existe' } });
    assert.equal(res.status, 422);
  });

  // H. responsibleUserId null é aceito ---------------------------------------------------------------
  test('[H1B-H] legalDeadlines: responsibleUserId ausente/null é aceito (campo opcional)', async () => {
    const token = await loginAs('h1b.lider@coevo.local');
    const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-h1b-1', origin: 'sem responsável', date: '2026-01-02', originType: 'JUDICIAL_PROCESSUAL' } });
    assert.equal(res.status, 201);
    assert.ok(res.body.responsibleUserId === null || res.body.responsibleUserId === undefined);
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const { rows } = await pool.query('SELECT responsible_user_id FROM legal_deadlines WHERE id = $1', [res.body.id]);
    await pool.end();
    assert.equal(rows[0].responsible_user_id, null, 'persistido como NULL na coluna FK — nunca uma string vazia/placeholder');
  });

  // I/J. status/originType inválido rejeitado (CHECK constraint no banco, bypassando a aplicação) -----
  test('[H1B-I] legal_deadlines: CHECK constraint rejeita status fora do enum, mesmo bypassando a validação de aplicação', async () => {
    const { legalDeadlines } = require('../storage/repositories');
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    await assert.rejects(
      () => legalDeadlines.insert(pool, { id: 'ld-status-invalido', processId: 'proc-h1b-1', origin: 'x', date: '2026-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'nao_existe', version: 1 }),
      /check constraint|violates/i
    );
    await pool.end();
  });

  test('[H1B-J] legal_deadlines: CHECK constraint rejeita originType fora do enum, mesmo bypassando a validação de aplicação', async () => {
    const { legalDeadlines } = require('../storage/repositories');
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    await assert.rejects(
      () => legalDeadlines.insert(pool, { id: 'ld-origintype-invalido', processId: 'proc-h1b-1', origin: 'x', date: '2026-01-01', originType: 'NAO_EXISTE', status: 'ativo', version: 1 }),
      /check constraint|violates/i
    );
    await pool.end();
  });

  // K. optimistic concurrency por deadline (linha própria, não a version global do blob) -------------
  test('[H1B-K] legalDeadlines: concorrência real via storage.readStore()/writeStore() — versão por linha, uma vence e a outra recebe StoreConflictError', async () => {
    const { StoreConflictError } = require('../storage/errors');
    const a = await readStore();
    const b = await readStore();
    const deadlineA = a.records.legalDeadlines.find(d => d.id === createdDeadlineId);
    const deadlineB = b.records.legalDeadlines.find(d => d.id === createdDeadlineId);
    deadlineA.origin = 'origem A'; deadlineA.version += 1; deadlineA.updatedAt = new Date().toISOString();
    await writeStore(a);
    deadlineB.origin = 'origem B'; deadlineB.version += 1; deadlineB.updatedAt = new Date().toISOString();
    await assert.rejects(() => writeStore(b), StoreConflictError);
    const reread = await readStore();
    assert.equal(reread.records.legalDeadlines.find(d => d.id === createdDeadlineId).origin, 'origem A', 'apenas a escrita vencedora foi persistida');
  });

  // L. transação deadline + audit: as duas persistidas juntas ------------------------------------------
  test('[H1B-L] transação: criar Legal Deadline persiste o registro E o evento de auditoria juntos, na mesma transação', async () => {
    const token = await loginAs('h1b.lider@coevo.local');
    const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-h1b-1', origin: 'Prazo com auditoria', date: '2026-02-01', originType: 'JUDICIAL_PROCESSUAL' } });
    assert.equal(created.status, 201);
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const deadlineRow = await pool.query('SELECT id FROM legal_deadlines WHERE id = $1', [created.body.id]);
    const auditRow = await pool.query("SELECT id FROM audit_log WHERE entity = 'legalDeadlines' AND entity_id = $1 AND action = 'CREATE'", [created.body.id]);
    await pool.end();
    assert.equal(deadlineRow.rows.length, 1);
    assert.equal(auditRow.rows.length, 1, 'evento de auditoria da criação deve existir em audit_log');
  });

  // M. rollback: falha entre a gravação do deadline e do audit não persiste nenhum dos dois -----------
  test('[H1B-M] transação/rollback: falha simulada na gravação do evento de auditoria impede que o Legal Deadline seja persistido (tudo ou nada)', async () => {
    const repositories = require('../storage/repositories');
    const originalAppend = repositories.audit.append;
    repositories.audit.append = async () => { throw new Error('Falha simulada de auditoria (teste M)'); };
    const store = await readStore();
    const deadlineId = 'ld-rollback-teste';
    const auditId = 'audit-rollback-teste';
    store.records.legalDeadlines.push({ id: deadlineId, processId: 'proc-h1b-1', origin: 'não deve persistir', date: '2026-03-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: 'Teste' });
    store.audit.push({ id: auditId, action: 'CREATE', entity: 'legalDeadlines', entityId: deadlineId, responsible: 'Teste', date: new Date().toISOString(), reason: 'teste', before: null, after: {}, correlationId: 'corr-rollback' });
    try {
      await assert.rejects(() => writeStore(store), /Falha simulada de auditoria/);
    } finally {
      repositories.audit.append = originalAppend;
    }
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const deadlineRow = await pool.query('SELECT id FROM legal_deadlines WHERE id = $1', [deadlineId]);
    const auditRow = await pool.query('SELECT id FROM audit_log WHERE id = $1', [auditId]);
    await pool.end();
    assert.equal(deadlineRow.rows.length, 0, 'Legal Deadline não deve existir — transação inteira revertida');
    assert.equal(auditRow.rows.length, 0, 'evento de auditoria não deve existir — transação inteira revertida');
  });

  // N. reabertura -----------------------------------------------------------------------------------
  test('[H1B-N] legalDeadlines: reabertura (status volta a "ativo") exige reason e é persistida na tabela relacional', async () => {
    const token = await loginAs('h1b.lider@coevo.local');
    const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-h1b-1', origin: 'Prazo para reabrir', date: '2026-04-01', originType: 'JUDICIAL_PROCESSUAL' } });
    const id = created.body.id;
    await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'cumprido', reason: 'Cumprido para teste' } });
    const withoutReason = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'ativo' } });
    assert.equal(withoutReason.status, 422, 'reabertura sem reason deve ser rejeitada');
    const reopened = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'ativo', reason: 'Reaberto para teste H1B' } });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.status, 'ativo');
  });

  // O. archive/restore --------------------------------------------------------------------------------
  test('[H1B-O] legalDeadlines: archive (DELETE) e restore preservam a linha na tabela relacional (soft-delete via deletedAt)', async () => {
    const token = await loginAs('h1b.lider@coevo.local');
    const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-h1b-1', origin: 'Prazo para arquivar', date: '2026-05-01', originType: 'JUDICIAL_PROCESSUAL' } });
    const id = created.body.id;
    const archived = await api('DELETE', `/api/entities/legalDeadlines/${id}`, { token });
    assert.equal(archived.status, 200);
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const afterArchive = await pool.query('SELECT deleted_at FROM legal_deadlines WHERE id = $1', [id]);
    assert.ok(afterArchive.rows[0].deleted_at, 'deleted_at deve estar preenchido após archive');
    // "restore" só está na alçada de diretoria (ROLES.lider não inclui 'restore') — RBAC pré-existente,
    // inalterado por H1B.
    const tokenDiretoria = await loginAs('h1b.diretoria@coevo.local');
    const restored = await api('POST', `/api/entities/legalDeadlines/${id}/restore`, { token: tokenDiretoria });
    assert.equal(restored.status, 200);
    const afterRestore = await pool.query('SELECT deleted_at FROM legal_deadlines WHERE id = $1', [id]);
    await pool.end();
    assert.equal(afterRestore.rows[0].deleted_at, null, 'deleted_at deve voltar a null após restore — linha nunca é fisicamente removida');
  });

  // P. Agenda ------------------------------------------------------------------------------------------
  test('[H1B-P] Agenda: GET /api/agenda-items inclui Legal Deadline lido da tabela relacional', async () => {
    const token = await loginAs('h1b.lider@coevo.local');
    const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-h1b-1', origin: 'Prazo na agenda', date: '2026-06-01', originType: 'JUDICIAL_PROCESSUAL' } });
    const agenda = await api('GET', '/api/agenda-items', { token });
    assert.equal(agenda.status, 200);
    assert.ok(agenda.body.items.some(item => item.entityType === 'legalDeadline' && item.entityId === created.body.id));
  });

  // Q. Atenção -----------------------------------------------------------------------------------------
  test('[H1B-Q] Atenção: GET /api/attention reflete Legal Deadline vencido lido da tabela relacional', async () => {
    const token = await loginAs('h1b.lider@coevo.local');
    const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-h1b-1', origin: 'Prazo vencido', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
    const attention = await api('GET', '/api/attention', { token });
    assert.equal(attention.status, 200);
    assert.ok(attention.body.items.some(item => item.entityId === created.body.id && item.category === 'OVERDUE'));
  });

  // R. Minha Semana ------------------------------------------------------------------------------------
  test('[H1B-R] Minha Semana: GET /api/my-week só lista Legal Deadline cujo responsibleUserId é o usuário logado', async () => {
    const token = await loginAs('h1b.lider@coevo.local');
    const store = await readStore();
    const me = store.users.find(u => u.email === 'h1b.lider@coevo.local');
    const civilWeek = require('../server').civilWeekWindow ? require('../server').civilWeekWindow() : null;
    const dateInWeek = civilWeek ? civilWeek.start : new Date().toISOString().slice(0, 10);
    const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-h1b-1', origin: 'Prazo minha semana', date: dateInWeek, originType: 'JUDICIAL_PROCESSUAL', responsibleUserId: me.id } });
    assert.equal(created.status, 201);
    const myWeek = await api('GET', '/api/my-week', { token });
    assert.equal(myWeek.status, 200);
    assert.ok(myWeek.body.items.some(item => item.entityId === created.body.id));
  });

  // S/T. scope companyId/speId — dormentes hoje (nunca populados); scoped() nega por ausência de
  // department quando não há escopo global, o que já cobre a segregação departamental efetivamente
  // exercida em produção (ver matriz de normalização H1B).
  // U. TI segregado do Jurídico ----------------------------------------------------------------------
  test('[H1B-U] RBAC: usuário de TI não pode ler/criar Legal Deadline do processo do Jurídico (segregação departamental preservada)', async () => {
    const tokenTi = await loginAs('h1b.ti@coevo.local');
    const res = await api('POST', '/api/entities/legalDeadlines', { token: tokenTi, json: { processId: 'proc-h1b-1', origin: 'x', date: '2026-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
    assert.equal(res.status, 403);
  });

  // V. technical admin segregado --------------------------------------------------------------------
  test('[H1B-V] RBAC: administrador técnico não é superusuário de conteúdo jurídico (allowedContent nega, mesmo com tabelas relacionais)', async () => {
    const tokenAdmin = await loginAs('h1b.admin@coevo.local');
    const res = await api('POST', '/api/entities/legalDeadlines', { token: tokenAdmin, json: { processId: 'proc-h1b-1', origin: 'x', date: '2026-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
    assert.equal(res.status, 403);
  });

  // W. audit append-only -------------------------------------------------------------------------------
  test('[H1B-W] audit_log: append-only — múltiplas mutações no mesmo Legal Deadline geram múltiplos eventos, nenhum é sobrescrito', async () => {
    const token = await loginAs('h1b.lider@coevo.local');
    const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-h1b-1', origin: 'Prazo auditado', date: '2026-07-01', originType: 'JUDICIAL_PROCESSUAL' } });
    await api('PATCH', `/api/entities/legalDeadlines/${created.body.id}`, { token, json: { origin: 'atualizado 1' } });
    await api('PATCH', `/api/entities/legalDeadlines/${created.body.id}`, { token, json: { origin: 'atualizado 2' } });
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const { rows } = await pool.query("SELECT action FROM audit_log WHERE entity = 'legalDeadlines' AND entity_id = $1 ORDER BY date", [created.body.id]);
    await pool.end();
    assert.deepEqual(rows.map(r => r.action), ['CREATE', 'UPDATE', 'UPDATE'], 'cada mutação gera um evento novo — nenhum é sobrescrito');
  });

  // X/Y/Z. scripts/migrate-h1b-data.js — dry-run, importação real e idempotência ------------------------
  test('[H1B-X/Y/Z] migrate-h1b-data: dry-run reporta sem gravar; importação real popula as tabelas; reimportação é idempotente (não duplica)', async () => {
    // Banco isolado e independente do resto da suíte, com um app_store H1A "cru" (sem 004 ainda migrado
    // no sentido de dado já extraído) para simular exatamente o cenário do runbook de cutover.
    const isolatedDbName = `patrono_h1b_migrate_test_${Date.now()}`;
    const admin = new Pool({ connectionString: TEST_DATABASE_URL });
    await admin.query(`CREATE DATABASE ${isolatedDbName}`);
    await admin.end();
    const isolatedUrl = TEST_DATABASE_URL.replace(/\/[^/]+$/, `/${isolatedDbName}`);
    try {
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = isolatedUrl;
      delete require.cache[require.resolve('../scripts/migrate')];
      const { run: migrate } = require('../scripts/migrate');
      await migrate();

      const seedPool = new Pool({ connectionString: isolatedUrl });
      const blob = {
        users: [{ id: 'usr-seed-1', name: 'Seed 1', email: 'seed1@coevo.local', role: 'lider', department: 'Jurídico', mfa: false }],
        records: {
          processos: [{ id: 'proc-seed-1', source: 'monday', department: 'Jurídico', title: 'Processo seed', deletedAt: null, version: 1 }],
          legalDeadlines: [{ id: 'ld-seed-1', processId: 'proc-seed-1', origin: 'seed', date: '2026-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', responsibleUserId: 'usr-seed-1', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: 'Seed' }]
        },
        audit: [{ id: 'audit-seed-1', action: 'CREATE', entity: 'legalDeadlines', entityId: 'ld-seed-1', responsible: 'Seed', date: new Date().toISOString(), reason: 'seed', before: null, after: {}, correlationId: 'corr-seed-1' }],
        departments: [], financials: [], agenda: [], committees: [], compliance: [], registrationRequests: [], mondayRuns: []
      };
      await seedPool.query('INSERT INTO app_store (id, data, version) VALUES (1, $1, 1)', [JSON.stringify(blob)]);
      await seedPool.end();

      delete require.cache[require.resolve('../scripts/migrate-h1b-data')];
      const { run: migrateH1bData } = require('../scripts/migrate-h1b-data');

      // X: dry-run nunca grava
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;
      await migrateH1bData(['--dry-run']);
      assert.notEqual(process.exitCode, 1, 'dry-run com dado consistente não deve reportar falha');
      const checkPool1 = new Pool({ connectionString: isolatedUrl });
      const emptyCheck = await checkPool1.query('SELECT count(*)::int AS n FROM app_users');
      await checkPool1.end();
      assert.equal(emptyCheck.rows[0].n, 0, '--dry-run nunca grava nada, mesmo com dado válido');

      // Y: importação real popula as tabelas e faz o cutover (remove as 4 chaves do blob)
      process.exitCode = undefined;
      await migrateH1bData([]);
      assert.notEqual(process.exitCode, 1, 'importação real com dado consistente deve ter sucesso');
      const checkPool2 = new Pool({ connectionString: isolatedUrl });
      const usersAfter = await checkPool2.query('SELECT count(*)::int AS n FROM app_users');
      const deadlinesAfter = await checkPool2.query('SELECT count(*)::int AS n FROM legal_deadlines');
      const blobAfter = await checkPool2.query('SELECT data FROM app_store WHERE id = 1');
      const markerAfter = await checkPool2.query('SELECT key FROM data_migrations WHERE key = $1', ['h1b_core_relational_cutover']);
      await checkPool2.end();
      assert.equal(usersAfter.rows[0].n, 1);
      assert.equal(deadlinesAfter.rows[0].n, 1);
      assert.equal(Boolean(blobAfter.rows[0].data.users), false, 'cutover deve remover "users" do blob');
      assert.equal(Boolean(blobAfter.rows[0].data.records && blobAfter.rows[0].data.records.legalDeadlines), false, 'cutover deve remover "records.legalDeadlines" do blob');
      assert.equal(markerAfter.rows.length, 1, 'marcador de cutover deve existir depois da importação real bem-sucedida');

      // Z: reimportar sem --force é recusado (marcador já presente); idempotência real é ON CONFLICT DO
      // NOTHING (não duplica) e o marcador continua único (upsert, nunca uma segunda linha)
      process.exitCode = undefined;
      await migrateH1bData([]);
      assert.equal(process.exitCode, 1, 'reimportação sem --force deve ser recusada (cutover já concluído)');

      process.exitCode = undefined;
      await migrateH1bData(['--force']);
      assert.notEqual(process.exitCode, 1);
      const checkPool3 = new Pool({ connectionString: isolatedUrl });
      const usersAfterForce = await checkPool3.query('SELECT count(*)::int AS n FROM app_users');
      const markerCountAfterForce = await checkPool3.query('SELECT count(*)::int AS n FROM data_migrations WHERE key = $1', ['h1b_core_relational_cutover']);
      await checkPool3.end();
      assert.equal(usersAfterForce.rows[0].n, 1, '--force reimporta idempotentemente — não duplica registros já existentes');
      assert.equal(markerCountAfterForce.rows[0].n, 1, 'o marcador de cutover nunca duplica — upsert, sempre uma única linha por chave');

      process.exitCode = originalExitCode;
      process.env.DATABASE_URL = previousDatabaseUrl;
    } finally {
      const admin2 = new Pool({ connectionString: TEST_DATABASE_URL });
      await admin2.query(`DROP DATABASE IF EXISTS ${isolatedDbName} WITH (FORCE)`);
      await admin2.end();
    }
  });

  test('[H1B] migrate-h1b-data: órfão (processId inexistente) bloqueia a importação real inteira — nenhum dado é gravado', async () => {
    const isolatedDbName = `patrono_h1b_orphan_test_${Date.now()}`;
    const admin = new Pool({ connectionString: TEST_DATABASE_URL });
    await admin.query(`CREATE DATABASE ${isolatedDbName}`);
    await admin.end();
    const isolatedUrl = TEST_DATABASE_URL.replace(/\/[^/]+$/, `/${isolatedDbName}`);
    try {
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = isolatedUrl;
      delete require.cache[require.resolve('../scripts/migrate')];
      const { run: migrate } = require('../scripts/migrate');
      await migrate();

      const seedPool = new Pool({ connectionString: isolatedUrl });
      const blob = {
        users: [{ id: 'usr-seed-2', name: 'Seed 2', email: 'seed2@coevo.local', role: 'lider', department: 'Jurídico', mfa: false }],
        records: { processos: [], legalDeadlines: [{ id: 'ld-orfao', processId: 'proc-nao-existe', origin: 'x', date: '2026-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', version: 1 }] },
        audit: [], departments: [], financials: [], agenda: [], committees: [], compliance: [], registrationRequests: [], mondayRuns: []
      };
      await seedPool.query('INSERT INTO app_store (id, data, version) VALUES (1, $1, 1)', [JSON.stringify(blob)]);
      await seedPool.end();

      delete require.cache[require.resolve('../scripts/migrate-h1b-data')];
      const { run: migrateH1bData } = require('../scripts/migrate-h1b-data');
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;
      await migrateH1bData([]);
      assert.equal(process.exitCode, 1, 'órfão crítico deve abortar a importação real');

      const checkPool = new Pool({ connectionString: isolatedUrl });
      const usersAfter = await checkPool.query('SELECT count(*)::int AS n FROM app_users');
      await checkPool.end();
      assert.equal(usersAfter.rows[0].n, 0, 'nenhum dado deve ser gravado quando a validação crítica falha — nunca estado parcial');
      process.exitCode = originalExitCode;
      process.env.DATABASE_URL = previousDatabaseUrl;
    } finally {
      const admin2 = new Pool({ connectionString: TEST_DATABASE_URL });
      await admin2.query(`DROP DATABASE IF EXISTS ${isolatedDbName} WITH (FORCE)`);
      await admin2.end();
    }
  });

  // ================================================================================================
  // Marcador explícito de cutover H1B (revisão final) — "migration de SCHEMA" (004 aplicada,
  // schema_migrations) é DIFERENTE de "migração de DADOS" (users/legalProcesses/legalDeadlines/audit
  // efetivamente extraídos do app_store, marcados em `data_migrations`). Estes testes usam uma instância
  // TOTALMENTE ISOLADA de `storage/index.js` (require.cache limpo, nunca tocando `../server` — que
  // continua com sua própria instância de storage, configurada pelo test.before() do arquivo) para
  // exercitar `storage.configure()`/`storage.init()` sem afetar o restante da suíte.
  // ================================================================================================
  async function withIsolatedDb(prefix, fn) {
    const dbName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = new Pool({ connectionString: TEST_DATABASE_URL });
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const url = TEST_DATABASE_URL.replace(/\/[^/]+$/, `/${dbName}`);
    try {
      return await fn(url);
    } finally {
      const admin2 = new Pool({ connectionString: TEST_DATABASE_URL });
      await admin2.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin2.end();
    }
  }

  function freshStorageModule() {
    delete require.cache[require.resolve('../storage')];
    return require('../storage');
  }

  const PRECUTOVER_BLOB = {
    users: [{ id: 'usr-precutover', name: 'Pre Cutover', email: 'precutover@coevo.local', role: 'lider', department: 'Jurídico', mfa: false }],
    records: {
      processos: [{ id: 'proc-precutover', source: 'monday', department: 'Jurídico', title: 'Processo pré-cutover', deletedAt: null, version: 1 }],
      legalDeadlines: []
    },
    audit: [],
    departments: [], financials: [], agenda: [], committees: [], compliance: [], registrationRequests: [], mondayRuns: []
  };

  test('[H1B-cutover A/B/C] migration 004 aplicada SEM cutover: storage.init() falha (fail-closed), app_users permanece vazio, as 4 coleções continuam no app_store', async () => {
    await withIsolatedDb('patrono_h1b_cutover_abc', async isolatedUrl => {
      delete require.cache[require.resolve('../scripts/migrate')];
      const { run: migrate } = require('../scripts/migrate');
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = isolatedUrl;
      await migrate();
      process.env.DATABASE_URL = previousDatabaseUrl;

      const seedPool = new Pool({ connectionString: isolatedUrl });
      await seedPool.query('INSERT INTO app_store (id, data, version) VALUES (1, $1, 1)', [JSON.stringify(PRECUTOVER_BLOB)]);
      await seedPool.end();

      const isolatedStorage = freshStorageModule();
      isolatedStorage.configure({ databaseUrl: isolatedUrl, nodeEnv: 'test', seed: { users: [] } });

      // A: storage.init() falha explicitamente — schema (004) aplicado não é o mesmo que dados migrados.
      await assert.rejects(() => isolatedStorage.init(), /cutover|migrate:h1b:data/i);
      await isolatedStorage.close();

      const checkPool = new Pool({ connectionString: isolatedUrl });
      // B: nenhum bootstrap automático de app_users
      const usersCount = await checkPool.query('SELECT count(*)::int AS n FROM app_users');
      assert.equal(usersCount.rows[0].n, 0, 'nenhum usuário deve ser inserido em app_users antes do cutover');
      // C: as 4 coleções ainda existem no app_store, intactas
      const blobRow = await checkPool.query('SELECT data FROM app_store WHERE id = 1');
      await checkPool.end();
      assert.equal(blobRow.rows[0].data.users.length, 1);
      assert.equal(blobRow.rows[0].data.records.processos.length, 1);
    });
  });

  test('[H1B-cutover D/E] migrate-h1b-data concluído grava o marcador; storage.init() passa a funcionar normalmente depois', async () => {
    await withIsolatedDb('patrono_h1b_cutover_de', async isolatedUrl => {
      delete require.cache[require.resolve('../scripts/migrate')];
      const { run: migrate } = require('../scripts/migrate');
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = isolatedUrl;
      await migrate();

      const seedPool = new Pool({ connectionString: isolatedUrl });
      await seedPool.query('INSERT INTO app_store (id, data, version) VALUES (1, $1, 1)', [JSON.stringify(PRECUTOVER_BLOB)]);
      await seedPool.end();

      delete require.cache[require.resolve('../scripts/migrate-h1b-data')];
      const { run: migrateH1bData } = require('../scripts/migrate-h1b-data');
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;
      await migrateH1bData([]);
      assert.notEqual(process.exitCode, 1, 'cutover deve ter sucesso com dado consistente');
      process.exitCode = originalExitCode;
      process.env.DATABASE_URL = previousDatabaseUrl;

      // D: marcador gravado
      const checkPool = new Pool({ connectionString: isolatedUrl });
      const marker = await checkPool.query('SELECT key FROM data_migrations WHERE key = $1', ['h1b_core_relational_cutover']);
      await checkPool.end();
      assert.equal(marker.rows.length, 1);

      // E: storage.init() agora passa
      const isolatedStorage = freshStorageModule();
      isolatedStorage.configure({ databaseUrl: isolatedUrl, nodeEnv: 'test', seed: { users: [] } });
      await isolatedStorage.init();
      const health = await isolatedStorage.healthcheck();
      assert.equal(health.schemaReady, true, 'depois do cutover, schemaReady deve refletir estado pronto');
      await isolatedStorage.close();
    });
  });

  test('[H1B-cutover F/G/H] falha no meio da transação de cutover reverte TUDO — tabelas relacionais, blob e marcador', async () => {
    await withIsolatedDb('patrono_h1b_cutover_fgh', async isolatedUrl => {
      delete require.cache[require.resolve('../scripts/migrate')];
      const { run: migrate } = require('../scripts/migrate');
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = isolatedUrl;
      await migrate();

      // Um Legal Deadline com `date` inválida para a coluna SQL `date` (não checado por
      // validateLegalDeadlines — só orphan/enum/duplicado são validados ali) passa pela validação
      // crítica pré-voo, mas falha no INSERT, DEPOIS de users/legal_processes/o primeiro deadline já
      // terem sido inseridos na MESMA transação — prova que o rollback desfaz também o que já havia
      // "sucedido" antes da falha, não só a linha que efetivamente falhou.
      const blob = {
        users: [{ id: 'usr-rollback', name: 'Rollback', email: 'rollback@coevo.local', role: 'lider', department: 'Jurídico', mfa: false }],
        records: {
          processos: [{ id: 'proc-rollback', source: 'monday', department: 'Jurídico', title: 'p', deletedAt: null, version: 1 }],
          legalDeadlines: [
            { id: 'ld-rollback-ok', processId: 'proc-rollback', origin: 'ok', date: '2026-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', version: 1 },
            { id: 'ld-rollback-bad', processId: 'proc-rollback', origin: 'bad', date: 'data-invalida-para-sql', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', version: 1 }
          ]
        },
        audit: [], departments: [], financials: [], agenda: [], committees: [], compliance: [], registrationRequests: [], mondayRuns: []
      };
      const seedPool = new Pool({ connectionString: isolatedUrl });
      await seedPool.query('INSERT INTO app_store (id, data, version) VALUES (1, $1, 1)', [JSON.stringify(blob)]);
      await seedPool.end();

      delete require.cache[require.resolve('../scripts/migrate-h1b-data')];
      const { run: migrateH1bData } = require('../scripts/migrate-h1b-data');
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;
      await migrateH1bData([]);
      assert.equal(process.exitCode, 1, 'a falha de INSERT deve abortar a migração com exit code de erro');
      process.exitCode = originalExitCode;
      process.env.DATABASE_URL = previousDatabaseUrl;

      const checkPool = new Pool({ connectionString: isolatedUrl });
      const usersCount = await checkPool.query('SELECT count(*)::int AS n FROM app_users');
      const processesCount = await checkPool.query('SELECT count(*)::int AS n FROM legal_processes');
      const deadlinesCount = await checkPool.query('SELECT count(*)::int AS n FROM legal_deadlines');
      const marker = await checkPool.query('SELECT key FROM data_migrations WHERE key = $1', ['h1b_core_relational_cutover']);
      const blobRow = await checkPool.query('SELECT data FROM app_store WHERE id = 1');
      await checkPool.end();
      // F/G: nada parcialmente inserido — nem o que "teria dado certo" antes da linha que falhou
      assert.equal(usersCount.rows[0].n, 0, 'ROLLBACK deve desfazer o usuário já inserido antes da falha');
      assert.equal(processesCount.rows[0].n, 0, 'ROLLBACK deve desfazer o processo já inserido antes da falha');
      assert.equal(deadlinesCount.rows[0].n, 0, 'ROLLBACK deve desfazer o Legal Deadline válido já inserido antes da falha');
      // H: marcador ausente — nunca gravado se a transação não chegou a COMMIT
      assert.equal(marker.rows.length, 0, 'marcador de cutover não pode existir se a transação foi revertida');
      // blob nunca é alterado quando a transação falha
      assert.equal(blobRow.rows[0].data.users.length, 1, 'blob deve permanecer intacto — a transação nunca chegou a cortar o blob');
    });
  });

  test('[H1B-cutover J/K] healthcheck() reporta schemaReady:false antes do cutover e schemaReady:true depois', async () => {
    await withIsolatedDb('patrono_h1b_cutover_jk', async isolatedUrl => {
      delete require.cache[require.resolve('../scripts/migrate')];
      const { run: migrate } = require('../scripts/migrate');
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = isolatedUrl;
      await migrate();

      const seedPool = new Pool({ connectionString: isolatedUrl });
      await seedPool.query('INSERT INTO app_store (id, data, version) VALUES (1, $1, 1)', [JSON.stringify(PRECUTOVER_BLOB)]);
      await seedPool.end();

      // J: antes do cutover — banco alcançável, mas não pronto
      const preCutoverStorage = freshStorageModule();
      preCutoverStorage.configure({ databaseUrl: isolatedUrl, nodeEnv: 'test', seed: { users: [] } });
      const healthBefore = await preCutoverStorage.healthcheck();
      assert.equal(healthBefore.reachable, true);
      assert.equal(healthBefore.schemaReady, false, 'antes do cutover, a aplicação não deve ser reportada como pronta');
      await preCutoverStorage.close();

      delete require.cache[require.resolve('../scripts/migrate-h1b-data')];
      const { run: migrateH1bData } = require('../scripts/migrate-h1b-data');
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;
      await migrateH1bData([]);
      assert.notEqual(process.exitCode, 1);
      process.exitCode = originalExitCode;
      process.env.DATABASE_URL = previousDatabaseUrl;

      // K: depois do cutover — pronto
      const postCutoverStorage = freshStorageModule();
      postCutoverStorage.configure({ databaseUrl: isolatedUrl, nodeEnv: 'test', seed: { users: [] } });
      const healthAfter = await postCutoverStorage.healthcheck();
      assert.equal(healthAfter.reachable, true);
      assert.equal(healthAfter.schemaReady, true, 'depois do cutover, a aplicação deve ser reportada como pronta');
      await postCutoverStorage.close();
    });
  });
}
