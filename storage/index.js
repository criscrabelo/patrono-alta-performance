// Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, PG-01/PG-02/PG-03; docs/DECISIONS.md, PROD-H1-01):
// fachada única de persistência. server.js nunca fala com `pg`/`fs` diretamente — só com esta fachada,
// que decide o backend UMA vez por processo (`configure()`, chamado no boot) e nunca faz dual-write.
const { FailFastError } = require('./errors');

let backend = null;

function isProductionEnv(nodeEnv) { return nodeEnv === 'production'; }

// `databaseUrl` presente ⇒ PostgreSQL é a persistência canônica (única fonte da verdade). Ausente ⇒
// fallback local explícito (JSON), permitido só fora de produção — em produção sem DATABASE_URL, o
// processo nunca deve subir silenciosamente em modo arquivo (fail-fast, P0 do Gate de Produção).
function configure({ databaseUrl, nodeEnv, dataDir, seed, ssl = false } = {}) {
  if (databaseUrl) {
    const { createPostgresStore } = require('./postgres-store');
    backend = createPostgresStore({ databaseUrl, ssl, seed });
  } else if (isProductionEnv(nodeEnv)) {
    throw new FailFastError('DATABASE_URL é obrigatório quando NODE_ENV=production — persistência local (JSON) nunca é usada silenciosamente em produção (docs/PRODUCTION_GATE.md, PG-01/PG-22).');
  } else {
    const { createJsonStore } = require('./json-store');
    backend = createJsonStore({ dataDir, seed });
  }
  return backend;
}

function requireBackend() {
  if (!backend) throw new Error('storage.configure() precisa ser chamado antes de qualquer leitura/escrita de store.');
  return backend;
}

async function init() { return requireBackend().init(); }
async function readStore() { return requireBackend().read(); }
async function writeStore(store) { return requireBackend().write(store); }
async function healthcheck() {
  const active = requireBackend();
  const result = await active.healthcheck();
  return { mode: active.mode, ...result };
}
async function close() { if (backend) await backend.close(); }
function mode() { return backend ? backend.mode : null; }
// Exposto só para os testes poderem reconfigurar o backend entre suites isoladas (COEVO_DATA_DIR já
// cumpre esse papel para o modo JSON; suites que testam o modo Postgres chamam configure() de novo
// apontando para um DATABASE_URL de teste isolado).
function reset() { backend = null; }

module.exports = { configure, init, readStore, writeStore, healthcheck, close, mode, reset };
