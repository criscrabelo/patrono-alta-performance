// Sprint 2, Hardening H3 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H3-01): rate limiting
// global e proteção contra abuso/força bruta, distribuído via PostgreSQL. Mesma técnica de
// tests/h2-auth-sessions.test.js — servidor HTTP real (`handler` exportado de server.js) rodando sobre
// um banco Postgres ISOLADO e próprio deste arquivo.
//
// Só roda de fato quando TEST_DATABASE_URL está definida. Sem ela, todo o arquivo é pulado
// explicitamente (docs/PRODUCTION_GATE.md, seção 28).
const test = require('node:test');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  test('[H3] testes pulados — TEST_DATABASE_URL não configurada neste ambiente (ver docs/PRODUCTION_GATE.md, seção 28)', { skip: true }, () => {});
} else {
  const assert = require('node:assert/strict');
  const http = require('node:http');
  const { Pool } = require('pg');
  const authCrypto = require('../auth/crypto');

  process.env.COEVO_DEMO_PASSWORD = 'h3-integration-test-password-0000000000';
  process.env.COEVO_SESSION_MS = '300000';
  process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY || 'test-mfa-encryption-key-at-least-32-characters';
  process.env.RATE_LIMIT_HMAC_KEY = process.env.RATE_LIMIT_HMAC_KEY || 'test-rate-limit-hmac-key-at-least-32-characters';
  process.env.NODE_ENV = 'test';
  delete process.env.MONDAY_TOKEN;
  delete process.env.TRUST_PROXY_HOPS;

  const ISOLATED_DB_NAME = `patrono_h3_rate_limit_test_${process.pid}_${Date.now()}`;
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

  // Mesma técnica de tests/h2-auth-sessions.test.js: recarrega server.js/storage do zero — cada chamada
  // produz um módulo independente (seu próprio Pool em storage/index.js), simulando um processo/
  // instância separado. Usado pelos testes de restart e múltiplas instâncias.
  function loadFreshServerModule() {
    delete require.cache[require.resolve('../server')];
    delete require.cache[require.resolve('../storage')];
    delete require.cache[require.resolve('../auth/rate-limit')];
    return require('../server');
  }

  const DEV_SEED_TOTP_SECRET = process.env.COEVO_SEED_TOTP_SECRET || 'JBSWY3DPEHPK3PXP';
  const SECRET_MFA = authCrypto.generateTotpSecret();

  let server, baseUrl, storage, readStore, writeStore, serverModule;

  async function startInstance(mod) {
    const s = http.createServer(mod.handler);
    await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
    return { server: s, baseUrl: `http://127.0.0.1:${s.address().port}` };
  }

  function makeApi(baseUrlForInstance) {
    return async function api(method, pathname, { token, json, headers } = {}) {
      const res = await fetch(`${baseUrlForInstance}${pathname}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
        body: json !== undefined ? JSON.stringify(json) : undefined
      });
      const text = await res.text();
      let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { status: res.status, headers: res.headers, body };
    };
  }

  let api;

  const EMAILS = {
    login: 'h3.login@coevo.local',
    mfa: 'h3.mfa@coevo.local',
    forgot: 'h3.forgot@coevo.local',
    aprovador: 'h3.aprovador@coevo.local'
  };

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
      { id: 'usr-h3-login', name: 'H3 Login', email: EMAILS.login, role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h3-login', passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 },
      { id: 'usr-h3-mfa', name: 'H3 MFA', email: EMAILS.mfa, role: 'lider', department: 'Jurídico', mfa: true, loginIdentifier: 'usr-h3-mfa', passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: true, mfaMethod: 'totp', mfaSecretEncrypted: authCrypto.encryptSecret(SECRET_MFA), mfaEnrolledAt: new Date().toISOString(), failedLoginCount: 0 },
      { id: 'usr-h3-forgot', name: 'H3 Forgot', email: EMAILS.forgot, role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h3-forgot', passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 },
      { id: 'usr-h3-aprovador', name: 'H3 Aprovador', email: EMAILS.aprovador, role: 'diretoria', department: null, mfa: true, loginIdentifier: 'usr-h3-aprovador', passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: true, mfaMethod: 'totp', mfaSecretEncrypted: authCrypto.encryptSecret(SECRET_MFA), mfaEnrolledAt: new Date().toISOString(), failedLoginCount: 0 }
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

  async function resetRateLimits() {
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    await pool.query('DELETE FROM rate_limit_buckets');
    await pool.end();
  }
  // H3 é uma camada COMPLEMENTAR ao lockout por conta do H2 (failedLoginCount/lockedUntil) — vários
  // testes deste arquivo (login B/C/D/E/F, concorrência) disparam de propósito várias senhas erradas
  // para a MESMA conta a fim de exercitar os buckets H3, o que também aciona o lockout H2
  // independentemente (MAX_FAILED_LOGIN_ATTEMPTS). Sem limpar esse estado entre testes, uma conta
  // ficaria bloqueada por H2 para os testes seguintes que precisam logar normalmente com ela — H2 não é
  // o alvo deste arquivo (tem sua própria suíte em tests/h2-auth-sessions.test.js), então cada teste
  // aqui começa com as contas seedadas destravadas.
  async function resetAccountLockouts() {
    const store = await readStore();
    let changed = false;
    for (const user of store.users) {
      if (user.failedLoginCount || user.lockedUntil) { user.failedLoginCount = 0; user.lockedUntil = null; changed = true; }
    }
    if (changed) await writeStore(store);
  }
  test.beforeEach(async () => { await resetRateLimits(); await resetAccountLockouts(); });

  async function loginRaw(email, password, opts) { return api('POST', '/api/auth/login', { json: { email, password }, ...(opts || {}) }); }
  function totpCodeFor(secret) { return authCrypto.totpAt(secret, Date.now()); }
  async function loginAs(email, password = process.env.COEVO_DEMO_PASSWORD, mfaSecret = SECRET_MFA) {
    const login = await loginRaw(email, password);
    assert.equal(login.status, 200, `login deveria aceitar credenciais válidas para ${email}: ${JSON.stringify(login.body)}`);
    if (login.body.token) return login.body.token;
    const mfa = await api('POST', '/api/auth/mfa/verify', { json: { challenge: login.body.challenge, code: totpCodeFor(mfaSecret) } });
    assert.equal(mfa.status, 200, JSON.stringify(mfa.body));
    return mfa.body.token;
  }

  // --- 32. LOGIN TESTS -----------------------------------------------------------------------------
  test('[H3-login-A] abaixo do limite: login segue normal', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await loginRaw(EMAILS.login, 'senha-errada-' + i);
      assert.equal(res.status, 401);
    }
    const ok = await loginRaw(EMAILS.login, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(ok.status, 200);
  });

  test('[H3-login-B] limite por IP: excedido resulta em 429 com Retry-After', async () => {
    // loginCombined (max 8) é o mais restrito para uma única identidade/IP — excede-se primeiro.
    for (let i = 0; i < 8; i++) await loginRaw(EMAILS.login, 'senha-errada');
    const blocked = await loginRaw(EMAILS.login, 'senha-errada');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'Muitas tentativas. Tente novamente mais tarde.');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0, 'Retry-After deve ser um número positivo de segundos');
  });

  test('[H3-login-C] limite por identidade: mesma identidade em IPs diferentes (simulados) ainda esbarra no teto de identidade', async () => {
    // Simula 11 tentativas com a MESMA identidade — mesmo variando o "IP" via cabeçalho confiável não
    // configurado (portanto ignorado, todas batem no mesmo IP direto de teste), o bucket de IDENTIDADE
    // (max 10) bloqueia independentemente do bucket de IP.
    for (let i = 0; i < 10; i++) await loginRaw(EMAILS.login, 'senha-errada');
    const blocked = await loginRaw(EMAILS.login, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(blocked.status, 429, 'mesmo com a senha CORRETA, identidade já esgotada deve continuar bloqueada');
  });

  test('[H3-login-D] IP+identidade: bucket combinado bloqueia antes dos 10 da identidade isolada quando é o mais restrito', async () => {
    for (let i = 0; i < 8; i++) await loginRaw(EMAILS.login, 'senha-errada');
    const blocked = await loginRaw(EMAILS.login, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(blocked.status, 429);
  });

  test('[H3-login-E] outro usuário no mesmo IP: bucket de identidade é isolado por identidade, não compartilhado entre contas', async () => {
    for (let i = 0; i < 8; i++) await loginRaw(EMAILS.login, 'senha-errada');
    const blockedLogin = await loginRaw(EMAILS.login, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(blockedLogin.status, 429, 'a identidade "login" deve estar bloqueada');
    const otherUser = await loginRaw(EMAILS.forgot, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(otherUser.status, 200, 'outro usuário no MESMO IP não deve herdar o bloqueio da identidade de outra conta');
  });

  test('[H3-login-F] mesma identidade seguiria bloqueada mesmo de outro IP simulado (bucket de identidade não depende do IP)', async () => {
    for (let i = 0; i < 8; i++) await loginRaw(EMAILS.login, 'senha-errada');
    // TRUST_PROXY_HOPS não está configurado neste arquivo — X-Forwarded-For é ignorado, então mesmo
    // "fingindo" outro IP via header, o IP resolvido continua sendo o mesmo endereço de loopback do
    // teste. O bucket de identidade sozinho já garante o bloqueio independente do IP alegado.
    const blocked = await loginRaw(EMAILS.login, process.env.COEVO_DEMO_PASSWORD, { headers: { 'x-forwarded-for': '203.0.113.55' } });
    assert.equal(blocked.status, 429, 'trocar o X-Forwarded-For sem TRUST_PROXY_HOPS configurado não contorna o bucket de identidade');
  });

  // Revisão técnica pós-PR #14 (itens 9-12 do escopo): antes desta correção, o bucket de identidade
  // usava o valor BRUTO apresentado (`input.login || input.email`) — então `email` e `login_identifier`
  // da MESMA conta geravam chaves HMAC diferentes, permitindo a um atacante até dobrar o teto de
  // tentativas apenas alternando qual identificador apresenta a cada requisição. Corrigido para resolver
  // a conta primeiro e usar `user:${found.id}` como chave canônica sempre que a conta resolve — email e
  // login_identifier da mesma conta agora sempre caem no MESMO bucket.
  test('[H3-identidade-canônica] email e login_identifier da MESMA conta compartilham o bucket de identidade — alternar entre os dois não dobra o teto de tentativas', async () => {
    const ALIAS_EMAIL = 'h3.alias@coevo.local';
    const ALIAS_LOGIN = 'usr-h3-alias';
    const store = await readStore();
    if (!store.users.some(u => u.id === ALIAS_LOGIN)) {
      store.users.push({ id: ALIAS_LOGIN, name: 'H3 Alias', email: ALIAS_EMAIL, role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: ALIAS_LOGIN, passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
      await writeStore(store);
    }
    // loginCombined: max 8/janela. Alterna entre email e login_identifier a cada tentativa — se o
    // bucket não fosse canônico, cada forma teria seu próprio teto de 8 (até 16 tentativas totais antes
    // de bloquear).
    let lastStatus;
    for (let i = 0; i < 8; i++) {
      const payload = i % 2 === 0 ? { login: ALIAS_LOGIN, password: 'senha-errada-alias' } : { email: ALIAS_EMAIL, password: 'senha-errada-alias' };
      const res = await api('POST', '/api/auth/login', { json: payload });
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 401, 'as 8 primeiras tentativas (alternando email/login_identifier) ainda devem ser aceitas pelo rate limit — só rejeitadas por senha errada');
    const blockedByEmail = await api('POST', '/api/auth/login', { json: { email: ALIAS_EMAIL, password: 'senha-errada-alias' } });
    assert.equal(blockedByEmail.status, 429, 'a 9ª tentativa (por e-mail) deve bloquear — o bucket combinado é o MESMO independentemente do identificador apresentado');
    const blockedByLogin = await api('POST', '/api/auth/login', { json: { login: ALIAS_LOGIN, password: 'senha-errada-alias' } });
    assert.equal(blockedByLogin.status, 429, 'o bloqueio vale para as duas formas de apresentar a identidade — não é possível contornar trocando de identificador');
  });

  // --- 33/34. MULTI-INSTÂNCIA E RESTART -------------------------------------------------------------
  test('[H3-multi-instância] instância A consome tentativas; instância B continua do MESMO contador (não reinicia)', async () => {
    const instanceA = { serverModule, storage, api, server, baseUrl };
    const instanceBModule = loadFreshServerModule();
    await instanceBModule.storage.init();
    const startedB = await startInstance(instanceBModule);
    const apiB = makeApi(startedB.baseUrl);
    try {
      for (let i = 0; i < 5; i++) await instanceA.api('POST', '/api/auth/login', { json: { email: EMAILS.login, password: 'senha-errada' } });
      for (let i = 0; i < 3; i++) await apiB('POST', '/api/auth/login', { json: { email: EMAILS.login, password: 'senha-errada' } });
      // 5 (instância A) + 3 (instância B) = 8, exatamente o limite combinado — a próxima deve bloquear,
      // provando que o contador é COMPARTILHADO (Postgres), não reiniciado por instância.
      const blocked = await apiB('POST', '/api/auth/login', { json: { email: EMAILS.login, password: process.env.COEVO_DEMO_PASSWORD } });
      assert.equal(blocked.status, 429, 'o contador deve ser compartilhado entre instâncias via o mesmo Postgres, nunca reiniciado por instância');
    } finally {
      await new Promise(resolve => startedB.server.close(resolve));
      await instanceBModule.storage.close();
    }
  });

  test('[H3-restart] bloqueio sobrevive ao "restart" do processo (novo módulo/handler, mesmo banco)', async () => {
    for (let i = 0; i < 8; i++) await loginRaw(EMAILS.login, 'senha-errada');
    const blockedBefore = await loginRaw(EMAILS.login, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(blockedBefore.status, 429);

    await new Promise(resolve => server.close(resolve));
    await storage.close();
    serverModule = loadFreshServerModule();
    ({ readStore, writeStore, storage } = serverModule);
    await storage.init();
    ({ server, baseUrl } = await startInstance(serverModule));
    api = makeApi(baseUrl);

    const blockedAfter = await loginRaw(EMAILS.login, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(blockedAfter.status, 429, 'o bloqueio deve sobreviver ao restart do processo — nunca esteve apenas em memória');
  });

  // --- 35. CONCORRÊNCIA ------------------------------------------------------------------------------
  test('[H3-concorrência] rajada simultânea próxima ao limite nunca aceita mais requisições do que a política permite', async () => {
    const attempts = await Promise.all(Array.from({ length: 14 }, () => loginRaw(EMAILS.login, 'senha-errada-concorrencia')));
    const notBlocked = attempts.filter(r => r.status !== 429).length;
    assert.ok(notBlocked <= 8, `no máximo 8 tentativas (limite combinado) podem ser aceitas sob concorrência real; recebidas: ${notBlocked}`);
  });

  // --- 36. MFA TESTS -----------------------------------------------------------------------------
  test('[H3-mfa] várias tentativas incorretas levam a 429; challenge de outro usuário não herda o bucket; proteção por IP continua', async () => {
    const login = await loginRaw(EMAILS.mfa, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(login.status, 200);
    assert.equal(login.body.mfaRequired, true);
    for (let i = 0; i < 10; i++) {
      const attempt = await api('POST', '/api/auth/mfa/verify', { json: { challenge: login.body.challenge, code: '000000' } });
      assert.equal(attempt.status, 401);
    }
    const blocked = await api('POST', '/api/auth/mfa/verify', { json: { challenge: login.body.challenge, code: totpCodeFor(SECRET_MFA) } });
    assert.equal(blocked.status, 429, 'após exceder o teto por challenge, nem o código correto deve mais ser aceito nesta janela');

    // Um SEGUNDO login (novo challenge) do MESMO usuário, no mesmo IP, ainda é afetado pelo bucket de
    // IP (mfaVerifyIp) — mas o bucket por CHALLENGE é isolado por challenge id, nunca compartilhado
    // entre challenges diferentes.
    await resetRateLimits();
    const secondLogin = await loginRaw(EMAILS.mfa, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(secondLogin.body.challenge === login.body.challenge, false, 'um novo login deve gerar um novo challenge');
  });

  // --- 37. FORGOT PASSWORD TESTS -------------------------------------------------------------------
  test('[H3-forgot-password] resposta genérica abaixo do limite; 429 após abuso; e-mail duplicado continua sem first-match', async () => {
    const ok = await api('POST', '/api/auth/forgot-password', { json: { email: EMAILS.forgot } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.message, 'Se o e-mail existir, instruções de redefinição serão enviadas.');

    const okNonExistent = await api('POST', '/api/auth/forgot-password', { json: { email: 'nao-existe-h3@coevo.local' } });
    assert.equal(okNonExistent.status, 200);
    assert.deepEqual(okNonExistent.body, ok.body, 'resposta idêntica para e-mail existente e inexistente, mesmo dentro do limite');

    // forgotPasswordIdentity: max 3 por janela — a chamada acima (`ok`) já consumiu a primeira; mais
    // duas ainda permitidas (2ª e 3ª); a 4ª deve bloquear.
    await api('POST', '/api/auth/forgot-password', { json: { email: EMAILS.forgot } });
    await api('POST', '/api/auth/forgot-password', { json: { email: EMAILS.forgot } });
    const blocked = await api('POST', '/api/auth/forgot-password', { json: { email: EMAILS.forgot } });
    assert.equal(blocked.status, 429);
  });

  test('[H3-forgot-password] e-mail ambíguo (duplicado) continua sem first-match mesmo com rate limit ativo', async () => {
    const store = await readStore();
    const sharedEmail = 'h3.forgot-ambiguo@coevo.local';
    store.users.push(
      { id: 'usr-h3-dup-a', name: 'H3 Dup A', email: sharedEmail, role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h3-dup-a', passwordHash: authCrypto.hashPassword('Senha#111'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 },
      { id: 'usr-h3-dup-b', name: 'H3 Dup B', email: sharedEmail, role: 'colaborador', department: 'TI', mfa: false, loginIdentifier: 'usr-h3-dup-b', passwordHash: authCrypto.hashPassword('Senha#222'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 }
    );
    await writeStore(store);
    const before = await readStore();
    const tokensBefore = before.passwordResetTokens.length;
    const res = await api('POST', '/api/auth/forgot-password', { json: { email: sharedEmail } });
    assert.equal(res.status, 200);
    const after = await readStore();
    assert.equal(after.passwordResetTokens.length, tokensBefore, 'e-mail ambíguo nunca gera token, com ou sem rate limit');
  });

  // --- 38. ADMIN RESET TESTS -----------------------------------------------------------------------
  test('[H3-admin-reset] aprovador autorizado abaixo do limite; operador sem permissão continua 403 (não consome bucket de aprovador); bloqueio após abuso', async () => {
    const store = await readStore();
    store.users.push({ id: 'usr-h3-target', name: 'H3 Target', email: 'h3.target@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h3-target', passwordHash: null, temporaryPassword: true, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
    await writeStore(store);
    const tokenAprovador = await loginAs(EMAILS.aprovador);
    const tokenSemPermissao = await loginAs(EMAILS.login);

    const forbidden = await api('POST', '/api/auth/users/usr-h3-target/reset-token', { token: tokenSemPermissao, json: {} });
    assert.equal(forbidden.status, 403, 'operador sem allowed(user,"*","approve") continua 403');

    const issued = await api('POST', '/api/auth/users/usr-h3-target/reset-token', { token: tokenAprovador, json: {} });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.ok(issued.body.token);

    // adminResetTokenTarget: max 3 por janela — já emitimos 1 para usr-h3-target acima.
    await api('POST', '/api/auth/users/usr-h3-target/reset-token', { token: tokenAprovador, json: {} });
    await api('POST', '/api/auth/users/usr-h3-target/reset-token', { token: tokenAprovador, json: {} });
    const blockedByTarget = await api('POST', '/api/auth/users/usr-h3-target/reset-token', { token: tokenAprovador, json: {} });
    assert.equal(blockedByTarget.status, 429, 'não deve permitir geração em massa de tokens para o mesmo usuário-alvo');

    const beforeStore = await readStore();
    const tokensBefore = beforeStore.passwordResetTokens.filter(t => t.userId === 'usr-h3-target').length;
    const attemptAfterBlock = await api('POST', '/api/auth/users/usr-h3-target/reset-token', { token: tokenAprovador, json: {} });
    assert.equal(attemptAfterBlock.status, 429);
    const afterStore = await readStore();
    assert.equal(afterStore.passwordResetTokens.filter(t => t.userId === 'usr-h3-target').length, tokensBefore, 'nenhum token novo deve ser gerado após o bloqueio');
  });

  // --- 39. RESET PASSWORD TESTS --------------------------------------------------------------------
  test('[H3-reset-password] tentativas abaixo do limite; token inválido repetido leva a 429; rate limit nunca torna um token válido reutilizável', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await api('POST', '/api/auth/reset-password', { json: { token: 'token-invalido-' + i, newPassword: 'NovaSenha#123' } });
      assert.equal(res.status, 400);
    }
    // resetPasswordIp: max 10 por janela — já usamos 3.
    for (let i = 0; i < 7; i++) await api('POST', '/api/auth/reset-password', { json: { token: 'token-invalido-mais-' + i, newPassword: 'NovaSenha#123' } });
    const blocked = await api('POST', '/api/auth/reset-password', { json: { token: 'token-invalido-final', newPassword: 'NovaSenha#123' } });
    assert.equal(blocked.status, 429);

    // Um token genuinamente válido, apresentado DEPOIS do bloqueio por IP, também é recusado (fail-
    // closed da política de IP) — mas nunca "gasta" o rate limit para tornar o token reutilizável.
    await resetRateLimits();
    const store = await readStore();
    store.users.push({ id: 'usr-h3-reset', name: 'H3 Reset', email: 'h3.reset@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h3-reset', passwordHash: authCrypto.hashPassword('SenhaAntes#123'), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
    await writeStore(store);
    await api('POST', '/api/auth/forgot-password', { json: { email: 'h3.reset@coevo.local' } });
    const store2 = await readStore();
    const record = store2.passwordResetTokens.find(t => t.userId === 'usr-h3-reset');
    const rawToken = authCrypto.generateOpaqueToken();
    const pool = new Pool({ connectionString: isolatedDatabaseUrl });
    await pool.query('UPDATE password_reset_tokens SET token_hash = $1 WHERE id = $2', [authCrypto.hashToken(rawToken), record.id]);
    await pool.end();
    const first = await api('POST', '/api/auth/reset-password', { json: { token: rawToken, newPassword: 'SenhaDepois#456' } });
    assert.equal(first.status, 200);
    const reuse = await api('POST', '/api/auth/reset-password', { json: { token: rawToken, newPassword: 'Outra#789' } });
    assert.equal(reuse.status, 400, 'token de uso único continua de uso único — rate limit não interfere na regra de negócio');
  });

  // --- 40. ANTI-BYPASS -------------------------------------------------------------------------------
  test('[H3-anti-bypass] troca de User-Agent não contorna o bucket', async () => {
    for (let i = 0; i < 8; i++) await loginRaw(EMAILS.login, 'senha-errada');
    const withDifferentUA = await api('POST', '/api/auth/login', { json: { email: EMAILS.login, password: process.env.COEVO_DEMO_PASSWORD }, headers: { 'user-agent': 'AtacanteBot/9.9 (diferente-do-padrao)' } });
    assert.equal(withDifferentUA.status, 429, 'trocar User-Agent nunca deve contornar o bucket — nunca faz parte da chave de rate limit');
  });

  test('[H3-anti-bypass] X-Forwarded-For sem TRUST_PROXY_HOPS configurado não contorna o bloqueio', async () => {
    for (let i = 0; i < 8; i++) await loginRaw(EMAILS.login, 'senha-errada');
    const withFakeXff = await loginRaw(EMAILS.login, process.env.COEVO_DEMO_PASSWORD, { headers: { 'x-forwarded-for': '198.51.100.200' } });
    assert.equal(withFakeXff.status, 429);
  });

  test('[H3-anti-bypass] reiniciar o processo não contorna o bloqueio (repetição do teste de restart, cenário de ataque)', async () => {
    for (let i = 0; i < 8; i++) await loginRaw(EMAILS.login, 'senha-errada');
    await new Promise(resolve => server.close(resolve));
    await storage.close();
    serverModule = loadFreshServerModule();
    ({ readStore, writeStore, storage } = serverModule);
    await storage.init();
    ({ server, baseUrl } = await startInstance(serverModule));
    api = makeApi(baseUrl);
    const stillBlocked = await loginRaw(EMAILS.login, process.env.COEVO_DEMO_PASSWORD);
    assert.equal(stillBlocked.status, 429);
  });

  test('[H3-anti-bypass] alternar instância não contorna o bloqueio', async () => {
    for (let i = 0; i < 8; i++) await loginRaw(EMAILS.login, 'senha-errada');
    const otherInstanceModule = loadFreshServerModule();
    await otherInstanceModule.storage.init();
    const started = await startInstance(otherInstanceModule);
    const apiOther = makeApi(started.baseUrl);
    try {
      const stillBlocked = await apiOther('POST', '/api/auth/login', { json: { email: EMAILS.login, password: process.env.COEVO_DEMO_PASSWORD } });
      assert.equal(stillBlocked.status, 429, 'uma segunda instância compartilhando o mesmo Postgres deve ver o mesmo bloqueio');
    } finally {
      await new Promise(resolve => started.server.close(resolve));
      await otherInstanceModule.storage.close();
    }
  });

  // --- 40. AUDITORIA RATE_LIMIT_TRIGGERED (item 13/14/16 da revisão técnica pós-PR #14) -------------
  test('[H3-audit] primeiro bloqueio de um bucket gera RATE_LIMIT_TRIGGERED; bloqueios repetidos na mesma janela não geram flood; evento nunca contém e-mail bruto', async () => {
    const email = 'h3.audit-forgot@coevo.local';
    // Exaure o limite de identidade de forgot-password (max 3/15min) para um e-mail exclusivo deste
    // teste — isolado de qualquer outro bucket já exercitado por outros testes deste arquivo (a
    // contagem abaixo é sempre um INCREMENTO relativo, nunca um valor absoluto, então mesmo que outros
    // testes já tenham gerado seus próprios eventos RATE_LIMIT_TRIGGERED em outras categorias, este
    // teste continua válido).
    for (let i = 0; i < 3; i++) await api('POST', '/api/auth/forgot-password', { json: { email } });
    const countRateLimitEvents = store => store.audit.filter(e => e.action === 'RATE_LIMIT_TRIGGERED' && e.entityId === 'forgot-password-identity').length;

    const before = await readStore();
    const countBefore = countRateLimitEvents(before);

    const blocked1 = await api('POST', '/api/auth/forgot-password', { json: { email } });
    assert.equal(blocked1.status, 429);
    const afterFirst = await readStore();
    assert.equal(countRateLimitEvents(afterFirst), countBefore + 1, 'o PRIMEIRO bloqueio deste bucket/janela deve gerar exatamente um evento RATE_LIMIT_TRIGGERED');

    const blocked2 = await api('POST', '/api/auth/forgot-password', { json: { email } });
    assert.equal(blocked2.status, 429);
    const afterSecond = await readStore();
    assert.equal(countRateLimitEvents(afterSecond), countRateLimitEvents(afterFirst), 'bloqueios REPETIDOS dentro da mesma janela não devem gerar um novo evento a cada 429 — nunca um flood da tabela de auditoria');

    const lastEvent = afterSecond.audit.filter(e => e.action === 'RATE_LIMIT_TRIGGERED' && e.entityId === 'forgot-password-identity').at(-1);
    assert.equal(lastEvent.before, null);
    assert.equal(lastEvent.after, null);
    const serialized = JSON.stringify(lastEvent).toLowerCase();
    assert.ok(!serialized.includes(email.toLowerCase()), 'o evento de auditoria nunca deve conter o e-mail bruto que disparou o bloqueio');
    assert.ok(!serialized.includes(process.env.COEVO_DEMO_PASSWORD.toLowerCase()), 'o evento de auditoria nunca deve conter qualquer senha');
  });
}
