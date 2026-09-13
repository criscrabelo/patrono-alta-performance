// Sprint 2, Hardening H6 (docs/PRODUCTION_GATE.md, PG-17; docs/DECISIONS.md, PROD-H6-01): logger
// estruturado centralizado. Ver docs/OBSERVABILITY.md para o esquema completo, a semântica de cada
// nível e a política de dados permitidos/proibidos. Este módulo é a ÚNICA porta de saída de eventos
// operacionais da aplicação — nenhum outro arquivo deve montar `console.log(JSON.stringify(...))` à mão.
const { redact, sanitizeString } = require('./redaction');

const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];
const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

function resolveConfiguredLevel() {
  const raw = (process.env.LOG_LEVEL || 'info').trim().toLowerCase();
  if (LEVELS.includes(raw)) return raw;
  if ((process.env.NODE_ENV || 'development') === 'production') {
    // Falha segura: valor inválido de LOG_LEVEL em produção nunca degrada silenciosamente para DEBUG
    // (que poderia vazar detalhe operacional em excesso) — usa o padrão documentado INFO.
    return 'info';
  }
  return 'info';
}

let configuredLevel = resolveConfiguredLevel();

// Exposto apenas para os testes reconfigurarem o nível sem depender de reiniciar o processo.
function _setLevelForTests(level) {
  configuredLevel = LEVELS.includes(level) ? level : configuredLevel;
}

function isEnabled(level) {
  return LEVEL_RANK[level] >= LEVEL_RANK[configuredLevel];
}

function serviceName() {
  return process.env.SERVICE_NAME || 'patrono-alta-performance';
}

function environment() {
  return process.env.NODE_ENV || 'development';
}

function applicationCommit() {
  return process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || undefined;
}

// Seam de teste: permite aos testes capturarem exatamente o que seria escrito em stdout/stderr sem
// depender de sobrescrever process.stdout.write/process.stderr.write globalmente (frágil sob o test
// runner, que também usa esses streams para reportar progresso). Nunca usado fora de testes.
let testSink = null;
function _setTestSink(fn) { testSink = fn; }
function _clearTestSink() { testSink = null; }

// Cada evento estruturado é exatamente UMA linha JSON — nunca múltiplas linhas, nunca texto livre solto.
function write(level, event, fields) {
  if (!isEnabled(level)) return;
  const base = {
    timestamp: new Date().toISOString(),
    level,
    event: sanitizeString(event),
    service: serviceName(),
    environment: environment()
  };
  const commit = applicationCommit();
  if (commit) base.applicationCommit = sanitizeString(commit);

  const safeFields = redact(fields || {});
  const line = { ...base, ...safeFields };
  if (!line.message) line.message = sanitizeString(event);

  const payload = JSON.stringify(line);
  if (testSink) return testSink(level, payload);
  if (level === 'error' || level === 'fatal') process.stderr.write(`${payload}\n`);
  else process.stdout.write(`${payload}\n`);
}

function debug(event, fields) { write('debug', event, fields); }
function info(event, fields) { write('info', event, fields); }
function warn(event, fields) { write('warn', event, fields); }
function error(event, fields) { write('error', event, fields); }
function fatal(event, fields) { write('fatal', event, fields); }

// Serializador seguro de erro — nunca JSON.stringify(error) cru, nunca o objeto de request/response.
function serializeError(err) {
  if (!err) return undefined;
  const serialized = {
    name: err.name,
    message: sanitizeString(err.message || String(err))
  };
  if (err.code) serialized.code = err.code;
  if (err.stack && environment() !== 'production') serialized.stack = sanitizeString(err.stack);
  if (err.cause) serialized.cause = sanitizeString(err.cause.message || String(err.cause));
  return serialized;
}

module.exports = {
  LEVELS,
  debug,
  info,
  warn,
  error,
  fatal,
  serializeError,
  isEnabled,
  _setLevelForTests,
  _resolveConfiguredLevelForTests: resolveConfiguredLevel,
  _setTestSink,
  _clearTestSink
};
