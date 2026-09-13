// Sprint 2, Hardening H4 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H4-01): headers de
// segurança HTTP (CSP/HSTS/X-Frame-Options/Referrer-Policy/Permissions-Policy/nosniff) e política
// explícita de CORS. Mesma técnica de tests/security-integration.test.js — servidor HTTP real (`handler`
// exportado de server.js) sobre o fallback JSON local, ISOLADO em um diretório temporário próprio.
//
// Deliberadamente NÃO depende de PostgreSQL/TEST_DATABASE_URL: os headers de segurança e a política de
// CORS são aplicados em `applySecurityHeaders()`/`handlePreflight()` ANTES de qualquer lógica de
// persistência rodar — precisam se comportar de forma IDÊNTICA nos dois backends (item 53 do escopo
// H4). O único cenário que genuinamente depende de Postgres (429 de H3 preservando os headers de H4)
// está isolado no bloco gated por TEST_DATABASE_URL ao final deste arquivo, no mesmo padrão de
// skip explícito já usado em outros arquivos (docs/PRODUCTION_GATE.md, seção 28).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h4-'));
process.env.COEVO_DATA_DIR = TEST_DATA_DIR;
process.env.COEVO_DEMO_PASSWORD = 'h4-integration-test-password-0000000000';
process.env.COEVO_SESSION_MS = '300000';
process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY || 'test-mfa-encryption-key-at-least-32-characters';
process.env.NODE_ENV = 'test';
delete process.env.MONDAY_TOKEN;
delete process.env.CORS_ALLOWED_ORIGINS;

const { handler, readStore, writeStore } = require('../server');
const authCrypto = require('../auth/crypto');

let server, baseUrl;
const EMAIL = 'h4.teste@coevo.local';

test.before(async () => {
  const store = await readStore();
  store.users.push({ id: 'usr-h4-teste', name: 'H4 Teste', email: EMAIL, role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h4-teste', passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
  await writeStore(store);
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

async function raw(method, pathname, { token, json, headers } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : undefined
  });
}
async function api(method, pathname, opts = {}) {
  const res = await raw(method, pathname, opts);
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
}
async function loginAs(email) {
  const login = await api('POST', '/api/auth/login', { json: { email, password: process.env.COEVO_DEMO_PASSWORD } });
  assert.equal(login.status, 200, `login deveria aceitar credenciais válidas para ${email}: ${JSON.stringify(login.body)}`);
  return login.body.token;
}

// --- 36. TESTES CSP ------------------------------------------------------------------------------
test('[H4-CSP-A] GET / (página principal) retorna Content-Security-Policy', async () => {
  const res = await api('GET', '/');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-security-policy'), 'CSP deve estar presente em respostas HTML');
});

test('[H4-CSP-B] CSP não contém wildcard inseguro (default-src */script-src *)', async () => {
  const res = await api('GET', '/');
  const csp = res.headers.get('content-security-policy');
  assert.doesNotMatch(csp, /default-src\s+\*/);
  assert.doesNotMatch(csp, /script-src[^;]*\*/);
  assert.match(csp, /default-src\s+'self'/);
});

test('[H4-CSP-C] frame-ancestors está presente e nega tudo (proteção contra clickjacking)', async () => {
  const res = await api('GET', '/');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors\s+'none'/);
});

test('[H4-CSP-D] object-src é \'none\'', async () => {
  const res = await api('GET', '/');
  assert.match(res.headers.get('content-security-policy'), /object-src\s+'none'/);
});

test('[H4-CSP-E] base-uri está definido (\'self\')', async () => {
  const res = await api('GET', '/');
  assert.match(res.headers.get('content-security-policy'), /base-uri\s+'self'/);
});

test('[H4-CSP-F] frontend real continua carregando: index.html, app.js, styles.css, status.html/js/css respondem 200 com Content-Type correto', async () => {
  const index = await api('GET', '/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  const appJs = await api('GET', '/app.js');
  assert.equal(appJs.status, 200);
  assert.match(appJs.headers.get('content-type'), /text\/javascript/);
  const stylesCss = await api('GET', '/styles.css');
  assert.equal(stylesCss.status, 200);
  assert.match(stylesCss.headers.get('content-type'), /text\/css/);
  const statusHtml = await api('GET', '/status');
  assert.equal(statusHtml.status, 200);
  assert.match(statusHtml.headers.get('content-type'), /text\/html/);
  const statusJs = await api('GET', '/status.js');
  assert.equal(statusJs.status, 200);
  assert.match(statusJs.headers.get('content-type'), /text\/javascript/);
  const statusCss = await api('GET', '/status.css');
  assert.equal(statusCss.status, 200);
  assert.match(statusCss.headers.get('content-type'), /text\/css/);
  // status.html não deve mais conter <script>/<style> inline — foram extraídos para arquivos externos.
  assert.ok(!String(statusHtml.body).includes('<script>'), 'status.html não deve ter <script> inline após a extração para status.js');
  assert.ok(!String(statusHtml.body).includes('<style>'), 'status.html não deve ter <style> inline após a extração para status.css');
});

// --- 37. TESTES HSTS ------------------------------------------------------------------------------
test('[H4-HSTS-A/B/C] HSTS presente só em produção, com o valor correto; ausente em test/development', async () => {
  const resTest = await api('GET', '/api/health');
  assert.equal(resTest.headers.get('strict-transport-security'), null, 'NODE_ENV=test não deve enviar HSTS');

  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const resProd = await api('GET', '/api/health');
    assert.equal(resProd.headers.get('strict-transport-security'), 'max-age=31536000');
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

// --- 38. TESTES FRAME -----------------------------------------------------------------------------
test('[H4-frame] X-Frame-Options: DENY e CSP frame-ancestors \'none\' presentes em HTML e API', async () => {
  const html = await api('GET', '/');
  assert.equal(html.headers.get('x-frame-options'), 'DENY');
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors\s+'none'/);
  const apiRes = await api('GET', '/api/health');
  assert.equal(apiRes.headers.get('x-frame-options'), 'DENY');
  assert.match(apiRes.headers.get('content-security-policy'), /frame-ancestors\s+'none'/);
});

// --- 39. TESTES REFERRER --------------------------------------------------------------------------
test('[H4-referrer] Referrer-Policy é strict-origin-when-cross-origin', async () => {
  const res = await api('GET', '/api/health');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

// --- 40. TESTES PERMISSIONS-POLICY -----------------------------------------------------------------
test('[H4-permissions] Permissions-Policy presente e nega recursos não usados pelo Patrono', async () => {
  const res = await api('GET', '/api/health');
  const policy = res.headers.get('permissions-policy');
  assert.ok(policy);
  for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'bluetooth']) {
    assert.match(policy, new RegExp(`${feature}=\\(\\)`), `${feature} deve estar explicitamente negado`);
  }
});

// --- item 34: sem header Server/X-Powered-By ------------------------------------------------------
test('[H4-server-header] nenhuma resposta expõe Server ou X-Powered-By', async () => {
  const res = await api('GET', '/api/health');
  assert.equal(res.headers.get('x-powered-by'), null);
  // node:http nunca envia um header "Server" automático; confirma que nada o adicionou manualmente.
  assert.equal(res.headers.get('server'), null);
});

// --- 41-45. TESTES CORS ----------------------------------------------------------------------------
test('[H4-CORS-A] requisição sem Origin (same-origin) funciona normalmente, sem exigir ACAO', async () => {
  const res = await api('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'same-origin nunca precisa de Access-Control-Allow-Origin');
});

test('[H4-CORS-B] Origin explicitamente permitida via CORS_ALLOWED_ORIGINS recebe Access-Control-Allow-Origin exato (nunca *)', async () => {
  delete require.cache[require.resolve('../server')];
  process.env.CORS_ALLOWED_ORIGINS = 'https://app.exemplo.test';
  const { handler: handlerWithCors } = require('../server');
  const s2 = http.createServer(handlerWithCors);
  await new Promise(resolve => s2.listen(0, '127.0.0.1', resolve));
  const base2 = `http://127.0.0.1:${s2.address().port}`;
  try {
    const res = await fetch(`${base2}/api/health`, { headers: { Origin: 'https://app.exemplo.test' } });
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.exemplo.test');
    assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('vary'), 'Origin');
  } finally {
    await new Promise(resolve => s2.close(resolve));
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete require.cache[require.resolve('../server')];
  }
});

test('[H4-CORS-C] Origin NÃO configurada (negada) nunca recebe Access-Control-Allow-Origin — nunca reflete a Origin recebida', async () => {
  const res = await api('GET', '/api/health', { headers: { Origin: 'https://evil.test' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('[H4-CORS-D] ataque de sufixo de domínio (domain-suffix attack) é negado — allowlist exata, nunca endsWith/substring', async () => {
  delete require.cache[require.resolve('../server')];
  process.env.CORS_ALLOWED_ORIGINS = 'https://app.exemplo.com';
  const { handler: handlerWithCors } = require('../server');
  const s2 = http.createServer(handlerWithCors);
  await new Promise(resolve => s2.listen(0, '127.0.0.1', resolve));
  const base2 = `http://127.0.0.1:${s2.address().port}`;
  try {
    const res = await fetch(`${base2}/api/health`, { headers: { Origin: 'https://app.exemplo.com.evil.test' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null, 'um domínio que apenas TERMINA com a origem configurada nunca deve ser aceito');
  } finally {
    await new Promise(resolve => s2.close(resolve));
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete require.cache[require.resolve('../server')];
  }
});

test('[H4-CORS-E] Origin: null é sempre negada por padrão', async () => {
  const res = await api('GET', '/api/health', { headers: { Origin: 'null' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

// --- 46. PREFLIGHT TEST ----------------------------------------------------------------------------
test('[H4-preflight-A] OPTIONS com Origin permitida: status correto, ACAO/methods/headers corretos, sem body de negócio', async () => {
  delete require.cache[require.resolve('../server')];
  process.env.CORS_ALLOWED_ORIGINS = 'https://app.exemplo.test';
  const { handler: handlerWithCors } = require('../server');
  const s2 = http.createServer(handlerWithCors);
  await new Promise(resolve => s2.listen(0, '127.0.0.1', resolve));
  const base2 = `http://127.0.0.1:${s2.address().port}`;
  try {
    const res = await fetch(`${base2}/api/entities/legalDeadlines`, { method: 'OPTIONS', headers: { Origin: 'https://app.exemplo.test' } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.exemplo.test');
    assert.match(res.headers.get('access-control-allow-methods') || '', /GET/);
    assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
    assert.match(res.headers.get('access-control-allow-headers') || '', /Authorization/);
    const text = await res.text();
    assert.equal(text, '', 'preflight nunca deve devolver corpo de negócio');
  } finally {
    await new Promise(resolve => s2.close(resolve));
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete require.cache[require.resolve('../server')];
  }
});

test('[H4-preflight-B] OPTIONS com Origin negada: nenhum ACAO permissivo, ainda 204', async () => {
  const res = await raw('OPTIONS', '/api/entities/legalDeadlines', { headers: { Origin: 'https://evil.test' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

// --- 47. TESTE AUTH + CORS -------------------------------------------------------------------------
test('[H4-auth-cors] Origin permitida NÃO elimina autenticação — endpoint autenticado sem Bearer token continua 401', async () => {
  delete require.cache[require.resolve('../server')];
  process.env.CORS_ALLOWED_ORIGINS = 'https://app.exemplo.test';
  const { handler: handlerWithCors } = require('../server');
  const s2 = http.createServer(handlerWithCors);
  await new Promise(resolve => s2.listen(0, '127.0.0.1', resolve));
  const base2 = `http://127.0.0.1:${s2.address().port}`;
  try {
    const res = await fetch(`${base2}/api/me`, { headers: { Origin: 'https://app.exemplo.test' } });
    assert.equal(res.status, 401, 'CORS nunca substitui autenticação — mesmo de uma origem permitida, sem token continua 401');
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.exemplo.test', 'os headers de CORS continuam presentes mesmo na resposta 401');
  } finally {
    await new Promise(resolve => s2.close(resolve));
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete require.cache[require.resolve('../server')];
  }
});

// --- 49. TESTE ERROR RESPONSES ----------------------------------------------------------------------
test('[H4-errors] respostas 401/403/404 continuam com os headers de segurança H4', async () => {
  const unauthorized = await api('GET', '/api/me');
  assert.equal(unauthorized.status, 401);
  assert.ok(unauthorized.headers.get('content-security-policy'));
  assert.equal(unauthorized.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(unauthorized.headers.get('cache-control'), 'no-store');

  // Uma rota /api/* inexistente exige autenticação ANTES de chegar ao fallback 404 (mesmo
  // comportamento de qualquer outra rota de negócio) — por isso o token é necessário aqui para
  // realmente exercitar o caminho 404, não o 401 de "sem sessão válida" (já coberto acima).
  const token = await loginAs(EMAIL);
  const notFound = await api('GET', '/api/rota-inexistente-h4', { token });
  assert.equal(notFound.status, 404);
  assert.ok(notFound.headers.get('content-security-policy'));
  assert.equal(notFound.headers.get('x-content-type-options'), 'nosniff');

  const forbidden = await api('DELETE', '/api/entities/legalDeadlines/nao-existe', { token });
  assert.ok(forbidden.headers.get('content-security-policy'));
});

// --- 30. HEALTHCHECK --------------------------------------------------------------------------------
test('[H4-health] healthcheck recebe os headers básicos de segurança; CORS segue a mesma política', async () => {
  const res = await api('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'sem Origin permitida configurada, nenhum ACAO é concedido nem no healthcheck');
});

// --- 35. MIME TYPES ---------------------------------------------------------------------------------
test('[H4-mime] arquivos estáticos recebem Content-Type correto para cada extensão servida', async () => {
  const cases = [
    ['/', /text\/html/],
    ['/app.js', /text\/javascript/],
    ['/styles.css', /text\/css/],
    ['/logo-coevo-light.png', /image\/png/]
  ];
  for (const [pathname, expected] of cases) {
    const res = await api('GET', pathname);
    assert.equal(res.status, 200, `${pathname} deveria responder 200`);
    assert.match(res.headers.get('content-type'), expected, `${pathname} deveria ter Content-Type ${expected}`);
  }
});

// --- 48. TESTE 429 (integração com H3) ---------------------------------------------------------------
// O único cenário deste arquivo que genuinamente depende de PostgreSQL: H3 (rate limiting) fica inerte
// no fallback JSON (docs/DECISIONS.md, PROD-H3-01, item 47) — sem Postgres, nenhuma requisição jamais
// chega a 429, então este teste não teria como validar nada e é explicitamente pulado, nunca fingindo
// cobertura que não existe (mesmo padrão de docs/PRODUCTION_GATE.md, seção 28).
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  test('[H4-429] pulado — TEST_DATABASE_URL não configurada (429 de H3 exige PostgreSQL; ver docs/PRODUCTION_GATE.md, seção 28)', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');

  test('[H4-429] resposta 429 de H3 continua com Retry-After, headers de segurança H4 e política CORS corretos', async () => {
    const isolatedDbName = `patrono_h4_http_test_${process.pid}_${Date.now()}`;
    const admin = new Pool({ connectionString: TEST_DATABASE_URL });
    await admin.query(`CREATE DATABASE ${isolatedDbName}`);
    await admin.end();
    const isolatedUrl = TEST_DATABASE_URL.replace(/\/[^/]+$/, `/${isolatedDbName}`);
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = isolatedUrl;
    process.env.RATE_LIMIT_HMAC_KEY = process.env.RATE_LIMIT_HMAC_KEY || 'test-rate-limit-hmac-key-at-least-32-characters';

    delete require.cache[require.resolve('../scripts/migrate')];
    const { run: migrate } = require('../scripts/migrate');
    await migrate();
    const cutoverPool = new Pool({ connectionString: isolatedUrl });
    await cutoverPool.query("INSERT INTO data_migrations (key) VALUES ('h1b_core_relational_cutover') ON CONFLICT (key) DO NOTHING");
    await cutoverPool.end();

    delete require.cache[require.resolve('../server')];
    delete require.cache[require.resolve('../storage')];
    delete require.cache[require.resolve('../auth/rate-limit')];
    const pgServerModule = require('../server');
    await pgServerModule.storage.init();
    const pgStore = await pgServerModule.readStore();
    pgStore.users.push({ id: 'usr-h4-429', name: 'H4 429 Teste', email: 'h4.429@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h4-429', passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
    await pgServerModule.writeStore(pgStore);

    const s2 = http.createServer(pgServerModule.handler);
    await new Promise(resolve => s2.listen(0, '127.0.0.1', resolve));
    const base2 = `http://127.0.0.1:${s2.address().port}`;
    try {
      let blocked;
      // loginCombined: max 8/janela — a 9ª tentativa deve bloquear.
      for (let i = 0; i < 9; i++) {
        blocked = await fetch(`${base2}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'h4.429@coevo.local', password: 'senha-errada-h4' }) });
      }
      assert.equal(blocked.status, 429);
      assert.ok(blocked.headers.get('retry-after'), 'H3 continua enviando Retry-After');
      assert.ok(blocked.headers.get('content-security-policy'), 'H4 continua aplicando CSP mesmo em respostas 429');
      assert.equal(blocked.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(blocked.headers.get('x-frame-options'), 'DENY');
      assert.equal(blocked.headers.get('cache-control'), 'no-store');
    } finally {
      await new Promise(resolve => s2.close(resolve));
      await pgServerModule.storage.close();
      const cleanup = new Pool({ connectionString: TEST_DATABASE_URL });
      await cleanup.query(`DROP DATABASE IF EXISTS ${isolatedDbName} WITH (FORCE)`);
      await cleanup.end();
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });
}
