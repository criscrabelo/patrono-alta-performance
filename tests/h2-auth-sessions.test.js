// Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): testes de
// autenticação individual, MFA individual e sessões persistentes. Mesma técnica de
// tests/h1b-core-relational.test.js — servidor HTTP real (`handler` exportado de server.js) rodando
// sobre um banco Postgres ISOLADO e próprio deste arquivo (evita colidir com outros arquivos de teste
// que rodam em paralelo).
//
// Só roda de fato quando TEST_DATABASE_URL está definida (nunca aponta para produção). Sem ela, todo o
// arquivo é pulado explicitamente — mesmo padrão já usado em H1A/H1B (docs/PRODUCTION_GATE.md, seção 28).
const test = require('node:test');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  test('[H2] testes pulados — TEST_DATABASE_URL não configurada neste ambiente (ver docs/PRODUCTION_GATE.md, seção 28)', { skip: true }, () => {});
} else {
  const assert = require('node:assert/strict');
  const http = require('node:http');
  const { Pool } = require('pg');
  const authCrypto = require('../auth/crypto');

  process.env.COEVO_DEMO_PASSWORD = 'h2-integration-test-password-0000000000';
  process.env.COEVO_SESSION_MS = '300000';
  process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY || 'test-mfa-encryption-key-at-least-32-characters';
  process.env.NODE_ENV = 'test';
  delete process.env.MONDAY_TOKEN;

  const ISOLATED_DB_NAME = `patrono_h2_auth_test_${process.pid}_${Date.now()}`;
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

  // Recarrega server.js (e a ponte de storage) do zero — cada chamada produz um MÓDULO independente
  // (seu próprio `backend`/Pool em storage/index.js), simulando um PROCESSO/instância separado ainda
  // que rodando dentro do mesmo processo de teste. Usado pelo teste de múltiplas instâncias (item 34).
  function loadFreshServerModule() {
    delete require.cache[require.resolve('../server')];
    delete require.cache[require.resolve('../storage')];
    // Sprint 2, Hardening H3 (docs/DECISIONS.md, PROD-H3-01): auth/rate-limit.js faz
    // `const storage = require('../storage')` uma única vez, na primeira vez que é carregado — sem
    // limpar seu cache aqui, ele mantém uma referência ao módulo/pool ANTIGO (já fechado por
    // storage.close() acima), e toda checagem de rate limit passa a falhar (fail-closed → 429
    // permanente) para qualquer teste que rode depois de um "restart"/nova instância neste arquivo.
    delete require.cache[require.resolve('../auth/rate-limit')];
    return require('../server');
  }

  const DEV_SEED_TOTP_SECRET = process.env.COEVO_SEED_TOTP_SECRET || 'JBSWY3DPEHPK3PXP';

  let server, baseUrl, storage, readStore, writeStore, serverModule;

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
      let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { status: res.status, body };
    };
  }

  let api;

  async function loginRaw(email, password) {
    return api('POST', '/api/auth/login', { json: { email, password } });
  }

  function totpCodeFor(secret = DEV_SEED_TOTP_SECRET) { return authCrypto.totpAt(secret, Date.now()); }

  async function loginAs(email, password = process.env.COEVO_DEMO_PASSWORD, mfaSecret = DEV_SEED_TOTP_SECRET) {
    const login = await loginRaw(email, password);
    assert.equal(login.status, 200, `login deveria aceitar credenciais válidas para ${email}: ${JSON.stringify(login.body)}`);
    if (login.body.token) return login.body.token;
    assert.equal(login.body.mfaRequired, true);
    const mfa = await api('POST', '/api/auth/mfa/verify', { json: { challenge: login.body.challenge, code: totpCodeFor(mfaSecret) } });
    assert.equal(mfa.status, 200, `MFA deveria ser aceito para ${email}: ${JSON.stringify(mfa.body)}`);
    return mfa.body.token;
  }

  const EMAILS = {
    semMfa: 'h2.sem-mfa@coevo.local',
    comMfaA: 'h2.com-mfa-a@coevo.local',
    comMfaB: 'h2.com-mfa-b@coevo.local',
    aprovador: 'h2.aprovador@coevo.local'
  };
  const SECRET_A = authCrypto.generateTotpSecret();
  const SECRET_B = authCrypto.generateTotpSecret();
  const SECRET_APROVADOR = authCrypto.generateTotpSecret();

  test.before(async () => {
    await createIsolatedDatabase();
    delete require.cache[require.resolve('../scripts/migrate')];
    const { run: migrate } = require('../scripts/migrate');
    await migrate();
    const cutoverPool = new Pool({ connectionString: isolatedDatabaseUrl });
    await cutoverPool.query("INSERT INTO data_migrations (key) VALUES ('h1b_core_relational_cutover') ON CONFLICT (key) DO NOTHING");
    await cutoverPool.end();

    serverModule = loadFreshServerModule();
    ({ readStore, writeStore, storage } = serverModule);
    await storage.init();

    const store = await readStore();
    store.users.push(
      // Colaborador comum — sem MFA (requireMfa() é false para 'colaborador').
      { id: 'usr-h2-sem-mfa', name: 'H2 Sem MFA', email: EMAILS.semMfa, role: 'colaborador', department: 'Jurídico', mfa: false, passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 },
      // Dois líderes com MFA individual JÁ confirmado, cada um com seu PRÓPRIO segredo — prova que o
      // segredo de A nunca valida o código de B (item de teste "MFA secret de A nunca valida B").
      { id: 'usr-h2-mfa-a', name: 'H2 Líder A', email: EMAILS.comMfaA, role: 'lider', department: 'Jurídico', mfa: true, passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: true, mfaMethod: 'totp', mfaSecretEncrypted: authCrypto.encryptSecret(SECRET_A), mfaEnrolledAt: new Date().toISOString(), failedLoginCount: 0 },
      { id: 'usr-h2-mfa-b', name: 'H2 Líder B', email: EMAILS.comMfaB, role: 'lider', department: 'TI', mfa: true, passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: true, mfaMethod: 'totp', mfaSecretEncrypted: authCrypto.encryptSecret(SECRET_B), mfaEnrolledAt: new Date().toISOString(), failedLoginCount: 0 },
      // Aprovador (diretoria — `allowed(user,'*','approve')`, a MESMA alçada já usada para aprovar
      // cadastro) usado pelos testes do fluxo administrativo de primeiro acesso/reset (item 3 do escopo).
      { id: 'usr-h2-aprovador', name: 'H2 Aprovador', email: EMAILS.aprovador, role: 'diretoria', department: null, mfa: true, passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: true, mfaMethod: 'totp', mfaSecretEncrypted: authCrypto.encryptSecret(SECRET_APROVADOR), mfaEnrolledAt: new Date().toISOString(), failedLoginCount: 0 }
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

  // Sprint 2, Hardening H3 (docs/DECISIONS.md, PROD-H3-01): estes testes exercitam login/MFA/forgot-
  // password/reset-token repetidas vezes por identidade/IP — comportamento legítimo de teste, não abuso
  // — mas cairia nos mesmos buckets de rate limit que H3 introduziu. H3 tem sua PRÓPRIA suíte dedicada
  // (tests/h3-rate-limiting.test.js); aqui, zera os buckets antes de cada teste para que este arquivo
  // continue validando exclusivamente a semântica de H2, sem interferência cruzada entre casos de teste.
  test.beforeEach(async () => {
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    await pool.query('DELETE FROM rate_limit_buckets');
    await pool.end();
  });

  // --- A. senha correta/incorreta -----------------------------------------------------------------
  test('[H2-A] login com senha correta é aceito; com senha incorreta é rejeitado com 401 genérico', async () => {
    const ok = await loginRaw(EMAILS.semMfa, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);
    const bad = await loginRaw(EMAILS.semMfa, 'senha-completamente-errada');
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, 'Credenciais inválidas');
  });

  test('[H2-A] login com e-mail inexistente recebe a mesma mensagem genérica (não revela se o e-mail existe)', async () => {
    const res = await loginRaw('nao-existe@coevo.local', 'qualquer-coisa');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Credenciais inválidas');
  });

  // --- B. hash de senha nunca exposto --------------------------------------------------------------
  test('[H2-B] GET /api/me nunca devolve passwordHash nem mfaSecretEncrypted', async () => {
    const token = await loginAs(EMAILS.semMfa);
    const me = await api('GET', '/api/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.passwordHash, undefined);
    assert.equal(me.body.user.mfaSecretEncrypted, undefined);
  });

  test('[H2-B] senha nunca é armazenada em texto puro no banco (sempre no formato scrypt$...)', async () => {
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const { rows } = await pool.query('SELECT password_hash FROM app_users WHERE email = $1', [EMAILS.semMfa]);
    await pool.end();
    assert.match(rows[0].password_hash, /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    assert.doesNotMatch(rows[0].password_hash, new RegExp(process.env.COEVO_DEMO_PASSWORD));
  });

  // --- C. temporaryPassword força troca ------------------------------------------------------------
  test('[H2-C] temporaryPassword:true restringe a conta a rotas de autogestão (ACCOUNT_SETUP_REQUIRED) até a troca de senha', async () => {
    const store = await readStore();
    store.users.push({ id: 'usr-h2-temp', name: 'H2 Temporário', email: 'h2.temporario@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, passwordHash: authCrypto.hashPassword('SenhaTemporaria#123'), temporaryPassword: true, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
    await writeStore(store);

    const token = await loginAs('h2.temporario@coevo.local', 'SenhaTemporaria#123');
    const blocked = await api('GET', '/api/me', { token }); // /api/me está na allowlist — deve passar
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.accountSetupRequired, true);
    const businessRoute = await api('GET', '/api/dashboard', { token });
    assert.equal(businessRoute.status, 403);
    assert.equal(businessRoute.body.code, 'ACCOUNT_SETUP_REQUIRED');

    const changed = await api('POST', '/api/auth/change-password', { token, json: { currentPassword: 'SenhaTemporaria#123', newPassword: 'NovaSenhaForte#456' } });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.ok(changed.body.token, 'change-password deve emitir uma nova sessão já sem a restrição de setup');
    const afterChange = await api('GET', '/api/dashboard', { token: changed.body.token });
    assert.equal(afterChange.status, 200, 'após a troca de senha, a conta deixa de exigir configuração e acessa conteúdo normalmente');

    // A senha temporária não pode ser reaproveitada como a nova senha permanente.
    const store2 = await readStore();
    store2.users.push({ id: 'usr-h2-temp2', name: 'H2 Temporário 2', email: 'h2.temporario2@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, passwordHash: authCrypto.hashPassword('SenhaTemporaria#123'), temporaryPassword: true, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
    await writeStore(store2);
    const token2 = await loginAs('h2.temporario2@coevo.local', 'SenhaTemporaria#123');
    const reused = await api('POST', '/api/auth/change-password', { token: token2, json: { currentPassword: 'SenhaTemporaria#123', newPassword: 'SenhaTemporaria#123' } });
    assert.equal(reused.status, 422, 'a nova senha não pode ser igual à senha temporária/atual');
  });

  // --- D. MFA individual (nunca global) ------------------------------------------------------------
  test('[H2-D] MFA é individual: o segredo do usuário A nunca valida o código do usuário B', async () => {
    const loginA = await loginRaw(EMAILS.comMfaA, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(loginA.body.mfaRequired, true);
    const codeFromB = totpCodeFor(SECRET_B);
    const crossed = await api('POST', '/api/auth/mfa/verify', { json: { challenge: loginA.body.challenge, code: codeFromB } });
    assert.equal(crossed.status, 401, 'o código TOTP do segredo de B nunca deve validar o desafio de A');
  });

  test('[H2-D] cada usuário com MFA individual loga corretamente com o próprio segredo', async () => {
    const tokenA = await loginAs(EMAILS.comMfaA, process.env.COEVO_DEMO_PASSWORD, SECRET_A);
    const tokenB = await loginAs(EMAILS.comMfaB, process.env.COEVO_DEMO_PASSWORD, SECRET_B);
    assert.ok(tokenA && tokenB && tokenA !== tokenB);
  });

  // --- E. código MFA incorreto/expirado ------------------------------------------------------------
  test('[H2-E] código MFA incorreto é rejeitado sem emitir token', async () => {
    const login = await loginRaw(EMAILS.comMfaA, process.env.COEVO_DEMO_PASSWORD);
    const res = await api('POST', '/api/auth/mfa/verify', { json: { challenge: login.body.challenge, code: '000000' } });
    assert.equal(res.status, 401);
    assert.equal(res.body.token, undefined);
  });

  test('[H2-E] challenge de MFA expirado é rejeitado mesmo com código correto', async () => {
    const login = await loginRaw(EMAILS.comMfaA, process.env.COEVO_DEMO_PASSWORD);
    // O repository de auth_challenges só persiste used_at/attempts em update() (por design — expires_at
    // é imutável após a criação do challenge); para simular expiração, o teste ajusta expires_at
    // diretamente via SQL, não pela ponte relacional (que ignoraria a mudança).
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    await pool.query('UPDATE auth_challenges SET expires_at = now() - interval \'1 second\' WHERE id = $1', [login.body.challenge]);
    await pool.end();
    const res = await api('POST', '/api/auth/mfa/verify', { json: { challenge: login.body.challenge, code: totpCodeFor(SECRET_A) } });
    assert.equal(res.status, 401);
  });

  // --- F. challenge de uso único -------------------------------------------------------------------
  test('[H2-F] challenge de MFA já usado não pode ser reaproveitado', async () => {
    const login = await loginRaw(EMAILS.comMfaA, process.env.COEVO_DEMO_PASSWORD);
    const first = await api('POST', '/api/auth/mfa/verify', { json: { challenge: login.body.challenge, code: totpCodeFor(SECRET_A) } });
    assert.equal(first.status, 200);
    const second = await api('POST', '/api/auth/mfa/verify', { json: { challenge: login.body.challenge, code: totpCodeFor(SECRET_A) } });
    assert.equal(second.status, 401, 'um challenge já confirmado não pode ser reutilizado para emitir uma segunda sessão');
  });

  // --- G/H/I. sessão persistida; hash no banco; token bruto nunca persistido -----------------------
  test('[H2-G/H/I] sessão é persistida em auth_sessions com token_hash — nunca o token bruto', async () => {
    const token = await loginAs(EMAILS.semMfa);
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const { rows } = await pool.query('SELECT token_hash FROM auth_sessions ORDER BY created_at DESC LIMIT 1');
    await pool.end();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, authCrypto.hashToken(token));
    assert.notEqual(rows[0].token_hash, token);
    // Nenhuma linha de auth_sessions contém o token bruto em qualquer coluna.
    const pool2 = new Pool({ connectionString: isolatedDatabaseUrl });
    const all = await pool2.query('SELECT * FROM auth_sessions');
    await pool2.end();
    assert.ok(!JSON.stringify(all.rows).includes(token), 'o token bruto nunca deve aparecer em nenhuma coluna de auth_sessions');
  });

  // --- J. sessão expirada ---------------------------------------------------------------------------
  test('[H2-J] sessão expirada deixa de autenticar (401), sem esperar por logout', async () => {
    const token = await loginAs(EMAILS.semMfa);
    const store = await readStore();
    const tokenHash = authCrypto.hashToken(token);
    const session = store.authSessions.find(s => s.tokenHash === tokenHash);
    assert.ok(session);
    session.expiresAt = new Date(Date.now() - 1000).toISOString();
    await writeStore(store);
    const res = await api('GET', '/api/me', { token });
    assert.equal(res.status, 401);
  });

  // --- K/L. logout e logout-all ---------------------------------------------------------------------
  test('[H2-K] logout revoga a sessão atual — token deixa de funcionar imediatamente', async () => {
    const token = await loginAs(EMAILS.semMfa);
    const before = await api('GET', '/api/me', { token });
    assert.equal(before.status, 200);
    const out = await api('POST', '/api/auth/logout', { token });
    assert.equal(out.status, 200);
    const after = await api('GET', '/api/me', { token });
    assert.equal(after.status, 401, 'logout deve revogar a sessão no servidor, não só "esquecer" o token no cliente');
  });

  test('[H2-L] logout-all revoga TODAS as sessões do usuário, não apenas a atual', async () => {
    const tokenX = await loginAs(EMAILS.semMfa);
    const tokenY = await loginAs(EMAILS.semMfa);
    assert.notEqual(tokenX, tokenY);
    const out = await api('POST', '/api/auth/logout-all', { token: tokenX });
    assert.equal(out.status, 200);
    const checkX = await api('GET', '/api/me', { token: tokenX });
    const checkY = await api('GET', '/api/me', { token: tokenY });
    assert.equal(checkX.status, 401);
    assert.equal(checkY.status, 401, 'logout-all revoga todas as sessões, inclusive as emitidas por outros logins do mesmo usuário');
  });

  // --- M/N. troca/reset de senha revogam sessões anteriores ------------------------------------------
  test('[H2-M] troca de senha invalida sessões emitidas antes da troca (credentialsVersion)', async () => {
    const store = await readStore();
    store.users.push({ id: 'usr-h2-troca', name: 'H2 Troca', email: 'h2.troca@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, passwordHash: authCrypto.hashPassword('SenhaAntiga#111'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
    await writeStore(store);
    const oldToken = await loginAs('h2.troca@coevo.local', 'SenhaAntiga#111');
    const changed = await api('POST', '/api/auth/change-password', { token: oldToken, json: { currentPassword: 'SenhaAntiga#111', newPassword: 'SenhaNova#222' } });
    assert.equal(changed.status, 200);
    const stillOld = await api('GET', '/api/me', { token: oldToken });
    assert.equal(stillOld.status, 401, 'a sessão emitida ANTES da troca de senha deve deixar de funcionar');
    const withNewToken = await api('GET', '/api/me', { token: changed.body.token });
    assert.equal(withNewToken.status, 200, 'a nova sessão emitida pela própria troca de senha continua válida');
  });

  test('[H2-N] reset de senha via token de uso único invalida sessões anteriores e o token não pode ser reutilizado', async () => {
    const store = await readStore();
    store.users.push({ id: 'usr-h2-reset', name: 'H2 Reset', email: 'h2.reset@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, passwordHash: authCrypto.hashPassword('SenhaAntes#111'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
    await writeStore(store);
    const oldToken = await loginAs('h2.reset@coevo.local', 'SenhaAntes#111');

    const forgot = await api('POST', '/api/auth/forgot-password', { json: { email: 'h2.reset@coevo.local' } });
    assert.equal(forgot.status, 200);
    const store2 = await readStore();
    const record = store2.passwordResetTokens.find(t => t.userId === 'usr-h2-reset');
    assert.ok(record, 'forgot-password deve criar um registro em password_reset_tokens (hash apenas)');
    assert.notEqual(record.tokenHash, undefined);

    // O token bruto nunca é devolvido pela API neste repositório (sem canal de e-mail configurado) —
    // para exercitar o fluxo completo, o teste troca o token_hash já persistido por um conhecido, via
    // SQL direto (o repository só persiste `used_at` em update(); `token_hash` é imutável pela ponte,
    // por design — só é definido na criação do token).
    const rawToken = authCrypto.generateOpaqueToken();
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    await pool.query('UPDATE password_reset_tokens SET token_hash = $1 WHERE id = $2', [authCrypto.hashToken(rawToken), record.id]);
    await pool.end();

    const reset = await api('POST', '/api/auth/reset-password', { json: { token: rawToken, newPassword: 'SenhaDepois#222' } });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));

    const oldStillWorks = await api('GET', '/api/me', { token: oldToken });
    assert.equal(oldStillWorks.status, 401, 'reset de senha deve revogar sessões emitidas antes dele');

    const reuse = await api('POST', '/api/auth/reset-password', { json: { token: rawToken, newPassword: 'Outra#333' } });
    assert.equal(reuse.status, 400, 'um token de reset já usado não pode ser reaproveitado');

    const loginWithNew = await loginRaw('h2.reset@coevo.local', 'SenhaDepois#222');
    assert.equal(loginWithNew.status, 200);
  });

  // --- O. deletedAt invalida sessão imediatamente -----------------------------------------------------
  test('[H2-O] usuário inativado (deletedAt) perde acesso imediatamente, sem esperar a expiração da sessão', async () => {
    const store = await readStore();
    store.users.push({ id: 'usr-h2-inativar', name: 'H2 Inativar', email: 'h2.inativar@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, passwordHash: authCrypto.hashPassword('Senha#Ativa123'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
    await writeStore(store);
    const token = await loginAs('h2.inativar@coevo.local', 'Senha#Ativa123');
    const before = await api('GET', '/api/me', { token });
    assert.equal(before.status, 200);
    const store2 = await readStore();
    store2.users.find(u => u.id === 'usr-h2-inativar').deletedAt = new Date().toISOString();
    await writeStore(store2);
    const after = await api('GET', '/api/me', { token });
    assert.equal(after.status, 401, 'deletedAt deve invalidar a sessão imediatamente, mesmo dentro da janela de expiração original');
    const loginAttempt = await loginRaw('h2.inativar@coevo.local', 'Senha#Ativa123');
    assert.equal(loginAttempt.status, 401, 'usuário inativo não pode iniciar uma nova sessão');
  });

  // --- P. credentialsVersion desatualizada invalida sessão --------------------------------------------
  test('[H2-P] sessão com credentialsVersion divergente do usuário é rejeitada', async () => {
    const token = await loginAs(EMAILS.semMfa);
    const before = await api('GET', '/api/me', { token });
    assert.equal(before.status, 200);
    const store = await readStore();
    const user = store.users.find(u => u.email === EMAILS.semMfa);
    user.credentialsVersion = (user.credentialsVersion || 1) + 1;
    await writeStore(store);
    const after = await api('GET', '/api/me', { token });
    assert.equal(after.status, 401, 'credentialsVersion divergente entre sessão e usuário deve invalidar a sessão');
  });

  // --- Q/R. bloqueio por tentativas malsucedidas e desbloqueio após o período ---------------------
  test('[H2-Q/R] excesso de tentativas de login bloqueia a conta temporariamente; login volta a funcionar após o período', async () => {
    const store = await readStore();
    store.users.push({ id: 'usr-h2-lockout', name: 'H2 Lockout', email: 'h2.lockout@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, passwordHash: authCrypto.hashPassword('SenhaCerta#123'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
    await writeStore(store);
    for (let i = 0; i < 5; i++) {
      const attempt = await loginRaw('h2.lockout@coevo.local', 'senha-errada');
      assert.equal(attempt.status, 401);
    }
    // Item 18 do escopo (revisão pós-PR #13, anti-enumeração): a resposta externa de conta bloqueada é a
    // MESMA de credenciais inválidas (401 genérico) — nunca um status/mensagem distinta que revelaria
    // que aquela conta especificamente existe e está bloqueada. A auditoria interna (ACCOUNT_LOCKED)
    // continua registrando o bloqueio normalmente, coberta pelo teste de auditoria [H2-S/T].
    const locked = await loginRaw('h2.lockout@coevo.local', 'SenhaCerta#123');
    assert.equal(locked.status, 401, 'conta bloqueada deve responder com o mesmo 401 genérico de credenciais inválidas, mesmo com a senha correta (anti-enumeração)');
    assert.equal(locked.body.error, 'Credenciais inválidas');

    // Simula o fim do período de bloqueio (não depende de tempo real de espera no teste).
    const store2 = await readStore();
    store2.users.find(u => u.email === 'h2.lockout@coevo.local').lockedUntil = new Date(Date.now() - 1000).toISOString();
    await writeStore(store2);
    const unlocked = await loginRaw('h2.lockout@coevo.local', 'SenhaCerta#123');
    assert.equal(unlocked.status, 200, 'após o período de bloqueio expirar, o login volta a funcionar normalmente com a senha correta');
  });

  // --- S/T. auditoria de login/MFA, nunca com segredo -------------------------------------------------
  test('[H2-S/T] eventos de auditoria de login/MFA são registrados e nunca contêm senha/hash/segredo/token', async () => {
    const store = await readStore();
    store.users.push({ id: 'usr-h2-audit', name: 'H2 Audit', email: 'h2.audit@coevo.local', role: 'lider', department: 'Jurídico', mfa: true, passwordHash: authCrypto.hashPassword('SenhaAudit#123'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: true, mfaMethod: 'totp', mfaSecretEncrypted: authCrypto.encryptSecret('KRSXG5CTMVRXEZLU'), mfaEnrolledAt: new Date().toISOString(), failedLoginCount: 0 });
    await writeStore(store);
    await loginRaw('h2.audit@coevo.local', 'senha-errada'); // LOGIN_FAILURE
    const token = await loginAs('h2.audit@coevo.local', 'SenhaAudit#123', 'KRSXG5CTMVRXEZLU'); // LOGIN_SUCCESS + MFA_CHALLENGE + MFA_SUCCESS
    await api('POST', '/api/auth/logout', { token }); // LOGOUT

    const finalStore = await readStore();
    const events = finalStore.audit.filter(e => e.entityId === 'usr-h2-audit');
    const actions = events.map(e => e.action);
    for (const expected of ['LOGIN_FAILURE', 'MFA_CHALLENGE', 'MFA_SUCCESS', 'LOGIN_SUCCESS', 'LOGOUT']) {
      assert.ok(actions.includes(expected), `esperava um evento de auditoria ${expected}, encontrados: ${actions.join(', ')}`);
    }
    const serialized = JSON.stringify(events);
    assert.doesNotMatch(serialized, /senha-errada|SenhaAudit#123|KRSXG5CTMVRXEZLU/, 'nenhum evento de auditoria pode conter a senha em texto puro ou o segredo MFA');
    assert.doesNotMatch(serialized, new RegExp(authCrypto.hashToken(token)), 'nenhum evento de auditoria deve conter o hash do token de sessão');
  });

  // --- U. token de reset não pode ser reaproveitado (coberto também em H2-N) --------------------------
  test('[H2-U] token de reset de senha expirado é rejeitado mesmo dentro da janela de uso único', async () => {
    const store = await readStore();
    store.users.push({ id: 'usr-h2-reset-exp', name: 'H2 Reset Expirado', email: 'h2.reset.exp@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, passwordHash: authCrypto.hashPassword('Senha#Original1'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
    await writeStore(store);
    await api('POST', '/api/auth/forgot-password', { json: { email: 'h2.reset.exp@coevo.local' } });
    const store2 = await readStore();
    const record = store2.passwordResetTokens.find(t => t.userId === 'usr-h2-reset-exp');
    const rawToken = authCrypto.generateOpaqueToken();
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    await pool.query('UPDATE password_reset_tokens SET token_hash = $1, expires_at = now() - interval \'1 second\' WHERE id = $2', [authCrypto.hashToken(rawToken), record.id]);
    await pool.end();
    const res = await api('POST', '/api/auth/reset-password', { json: { token: rawToken, newPassword: 'Senha#Nova222' } });
    assert.equal(res.status, 400);
  });

  // --- Revisão pós-PR #13: fluxo administrativo de primeiro acesso/reset (itens 1-5 do escopo) ---------
  test('[H2-admin-A/B] usuário recém-aprovado nasce sem passwordHash e não consegue logar sem um token de ativação', async () => {
    const store = await readStore();
    assert.equal(store.users.some(u => u.id === 'usr-h2-recem-aprovado'), false);
    store.users.push({ id: 'usr-h2-recem-aprovado', name: 'H2 Recém Aprovado', email: 'h2.recem-aprovado@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h2-recem-aprovado', passwordHash: null, temporaryPassword: true, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
    await writeStore(store);
    const reread = await readStore();
    const created = reread.users.find(u => u.id === 'usr-h2-recem-aprovado');
    assert.equal(created.passwordHash, null, 'usuário recém-aprovado nasce sem passwordHash (nenhuma credencial atribuída automaticamente)');
    const attempt = await loginRaw('h2.recem-aprovado@coevo.local', 'qualquer-senha');
    assert.equal(attempt.status, 401, 'sem passwordHash definido, nenhuma senha pode autenticar esse usuário ainda');
  });

  test('[H2-admin-C] operador SEM alçada de aprovação não consegue emitir token de acesso para outro usuário', async () => {
    const tokenSemAprovacao = await loginAs(EMAILS.semMfa);
    const store = await readStore();
    const target = store.users.find(u => u.id === 'usr-h2-recem-aprovado');
    const res = await api('POST', `/api/auth/users/${target.id}/reset-token`, { token: tokenSemAprovacao, json: {} });
    assert.equal(res.status, 403, 'colaborador comum (sem allowed(user,"*","approve")) não pode emitir token administrativo para outro usuário');
  });

  test('[H2-admin-D/E/F/G/H/I/J] operador autorizado emite token administrativo (bruto uma única vez, hash no banco, uso único) e o usuário completa o primeiro acesso', async () => {
    const tokenAprovador = await loginAs(EMAILS.aprovador, process.env.COEVO_DEMO_PASSWORD, SECRET_APROVADOR);
    const store = await readStore();
    const target = store.users.find(u => u.id === 'usr-h2-recem-aprovado');

    const issued = await api('POST', `/api/auth/users/${target.id}/reset-token`, { token: tokenAprovador, json: {} });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.equal(issued.body.userId, target.id, 'o token deve ser emitido para o userId explícito pedido, nunca por e-mail');
    assert.ok(issued.body.token, 'a resposta deve conter o token bruto — a ÚNICA vez que ele existe fora do processo');

    // F. banco contém somente o hash do token, nunca o bruto.
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const { rows } = await pool.query('SELECT token_hash FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [target.id]);
    await pool.end();
    assert.equal(rows[0].token_hash, authCrypto.hashToken(issued.body.token));
    assert.notEqual(rows[0].token_hash, issued.body.token);

    // G. o evento de auditoria correspondente nunca contém o token bruto.
    const auditedStore = await readStore();
    const relatedEvents = auditedStore.audit.filter(e => e.entityId === target.id && e.action === 'PASSWORD_RESET_REQUEST');
    assert.ok(relatedEvents.length > 0, 'a emissão administrativa deve gerar um evento de auditoria');
    assert.doesNotMatch(JSON.stringify(relatedEvents), new RegExp(issued.body.token), 'o token bruto nunca pode aparecer em nenhum evento de auditoria');

    // H. o token emitido permite definir a primeira senha do usuário.
    const definePassword = await api('POST', '/api/auth/reset-password', { json: { token: issued.body.token, newPassword: 'PrimeiraSenha#123' } });
    assert.equal(definePassword.status, 200, JSON.stringify(definePassword.body));

    // I. o mesmo token não pode ser reutilizado depois de usado.
    const reuse = await api('POST', '/api/auth/reset-password', { json: { token: issued.body.token, newPassword: 'OutraSenha#456' } });
    assert.equal(reuse.status, 400, 'um token de primeiro acesso já usado não pode ser reaproveitado');

    // J. depois de definida a primeira senha, o usuário segue o fluxo normal de login.
    const normalLogin = await loginRaw('h2.recem-aprovado@coevo.local', 'PrimeiraSenha#123');
    assert.equal(normalLogin.status, 200, JSON.stringify(normalLogin.body));
  });

  // --- Revisão pós-PR #13: identidade de login única (itens 10-19 do escopo) ---------------------------
  test('[H2-identidade-A/B/C/D/E] dois usuários com o mesmo e-mail: login por e-mail ambíguo falha; login por login_identifier autentica cada um corretamente; senha de um nunca autentica o outro', async () => {
    const store = await readStore();
    const sharedEmail = 'h2.email-compartilhado@coevo.local';
    store.users.push(
      { id: 'usr-h2-dup-a', name: 'H2 Duplicado A', email: sharedEmail, role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h2-dup-a', passwordHash: authCrypto.hashPassword('SenhaDupA#111'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 },
      { id: 'usr-h2-dup-b', name: 'H2 Duplicado B', email: sharedEmail, role: 'colaborador', department: 'TI', mfa: false, loginIdentifier: 'usr-h2-dup-b', passwordHash: authCrypto.hashPassword('SenhaDupB#222'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 }
    );
    await writeStore(store);

    // B. login por e-mail ambíguo (dois usuários ativos) não autentica nenhum dos dois por first-match.
    const ambiguous = await loginRaw(sharedEmail, 'SenhaDupA#111');
    assert.equal(ambiguous.status, 401, 'e-mail que resolve para mais de um usuário ativo nunca autentica por first-match');

    // C/D. login por login_identifier autentica exatamente o usuário correto.
    const loginA = await api('POST', '/api/auth/login', { json: { login: 'usr-h2-dup-a', password: 'SenhaDupA#111' } });
    assert.equal(loginA.status, 200, JSON.stringify(loginA.body));
    const loginB = await api('POST', '/api/auth/login', { json: { login: 'usr-h2-dup-b', password: 'SenhaDupB#222' } });
    assert.equal(loginB.status, 200, JSON.stringify(loginB.body));

    // E. a senha de um nunca autentica o outro, mesmo por login_identifier correto.
    const wrongPassword = await api('POST', '/api/auth/login', { json: { login: 'usr-h2-dup-a', password: 'SenhaDupB#222' } });
    assert.equal(wrongPassword.status, 401);
  });

  test('[H2-identidade-F] forgot-password com e-mail ambíguo não seleciona o primeiro registro silenciosamente', async () => {
    const store = await readStore();
    const sharedEmail = 'h2.forgot-ambiguo@coevo.local';
    store.users.push(
      { id: 'usr-h2-forgot-a', name: 'H2 Forgot A', email: sharedEmail, role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h2-forgot-a', passwordHash: authCrypto.hashPassword('Senha#111'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 },
      { id: 'usr-h2-forgot-b', name: 'H2 Forgot B', email: sharedEmail, role: 'colaborador', department: 'TI', mfa: false, loginIdentifier: 'usr-h2-forgot-b', passwordHash: authCrypto.hashPassword('Senha#222'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 }
    );
    await writeStore(store);
    const before = await readStore();
    const tokensBefore = before.passwordResetTokens.length;

    const res = await api('POST', '/api/auth/forgot-password', { json: { email: sharedEmail } });
    assert.equal(res.status, 200, 'resposta externa continua genérica mesmo diante de ambiguidade');

    const after = await readStore();
    assert.equal(after.passwordResetTokens.length, tokensBefore, 'nenhum token de reset deve ser criado quando o e-mail é ambíguo (nunca escolhe um registro arbitrário)');
  });

  test('[H2-identidade-G] fluxo administrativo por userId continua emitindo token corretamente mesmo com e-mail compartilhado', async () => {
    const tokenAprovador = await loginAs(EMAILS.aprovador, process.env.COEVO_DEMO_PASSWORD, SECRET_APROVADOR);
    const store = await readStore();
    const targetB = store.users.find(u => u.id === 'usr-h2-forgot-b');
    const issued = await api('POST', `/api/auth/users/${targetB.id}/reset-token`, { token: tokenAprovador, json: {} });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.equal(issued.body.userId, targetB.id, 'a rota administrativa atinge exatamente o usuário escolhido por id, mesmo com e-mail ambíguo entre contas');
  });

  test('[H2-identidade-H/I] login_identifier é UNIQUE no banco e todo novo usuário recebe um valor próprio', async () => {
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    const { rows } = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'app_users' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%login_identifier%'"
    );
    await pool.end();
    assert.ok(rows.length > 0, 'deve existir um índice único sobre app_users.login_identifier');

    const store = await readStore();
    const distinctIds = new Set(store.users.map(u => u.loginIdentifier));
    assert.equal(distinctIds.size, store.users.length, 'todo usuário (seed, backfill ou criado nesta suíte) deve ter um login_identifier próprio, sem colisões');
  });

  // --- Revisão pós-PR #13: anti-enumeração (item 18-19 do escopo) --------------------------------------
  test('[H2-anti-enumeração] login inexistente, senha errada, usuário inativo, conta bloqueada e e-mail ambíguo recebem a mesma resposta externa', async () => {
    const store = await readStore();
    store.users.push(
      { id: 'usr-h2-anti-enum-inativo', name: 'H2 Anti Enum Inativo', email: 'h2.anti-enum-inativo@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h2-anti-enum-inativo', passwordHash: authCrypto.hashPassword('Senha#Ativa1'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0, deletedAt: new Date().toISOString() },
      { id: 'usr-h2-anti-enum-bloqueado', name: 'H2 Anti Enum Bloqueado', email: 'h2.anti-enum-bloqueado@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h2-anti-enum-bloqueado', passwordHash: authCrypto.hashPassword('Senha#Certa1'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0, lockedUntil: new Date(Date.now()+900000).toISOString() },
      { id: 'usr-h2-anti-enum-a', name: 'H2 Anti Enum A', email: 'h2.anti-enum-ambiguo@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h2-anti-enum-a', passwordHash: authCrypto.hashPassword('Senha#111'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 },
      { id: 'usr-h2-anti-enum-b', name: 'H2 Anti Enum B', email: 'h2.anti-enum-ambiguo@coevo.local', role: 'colaborador', department: 'TI', mfa: false, loginIdentifier: 'usr-h2-anti-enum-b', passwordHash: authCrypto.hashPassword('Senha#222'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 }
    );
    await writeStore(store);

    const casos = await Promise.all([
      loginRaw('h2.nao-existe-anti-enum@coevo.local', 'qualquer-senha'),
      loginRaw('h2.anti-enum-inativo@coevo.local', 'senha-errada'),
      loginRaw('h2.anti-enum-inativo@coevo.local', 'Senha#Ativa1'),
      loginRaw('h2.anti-enum-bloqueado@coevo.local', 'Senha#Certa1'),
      loginRaw('h2.anti-enum-ambiguo@coevo.local', 'Senha#111')
    ]);
    for (const res of casos) {
      assert.equal(res.status, 401, `todos os casos devem responder 401 (nunca 423 nem qualquer outro status que distinga o motivo): ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, 'Credenciais inválidas', 'a mensagem externa deve ser idêntica em todos os casos, sem revelar qual condição ocorreu');
    }
  });

  // --- V. restart: sessão sobrevive ao reinício do processo (não é em memória) ------------------------
  test('[H2-restart] sessão sobrevive ao "restart" do processo (novo módulo/handler, mesmo banco)', async () => {
    const token = await loginAs(EMAILS.semMfa);
    // Encerra a instância atual por completo (fecha HTTP e pool de Postgres) e recarrega server.js do
    // zero — simula o processo sendo reiniciado, sem qualquer estado em memória sobrevivendo.
    await new Promise(resolve => server.close(resolve));
    await storage.close();

    serverModule = loadFreshServerModule();
    ({ readStore, writeStore, storage } = serverModule);
    await storage.init();
    ({ server, baseUrl } = await startInstance(serverModule));
    api = makeApi(baseUrl);

    const res = await api('GET', '/api/me', { token });
    assert.equal(res.status, 200, 'a sessão emitida antes do restart deve continuar válida depois, pois nunca viveu apenas em memória');
  });

  // --- W. múltiplas instâncias compartilhando o mesmo Postgres ----------------------------------------
  test('[H2-multi-instância] sessão criada em uma instância é validada por outra instância via o mesmo Postgres; revogação em uma reflete imediatamente na outra', async () => {
    const instanceA = { serverModule, storage, readStore, writeStore, server, baseUrl, api };

    const instanceBModule = loadFreshServerModule();
    const instanceBStorage = instanceBModule.storage;
    await instanceBStorage.init();
    const startedB = await startInstance(instanceBModule);
    const apiB = makeApi(startedB.baseUrl);

    try {
      const tokenFromA = await instanceA.api('POST', '/api/auth/login', { json: { email: EMAILS.semMfa, password: process.env.COEVO_DEMO_PASSWORD } }).then(r => r.body.token);
      assert.ok(tokenFromA, 'instância A deve conseguir emitir uma sessão normalmente');

      const seenByB = await apiB('GET', '/api/me', { token: tokenFromA });
      assert.equal(seenByB.status, 200, 'a instância B deve validar uma sessão criada pela instância A, pois ambas compartilham o mesmo Postgres');

      const revoke = await instanceA.api('POST', '/api/auth/logout', { token: tokenFromA });
      assert.equal(revoke.status, 200);

      const seenByBAfterRevoke = await apiB('GET', '/api/me', { token: tokenFromA });
      assert.equal(seenByBAfterRevoke.status, 401, 'a revogação feita na instância A deve refletir IMEDIATAMENTE na instância B, sem esperar expiração');
    } finally {
      await new Promise(resolve => startedB.server.close(resolve));
      await instanceBStorage.close();
      // Restaura o módulo/instância A como "corrente" para os testes subsequentes (a instância A em si
      // nunca foi fechada por este teste — só a instância B auxiliar).
      serverModule = instanceA.serverModule; storage = instanceA.storage; readStore = instanceA.readStore; writeStore = instanceA.writeStore; server = instanceA.server; baseUrl = instanceA.baseUrl; api = instanceA.api;
    }
  });
}
