// Sprint 2, Hardening H6 (docs/PRODUCTION_GATE.md, PG-17; docs/DECISIONS.md, PROD-H6-01): logger
// estruturado, redaction, requestId/correlação, access log, health liveness/readiness e alerta
// provider-neutro. Ver docs/OBSERVABILITY.md para o esquema completo.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h6-'));
process.env.COEVO_DATA_DIR = TEST_DATA_DIR;
process.env.COEVO_DEMO_PASSWORD = 'h6-integration-test-password-0000000000';
process.env.COEVO_SESSION_MS = '300000';
process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY || 'test-mfa-encryption-key-at-least-32-characters';
process.env.NODE_ENV = 'test';
delete process.env.MONDAY_TOKEN;
delete process.env.CORS_ALLOWED_ORIGINS;
delete process.env.ALERT_WEBHOOK_URL;
delete process.env.ALERT_WEBHOOK_HMAC_KEY;

const { redact, sanitizeErrorMessage, sanitizeString, isSecretKey } = require('../observability/redaction');
const logger = require('../observability/logger');
const alert = require('../observability/alert');
const { sanitizeErrorMessage: backupSanitize } = require('../backup/sanitize');

// Captura tudo que o logger escreveria em stdout/stderr durante `fn`, via o test seam dedicado do
// logger (_setTestSink) — nunca sobrescrevendo process.stdout.write/process.stderr.write globalmente,
// que sob o test runner real interfere com a própria escrita de progresso dos testes (canal
// compartilhado). O sink recebe exatamente o mesmo payload JSON que sairia para stdout/stderr em
// produção; só o destino final (I/O real) é substituído.
async function captureLogLines(fn) {
  const lines = [];
  logger._setTestSink((level, payload) => { lines.push(JSON.parse(payload)); });
  try {
    await fn();
  } finally {
    logger._clearTestSink();
  }
  return lines;
}

// --- observability/redaction.js -----------------------------------------------------------------------
test('[H6-redact-A] redige DATABASE_URL/postgres connection string em texto livre', () => {
  const sanitized = sanitizeErrorMessage('conexão falhou: postgresql://user:supersecreta@host:5432/db');
  assert.ok(!sanitized.includes('supersecreta'));
  assert.match(sanitized, /\[REDACTED\]/);
});

test('[H6-redact-B] redige campo nomeado password/token/secret mesmo aninhado', () => {
  const out = redact({ user: { password: 'abc123', profile: { token: 'xyz', name: 'ok' } } });
  assert.equal(out.user.password, '[REDACTED]');
  assert.equal(out.user.profile.token, '[REDACTED]');
  assert.equal(out.user.profile.name, 'ok');
});

test('[H6-redact-C] tabela de segredos nunca aparece no output redigido', () => {
  const payload = {
    password: 'p', passwordHash: 'h', temporaryPassword: 't', authorization: 'Bearer abc',
    cookie: 'session=1', mfaSecret: 'JBSWY3DP', totpCode: '123456', resetToken: 'rt-1',
    MONDAY_TOKEN: 'mtk-1', BACKUP_ENCRYPTION_KEY: 'bek-1', RATE_LIMIT_HMAC_KEY: 'rlk-1',
    awsSecretKey: 'aws-1', DATABASE_URL: 'postgresql://a:b@c/d', PGPASSWORD: 'pw'
  };
  const out = redact(payload);
  for (const key of Object.keys(payload)) assert.equal(out[key], '[REDACTED]', `campo ${key} deveria estar redigido`);
});

test('[H6-redact-D] Bearer token dentro de string livre é redigido', () => {
  const sanitized = sanitizeString('Authorization: Bearer abcdef123456.token');
  assert.ok(!sanitized.includes('abcdef123456'));
});

// Correção pós-H6 (revisão técnica final, PR #17, item 3): o regex anterior ([a-z0-9._-]) não cobria
// o alfabeto completo de base64/base64url/JWT ("+", "/", "=") — um token com esses caracteres podia
// sobreviver PARCIALMENTE no log. Cobre explicitamente os 3 formatos citados na correção.
test('[H6-redact-Bearer] Bearer com "+"/"/"/"=" (base64) é redigido por inteiro, nunca parcialmente', () => {
  const casos = [
    { input: 'Authorization: Bearer abc+/DEF==', token: 'abc+/DEF==' },
    { input: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' },
    { input: 'Authorization: Bearer token-with_~chars+/=', token: 'token-with_~chars+/=' }
  ];
  for (const { input, token } of casos) {
    const sanitized = sanitizeString(input);
    assert.match(sanitized, /\[REDACTED\]/);
    assert.ok(!sanitized.includes(token), `o token inteiro nunca deveria sobreviver, mesmo parcialmente: ${sanitized}`);
    // Nenhum PREFIXO significativo do token (10+ caracteres) pode sobrar — cobre redação parcial.
    assert.ok(!sanitized.includes(token.slice(0, 10)), `um prefixo do token sobrou: ${sanitized}`);
  }
});

test('[H6-redact-E] remove CR/LF (impede injeção de linha de log) e trunca mensagens excessivas', () => {
  const withNewlines = sanitizeString('linha1\nlinha2\rlinha3');
  assert.ok(!withNewlines.includes('\n') && !withNewlines.includes('\r'));
  const huge = sanitizeString('a'.repeat(5000));
  assert.ok(huge.length < 5000);
  assert.match(huge, /TRUNCATED/);
});

test('[H6-redact-F] backup/sanitize.js reaproveita observability/redaction sem mudar comportamento público', () => {
  const message = 'postgres://user:senha@host/db password=outro';
  const sanitized = backupSanitize(message);
  assert.ok(!sanitized.includes('senha') && !sanitized.includes('outro'));
});

test('[H6-redact-G] isSecretKey() reconhece variações de caixa/nome', () => {
  assert.ok(isSecretKey('Authorization'));
  assert.ok(isSecretKey('mfaSecret'));
  assert.ok(isSecretKey('BACKUP_ENCRYPTION_KEY'));
  assert.ok(!isSecretKey('username'));
});

// --- observability/logger.js ---------------------------------------------------------------------------
test('[H6-logger-A] cada evento é exatamente uma linha JSON válida com os campos mínimos', async () => {
  const lines = await captureLogLines(() => {
    logger.info('test_event', { component: 'test', foo: 'bar' });
  });
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.equal(line.level, 'info');
  assert.equal(line.event, 'test_event');
  assert.ok(line.timestamp);
  assert.match(line.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(line.service);
  assert.ok(line.environment);
  assert.equal(line.foo, 'bar');
});

test('[H6-logger-B] nível DEBUG fica desabilitado por padrão (LOG_LEVEL=info)', async () => {
  logger._setLevelForTests('info');
  const lines = await captureLogLines(() => {
    logger.debug('should_not_appear', {});
    logger.info('should_appear', {});
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, 'should_appear');
});

test('[H6-logger-C] elevar LOG_LEVEL para debug reabilita o nível debug', async () => {
  logger._setLevelForTests('debug');
  try {
    const lines = await captureLogLines(() => logger.debug('debug_visible', {}));
    assert.equal(lines.length, 1);
  } finally {
    logger._setLevelForTests('info');
  }
});

test('[H6-logger-D] LOG_LEVEL inválido em produção usa fallback seguro INFO (nunca DEBUG)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLevel = process.env.LOG_LEVEL;
  try {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'nivel-invalido';
    assert.equal(logger._resolveConfiguredLevelForTests(), 'info');
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalLevel === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = originalLevel;
  }
});

test('[H6-logger-E] error/fatal saem em stderr; debug/info/warn em stdout', () => {
  logger._setLevelForTests('debug');
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const out = []; const err = [];
  process.stdout.write = (chunk) => { out.push(chunk); return true; };
  process.stderr.write = (chunk) => { err.push(chunk); return true; };
  try {
    // Puramente síncrono (sem await entre a substituição e a restauração) — nunca cede o event loop
    // para nenhuma outra escrita concorrente interferir na captura.
    logger.info('to_stdout', {});
    logger.error('to_stderr', {});
    logger.fatal('to_stderr_fatal', {});
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
    logger._setLevelForTests('info');
  }
  assert.equal(out.length, 1);
  assert.equal(err.length, 2);
});

test('[H6-logger-F] campos passados ao logger são redigidos (nunca vaza segredo por descuido do chamador)', async () => {
  const lines = await captureLogLines(() => {
    logger.error('auth_login_failed', { component: 'auth', password: 'senha-real', requestId: 'r1' });
  });
  assert.equal(lines[0].password, '[REDACTED]');
  assert.equal(lines[0].requestId, 'r1');
});

test('[H6-logger-G] serializeError() nunca inclui stack em produção e nunca faz JSON.stringify(error) cru', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const err = new Error('mensagem com postgres://user:pw@host/db');
    const serialized = logger.serializeError(err);
    assert.equal(serialized.stack, undefined);
    assert.ok(!serialized.message.includes('pw@host'));
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

// Correção pós-H6 (revisão técnica final, PR #17, item 1): `fields` nunca pode sobrescrever o envelope
// canônico do evento — antes disso, `{ ...base, ...safeFields }` permitia justamente essa falsificação.
test('[H6-logger-reserved] campos reservados (level/event/timestamp/service/environment) do chamador nunca sobrescrevem o envelope canônico', async () => {
  const before = Date.now();
  const lines = await captureLogLines(() => {
    logger.error('real_event', {
      level: 'debug',
      event: 'evento_falsificado',
      timestamp: '1999-01-01T00:00:00.000Z',
      service: 'servico-falso',
      environment: 'ambiente-falso',
      applicationCommit: 'commit-falso',
      requestId: 'r-real'
    });
  });
  assert.equal(lines.length, 1, 'o evento real (ERROR) deveria ter sido emitido — nunca rebaixado a debug e descartado');
  const line = lines[0];
  assert.equal(line.level, 'error', 'fields.level nunca deveria rebaixar um evento ERROR real');
  assert.equal(line.event, 'real_event', 'fields.event nunca deveria substituir o nome do evento real');
  assert.notEqual(line.timestamp, '1999-01-01T00:00:00.000Z');
  assert.ok(Date.parse(line.timestamp) >= before, 'timestamp deveria continuar sendo gerado pelo servidor');
  assert.notEqual(line.service, 'servico-falso');
  assert.notEqual(line.environment, 'ambiente-falso');
  assert.equal(line.requestId, 'r-real', 'campos operacionais legítimos (requestId) continuam passando normalmente');
});

// --- observability/alert.js ----------------------------------------------------------------------------
function startLocalWebhook() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ headers: req.headers, body: body ? JSON.parse(body) : null });
      res.writeHead(200); res.end('ok');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port })));
}

test('[H6-alert-A] evento ERROR envia webhook real (servidor HTTP local, nunca a internet)', async () => {
  const { server, received, port } = await startLocalWebhook();
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  alert._resetCooldownForTests();
  try {
    const result = await alert.notify({ level: 'error', event: 'app_start_failed', message: 'falhou', dedupKey: 'test-A' });
    assert.equal(result.sent, true);
    assert.equal(received.length, 1);
    assert.equal(received[0].body.event, 'app_start_failed');
    assert.ok(received[0].body.timestamp);
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('[H6-alert-B] evento INFO abaixo de ALERT_MIN_LEVEL não envia webhook', async () => {
  const { server, received, port } = await startLocalWebhook();
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  alert._resetCooldownForTests();
  try {
    const result = await alert.notify({ level: 'info', event: 'algo_banal', dedupKey: 'test-B' });
    assert.equal(result.sent, false);
    assert.equal(received.length, 0);
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('[H6-alert-C] payload do webhook nunca carrega segredo (campos são redigidos)', async () => {
  const { server, received, port } = await startLocalWebhook();
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  alert._resetCooldownForTests();
  try {
    await alert.notify({ level: 'error', event: 'backup_failed', message: 'erro', dedupKey: 'test-C', fields: { password: 'segredo-real', databaseUrl: 'postgres://a:b@c/d' } });
    assert.equal(received[0].body.password, '[REDACTED]');
    assert.ok(!JSON.stringify(received[0].body).includes('segredo-real'));
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('[H6-alert-D] em produção, ALERT_WEBHOOK_URL http:// (não-https) é rejeitada', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => alert.validateWebhookUrl('http://example.com/hook'), /HTTPS/);
    assert.doesNotThrow(() => alert.validateWebhookUrl('https://example.com/hook'));
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test('[H6-alert-E] fora de produção, http:// é aceita (webhook local de teste/dev)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'test';
    assert.doesNotThrow(() => alert.validateWebhookUrl('http://127.0.0.1:9999/hook'));
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test('[H6-alert-F] falha de entrega nunca mascara o erro original nem derruba o processo', async () => {
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  process.env.ALERT_WEBHOOK_URL = 'http://127.0.0.1:1'; // porta fechada -> ECONNREFUSED
  alert._resetCooldownForTests();
  try {
    const result = await alert.notify({ level: 'error', event: 'evento_qualquer', dedupKey: 'test-F' });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'delivery_failed');
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
  }
});

test('[H6-alert-G] falha de entrega nunca gera um segundo alerta (sem recursão)', async () => {
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  process.env.ALERT_WEBHOOK_URL = 'http://127.0.0.1:1';
  alert._resetCooldownForTests();
  const lines = await captureLogLines(async () => {
    await alert.notify({ level: 'error', event: 'evento_x', dedupKey: 'test-G' });
  });
  process.env.ALERT_WEBHOOK_URL = originalUrl;
  const deliveryFailedEvents = lines.filter((l) => l.event === 'alert_delivery_failed');
  assert.equal(deliveryFailedEvents.length, 1, 'exatamente um log de falha, nunca um alerta recursivo sobre a própria falha');
});

test('[H6-alert-H] cooldown impede tempestade de alertas repetidos para a mesma chave', async () => {
  const { server, received, port } = await startLocalWebhook();
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  const originalCooldown = process.env.ALERT_COOLDOWN_MS;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  process.env.ALERT_COOLDOWN_MS = '300000';
  alert._resetCooldownForTests();
  try {
    const first = await alert.notify({ level: 'error', event: 'repeated', dedupKey: 'test-H' });
    const second = await alert.notify({ level: 'error', event: 'repeated', dedupKey: 'test-H' });
    assert.equal(first.sent, true);
    assert.equal(second.sent, false);
    assert.equal(second.reason, 'cooldown');
    assert.equal(received.length, 1);
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
    if (originalCooldown === undefined) delete process.env.ALERT_COOLDOWN_MS; else process.env.ALERT_COOLDOWN_MS = originalCooldown;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('[H6-alert-I] após o cooldown expirar, o mesmo evento volta a alertar', async () => {
  const { server, received, port } = await startLocalWebhook();
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  const originalCooldown = process.env.ALERT_COOLDOWN_MS;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  process.env.ALERT_COOLDOWN_MS = '50';
  alert._resetCooldownForTests();
  try {
    const first = await alert.notify({ level: 'error', event: 'repeated', dedupKey: 'test-I' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const second = await alert.notify({ level: 'error', event: 'repeated', dedupKey: 'test-I' });
    assert.equal(first.sent, true);
    assert.equal(second.sent, true);
    assert.equal(received.length, 2);
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
    if (originalCooldown === undefined) delete process.env.ALERT_COOLDOWN_MS; else process.env.ALERT_COOLDOWN_MS = originalCooldown;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('[H6-alert-J] assinatura HMAC é enviada quando ALERT_WEBHOOK_HMAC_KEY está configurada', async () => {
  const { server, received, port } = await startLocalWebhook();
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  const originalKey = process.env.ALERT_WEBHOOK_HMAC_KEY;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  process.env.ALERT_WEBHOOK_HMAC_KEY = 'chave-de-teste';
  alert._resetCooldownForTests();
  try {
    await alert.notify({ level: 'error', event: 'assinado', dedupKey: 'test-J' });
    const signature = received[0].headers['x-patrono-signature'];
    assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
    if (originalKey === undefined) delete process.env.ALERT_WEBHOOK_HMAC_KEY; else process.env.ALERT_WEBHOOK_HMAC_KEY = originalKey;
    await new Promise((resolve) => server.close(resolve));
  }
});

// Correção pós-H6 (revisão técnica final, PR #17, item 2): `fields` nunca pode sobrescrever o envelope
// canônico do payload de alerta (timestamp/service/environment/level/event/message/requestId/
// correlationId) — antes disso, `Object.assign(payload, redact(fields))` permitia exatamente isso.
test('[H6-alert-reserved] campos reservados do payload de alerta nunca são sobrescritos por `fields`', async () => {
  const { server, received, port } = await startLocalWebhook();
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  alert._resetCooldownForTests();
  try {
    await alert.notify({
      level: 'error',
      event: 'evento_real',
      message: 'mensagem real',
      requestId: 'req-real',
      dedupKey: 'test-reserved',
      fields: {
        timestamp: '1999-01-01T00:00:00.000Z',
        service: 'servico-falso',
        environment: 'ambiente-falso',
        level: 'info',
        event: 'evento_falsificado',
        message: 'mensagem falsificada',
        requestId: 'req-falso',
        correlationId: 'corr-falso',
        extra: 'valor-legitimo'
      }
    });
    const payload = received[0].body;
    assert.equal(payload.event, 'evento_real');
    assert.equal(payload.message, 'mensagem real');
    assert.equal(payload.requestId, 'req-real');
    assert.equal(payload.level, 'error');
    assert.notEqual(payload.timestamp, '1999-01-01T00:00:00.000Z');
    assert.notEqual(payload.service, 'servico-falso');
    assert.notEqual(payload.environment, 'ambiente-falso');
    assert.equal(payload.extra, 'valor-legitimo', 'um campo extra legítimo não reservado continua passando');
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});

// Correção pós-H6 (revisão técnica final, PR #17, item 6): o cooldown só é marcado APÓS entrega
// bem-sucedida — uma primeira tentativa que falha (webhook inalcançável) nunca deve suprimir um alerta
// futuro que nunca chegou a ser entregue.
test('[H6-alert-cooldown-after-success] entrega falha não marca cooldown; evento seguinte para o mesmo destino ainda alerta', async () => {
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  alert._resetCooldownForTests();
  try {
    process.env.ALERT_WEBHOOK_URL = 'http://127.0.0.1:1'; // ECONNREFUSED imediato
    const first = await alert.notify({ level: 'error', event: 'evento_repetido', dedupKey: 'test-cooldown-after-success' });
    assert.equal(first.sent, false);
    assert.equal(first.reason, 'delivery_failed');

    const { server, received, port } = await startLocalWebhook();
    try {
      process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
      const second = await alert.notify({ level: 'error', event: 'evento_repetido', dedupKey: 'test-cooldown-after-success' });
      assert.equal(second.sent, true, 'a falha anterior nunca deveria ter deixado o cooldown ativo para um alerta que nunca saiu');
      assert.equal(received.length, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
  }
});

// --- Threshold real de HTTP 5xx repetido (item 4) --------------------------------------------------
test('[H6-5xx-D] um único 500 isolado nunca dispara repeated_http_5xx (abaixo do threshold)', async () => {
  const { server, received, port } = await startLocalWebhook();
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  alert._resetCooldownForTests();
  try {
    const result = alert.recordHttp5xxAndMaybeNotify({ key: '/api/rota-d', route: '/api/rota-d', statusCode: 500, requestId: 'r1' });
    assert.equal(result.thresholdReached, false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(received.length, 0);
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('[H6-5xx-E] ocorrências abaixo do HTTP_5XX_ALERT_THRESHOLD nunca alertam', async () => {
  const { server, received, port } = await startLocalWebhook();
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  const originalThreshold = process.env.HTTP_5XX_ALERT_THRESHOLD;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  process.env.HTTP_5XX_ALERT_THRESHOLD = '5';
  alert._resetCooldownForTests();
  try {
    for (let i = 0; i < 4; i += 1) {
      alert.recordHttp5xxAndMaybeNotify({ key: '/api/rota-e', route: '/api/rota-e', statusCode: 500, requestId: `r${i}` });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(received.length, 0, '4 ocorrências abaixo do threshold de 5 nunca deveriam alertar');
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
    if (originalThreshold === undefined) delete process.env.HTTP_5XX_ALERT_THRESHOLD; else process.env.HTTP_5XX_ALERT_THRESHOLD = originalThreshold;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('[H6-5xx-F] ao atingir o threshold, o alerta repeated_http_5xx é disparado exatamente uma vez', async () => {
  const { server, received, port } = await startLocalWebhook();
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  const originalThreshold = process.env.HTTP_5XX_ALERT_THRESHOLD;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  process.env.HTTP_5XX_ALERT_THRESHOLD = '5';
  alert._resetCooldownForTests();
  try {
    for (let i = 0; i < 7; i += 1) {
      alert.recordHttp5xxAndMaybeNotify({ key: '/api/rota-f', route: '/api/rota-f', statusCode: 500, requestId: `r${i}` });
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(received.length, 1, '7 ocorrências acima do threshold de 5 deveriam alertar exatamente uma vez (a 7ª não deveria gerar um 2º alerta)');
    assert.equal(received[0].body.event, 'repeated_http_5xx');
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
    if (originalThreshold === undefined) delete process.env.HTTP_5XX_ALERT_THRESHOLD; else process.env.HTTP_5XX_ALERT_THRESHOLD = originalThreshold;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('[H6-5xx-G] após a janela expirar, o contador reinicia naturalmente (nova ocorrência conta a partir de 1)', async () => {
  const { server, received, port } = await startLocalWebhook();
  const originalUrl = process.env.ALERT_WEBHOOK_URL;
  const originalThreshold = process.env.HTTP_5XX_ALERT_THRESHOLD;
  const originalWindow = process.env.HTTP_5XX_ALERT_WINDOW_MS;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  process.env.HTTP_5XX_ALERT_THRESHOLD = '2';
  process.env.HTTP_5XX_ALERT_WINDOW_MS = '50';
  alert._resetCooldownForTests();
  try {
    alert.recordHttp5xxAndMaybeNotify({ key: '/api/rota-g', route: '/api/rota-g', statusCode: 500 });
    await new Promise((resolve) => setTimeout(resolve, 80)); // janela expira
    const afterWindow = alert.recordHttp5xxAndMaybeNotify({ key: '/api/rota-g', route: '/api/rota-g', statusCode: 500 });
    assert.equal(afterWindow.count, 1, 'a janela expirada deveria ter reiniciado o contador para 1, não acumulado com a ocorrência anterior');
    assert.equal(afterWindow.thresholdReached, false);
  } finally {
    process.env.ALERT_WEBHOOK_URL = originalUrl;
    if (originalThreshold === undefined) delete process.env.HTTP_5XX_ALERT_THRESHOLD; else process.env.HTTP_5XX_ALERT_THRESHOLD = originalThreshold;
    if (originalWindow === undefined) delete process.env.HTTP_5XX_ALERT_WINDOW_MS; else process.env.HTTP_5XX_ALERT_WINDOW_MS = originalWindow;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('[H6-state-bounded] estado de cooldown/threshold em memória nunca cresce indefinidamente', () => {
  alert._resetCooldownForTests();
  for (let i = 0; i < alert.MAX_TRACKED_KEYS + 50; i += 1) {
    alert.recordHttp5xxAndMaybeNotify({ key: `/api/rota-dinamica-${i}`, route: `/api/rota-dinamica-${i}`, statusCode: 500 });
  }
  const sizes = alert._stateSizesForTests();
  assert.ok(sizes.http5xxKeys <= alert.MAX_TRACKED_KEYS, `esperado <= ${alert.MAX_TRACKED_KEYS} chaves rastreadas, obtido ${sizes.http5xxKeys}`);
});

// --- server.js: requestId, access log, health, route normalization -------------------------------------
const { handler, readStore, writeStore, normalizeRouteForLogging } = require('../server');
const authCrypto = require('../auth/crypto');

let server, baseUrl;
const EMAIL = 'h6.teste@coevo.local';

test.before(async () => {
  const store = await readStore();
  store.users.push({ id: 'usr-h6-teste', name: 'H6 Teste', email: EMAIL, role: 'colaborador', department: 'Jurídico', mfa: false, loginIdentifier: 'usr-h6-teste', passwordHash: authCrypto.hashPassword(process.env.COEVO_DEMO_PASSWORD), temporaryPassword: false, credentialsVersion: 1, mfaEnabled: false, failedLoginCount: 0 });
  await writeStore(store);
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
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

test('[H6-route-A] normalizeRouteForLogging() converte UUID e id numérico em :id', () => {
  assert.equal(normalizeRouteForLogging(`/api/legal/processes/${crypto.randomUUID()}`), '/api/legal/processes/:id');
  assert.equal(normalizeRouteForLogging('/api/legal/processes/12345'), '/api/legal/processes/:id');
  assert.equal(normalizeRouteForLogging('/api/health'), '/api/health');
});

test('[H6-http-A] toda resposta carrega X-Request-Id, e o requestId aparece no access log estruturado (em DEBUG para /api/health de sucesso)', async () => {
  logger._setLevelForTests('debug');
  let lines;
  try {
    lines = await captureLogLines(async () => {
      const res = await api('GET', '/api/health');
      assert.ok(res.headers.get('x-request-id'));
    });
  } finally {
    logger._setLevelForTests('info');
  }
  const accessLine = lines.find((l) => l.event === 'http_request_completed' && l.route === '/api/health');
  assert.ok(accessLine, 'deveria existir um evento http_request_completed para /api/health');
  assert.equal(accessLine.level, 'debug', '/api/health com sucesso é debug (ruído de healthcheck), não info');
});

test('[H6-http-A2] em produção (LOG_LEVEL=info padrão), /api/health de sucesso NÃO aparece no log — nunca afoga o log com ruído de healthcheck', async () => {
  const lines = await captureLogLines(async () => {
    await api('GET', '/api/health');
  });
  assert.equal(lines.find((l) => l.event === 'http_request_completed' && l.route === '/api/health'), undefined);
});

test('[H6-http-B] access log nunca inclui corpo, query string ou Authorization — só method/route/status/duration', async () => {
  logger._setLevelForTests('debug');
  const lines = await captureLogLines(async () => {
    await api('GET', '/api/health?segredo=deveria-sumir');
  });
  logger._setLevelForTests('info');
  const accessLine = lines.find((l) => l.event === 'http_request_completed');
  assert.ok(accessLine);
  assert.ok(!('query' in accessLine) && !('body' in accessLine) && !('authorization' in accessLine));
  assert.ok(!JSON.stringify(accessLine).includes('deveria-sumir'));
});

test('[H6-http-C] 401 e 404 não são registrados como error (não classificação automática de 4xx)', async () => {
  const lines = await captureLogLines(async () => {
    await api('GET', '/api/nao-existe-rota');
    await api('POST', '/api/auth/login', { json: { email: EMAIL, password: 'senha-errada-com-certeza' } });
  });
  const errorLines = lines.filter((l) => l.level === 'error' && l.event === 'http_request_completed');
  assert.equal(errorLines.length, 0);
});

test('[H6-http-D] 500 real (via storage indisponível) gera log ERROR com requestId e nunca stack/segredo na resposta', async () => {
  const storage = require('../storage');
  const originalHealthcheck = storage.healthcheck;
  storage.healthcheck = () => { throw new Error('falha simulada de storage: postgres://user:senha@host/db'); };
  try {
    const lines = await captureLogLines(async () => {
      const res = await api('GET', '/api/health/ready');
      assert.equal(res.status, 503);
      const bodyText = JSON.stringify(res.body);
      assert.ok(!bodyText.includes('senha') && !bodyText.includes('stack'));
    });
    const errorLine = lines.find((l) => l.level === 'error' && l.event === 'readiness_check_failed');
    assert.ok(errorLine);
    assert.ok(errorLine.requestId);
    assert.ok(!JSON.stringify(errorLine).includes('senha'));
  } finally {
    storage.healthcheck = originalHealthcheck;
  }
});

test('[H6-health-A] GET /api/health/live nunca toca storage e sempre responde 200', async () => {
  const res = await api('GET', '/api/health/live');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('[H6-health-B] GET /api/health/ready nunca expõe DATABASE_URL ou detalhe sensível', async () => {
  const res = await api('GET', '/api/health/ready');
  assert.ok(res.status === 200 || res.status === 503);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('DATABASE_URL'));
  assert.ok(!('stack' in res.body));
});

test('[H6-headers-A] headers de segurança do H4 continuam presentes junto com X-Request-Id', async () => {
  const res = await api('GET', '/');
  assert.ok(res.headers.get('x-request-id'));
  assert.ok(res.headers.get('content-security-policy'));
});
