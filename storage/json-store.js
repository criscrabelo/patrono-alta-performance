// Sprint 2, Hardening H1A: fallback local explícito, permitido apenas fora de produção (ver
// storage/index.js — NODE_ENV=production sem DATABASE_URL nunca chega aqui, é FailFastError antes).
// Extraído do antigo ensureStore()/readStore()/writeStore() de server.js, agora com a MESMA semântica
// de versão/CAS do backend Postgres (storage/postgres-store.js), para que a mesma bateria de testes de
// concorrência valha para os dois backends.
const fs = require('node:fs');
const path = require('node:path');
const { StoreConflictError, StoreUnavailableError } = require('./errors');

function createJsonStore({ dataDir, seed }) {
  if (!dataDir) throw new Error('createJsonStore requer dataDir');
  const dbFile = path.join(dataDir, 'store.json');
  const VERSION = Symbol('storeVersion');

  function ensureFile() {
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({ version: 1, data: seed }, null, 2));
  }

  // Compat: um arquivo gravado antes do H1A é o objeto puro da store (sem o envelope {version,data}).
  // Tratado como version=1 na primeira leitura; a próxima escrita já grava no formato novo — migração
  // silenciosa e sem perda, nunca um erro de "formato desconhecido".
  function parseEnvelope(raw) {
    const parsed = JSON.parse(raw);
    const isLegacyShape = !parsed || typeof parsed !== 'object' || !('data' in parsed) || !('version' in parsed);
    return isLegacyShape ? { version: 1, data: parsed } : parsed;
  }

  async function init() { ensureFile(); }

  async function healthcheck() {
    try { ensureFile(); JSON.parse(fs.readFileSync(dbFile, 'utf8')); return { reachable: true, schemaReady: true }; }
    catch { return { reachable: false, schemaReady: false }; }
  }

  async function read() {
    ensureFile();
    let envelope;
    try { envelope = parseEnvelope(fs.readFileSync(dbFile, 'utf8')); }
    catch (error) { throw new StoreUnavailableError(`Não foi possível ler ${dbFile}: ${error.message}`); }
    const data = envelope.data;
    Object.defineProperty(data, VERSION, { value: envelope.version, enumerable: false, configurable: true });
    return data;
  }

  async function write(store) {
    ensureFile();
    const expectedVersion = store[VERSION];
    let currentVersion;
    try { currentVersion = parseEnvelope(fs.readFileSync(dbFile, 'utf8')).version; }
    catch (error) { throw new StoreUnavailableError(`Não foi possível ler ${dbFile}: ${error.message}`); }
    // Sem versão anexada (objeto não veio de um read() desta store) — grava incondicionalmente, mesma
    // salvaguarda do backend Postgres (ver storage/postgres-store.js).
    if (expectedVersion !== undefined && currentVersion !== expectedVersion) throw new StoreConflictError();
    const nextVersion = (expectedVersion === undefined ? currentVersion : expectedVersion) + 1;
    fs.writeFileSync(dbFile, JSON.stringify({ version: nextVersion, data: store }, null, 2));
    Object.defineProperty(store, VERSION, { value: nextVersion, enumerable: false, configurable: true });
    return store;
  }

  async function close() {}

  return { mode: 'json-local-fallback', init, read, write, healthcheck, close };
}

module.exports = { createJsonStore };
