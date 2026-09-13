// Sprint 2, Hardening H1A/H1B (docs/PRODUCTION_GATE.md, PG-01/PG-02/PG-03; docs/DECISIONS.md,
// PROD-H1-01/PROD-H1B-01): fachada única de persistência. server.js nunca fala com `pg`/`fs` diretamente
// — só com esta fachada, que decide o backend UMA vez por processo (`configure()`, chamado no boot) e
// nunca faz dual-write.
//
// H1B acrescenta uma PONTE RELACIONAL, ativa só quando o backend é PostgreSQL: users/legalProcesses
// (=store.records.processos)/legalDeadlines (=store.records.legalDeadlines)/audit (=store.audit) deixam
// de ser serializados dentro do documento JSONB `app_store` e passam a viver em tabelas próprias
// (migrations/004_h1b_core_relational.sql). A ponte é TRANSPARENTE para server.js: `readStore()`
// continua devolvendo `store.users`/`store.records.processos`/`store.records.legalDeadlines`/
// `store.audit` no MESMO formato de sempre — só a origem/destino de fato mudou. Nenhuma das ~24 rotas de
// mutação em server.js precisou ser alterada.
//
// Mecanismo (ver README de arquitetura em docs/DATA_MODEL.md): a cada `readStore()`, a ponte hidrata
// essas 4 coleções a partir das tabelas relacionais e guarda uma cópia ("baseline") não-enumerável no
// próprio objeto `store`. A cada `writeStore()`, a ponte compara o conteúdo ATUAL dessas 4 coleções
// contra o baseline (diff por `id`): id novo ⇒ INSERT; id existente com conteúdo alterado ⇒ UPDATE com
// CAS por linha (`version`); nada muda ⇒ nenhuma escrita relacional. Tudo isso roda DENTRO da mesma
// transação Postgres que grava o restante do documento `app_store` (sem essas 4 coleções, que nunca mais
// são serializadas ali) — atomicidade real (ex.: Legal Deadline + evento de auditoria: os dois são
// persistidos juntos ou nenhum dos dois).
//
// IMPORTANTE (runbook de deploy do H1B): a ponte só funciona corretamente quando as tabelas relacionais
// já contêm os dados antes existentes no blob. A ordem obrigatória é: (1) `npm run migrate` (aplica
// 004_h1b_core_relational); (2) `npm run migrate:h1b:data` (extrai users/legalProcesses/legalDeadlines/
// audit do app_store existente para as tabelas relacionais, com --dry-run disponível antes); só então
// (3) subir o processo normalmente. Rodar o processo entre (1) e (2) faz a ponte hidratar as 4 coleções
// como vazias — nenhuma leitura falha, mas qualquer escrita subsequente deixaria de reconciliar o dado
// antigo do blob (que só é migrado pelo passo (2)). Ver docs/DECISIONS.md, PROD-H1B-01.
const { FailFastError, StoreConflictError } = require('./errors');
const repositories = require('./repositories');

let backend = null;
let configuredSeed = null;

function isProductionEnv(nodeEnv) { return nodeEnv === 'production'; }

// `databaseUrl` presente ⇒ PostgreSQL é a persistência canônica (única fonte da verdade). Ausente ⇒
// fallback local explícito (JSON), permitido só fora de produção — em produção sem DATABASE_URL, o
// processo nunca deve subir silenciosamente em modo arquivo (fail-fast, P0 do Gate de Produção).
function configure({ databaseUrl, nodeEnv, dataDir, seed, ssl = false } = {}) {
  configuredSeed = seed;
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

function isRelationalBridgeActive() { return backend && backend.mode === 'postgres'; }

const CORE_BASELINE = Symbol('coreEntitiesBaseline');

async function hydrateCoreEntities(store) {
  const pool = backend.getPool();
  const [users, processos, legalDeadlines, auditEvents] = await Promise.all([
    repositories.users.list(pool),
    repositories.legalProcesses.list(pool),
    repositories.legalDeadlines.list(pool),
    repositories.audit.list(pool)
  ]);
  store.users = users;
  if (!store.records) store.records = {};
  store.records.processos = processos;
  store.records.legalDeadlines = legalDeadlines;
  store.audit = auditEvents;
  // Baseline precisa ser uma cópia PROFUNDA e independente — as rotas de server.js mutam
  // `store.users`/`store.records.processos`/`store.records.legalDeadlines`/`store.audit` IN PLACE
  // (push/Object.assign). Se o baseline apontasse para os MESMOS arrays/objetos, a mutação em memória
  // também alteraria o baseline, e o diff em writeStore() nunca veria nada como "alterado".
  Object.defineProperty(store, CORE_BASELINE, {
    value: structuredClone({ users, processos, legalDeadlines, auditCount: auditEvents.length }),
    enumerable: false,
    configurable: true
  });
}

// Diff genérico por `id`: usado para as 3 coleções que suportam create+update (users/legalProcesses/
// legalDeadlines). Nunca emite DELETE — nenhuma rota atual remove item dessas coleções (soft-delete via
// `deletedAt` é uma UPDATE normal, coberta pelo mesmo caminho).
async function diffAndPersist(client, repo, current, baseline) {
  const baselineMap = new Map((baseline || []).map(item => [item.id, item]));
  for (const item of current || []) {
    const before = baselineMap.get(item.id);
    if (!before) {
      await repo.insert(client, item);
    } else if (JSON.stringify(before) !== JSON.stringify(item)) {
      const result = await repo.update(client, item, before.version);
      if (result === null) throw new StoreConflictError();
    }
  }
}

// audit é append-only — nunca há UPDATE, só as entradas além do tamanho lido na hidratação (baseline)
// são persistidas.
async function persistNewAuditEvents(client, currentAudit, baselineCount) {
  const newEvents = (currentAudit || []).slice(baselineCount || 0);
  for (const event of newEvents) await repositories.audit.append(client, event);
}

async function persistCoreEntities(client, store, baseline) {
  await diffAndPersist(client, repositories.users, store.users, baseline.users);
  await diffAndPersist(client, repositories.legalProcesses, store.records && store.records.processos, baseline.processos);
  await diffAndPersist(client, repositories.legalDeadlines, store.records && store.records.legalDeadlines, baseline.legalDeadlines);
  await persistNewAuditEvents(client, store.audit, baseline.auditCount);
}

async function init() {
  await requireBackend().init();
  if (isRelationalBridgeActive()) {
    // Bootstrap idempotente dos usuários seed — mesmo padrão do `bootstrapIfEmpty()` do blob H1A: só
    // popula id que ainda não existe, nunca sobrescreve dado real já persistido. Resolve o problema de
    // "ovo e galinha" de uma instalação nova (sem isso, ninguém conseguiria logar num Postgres recém-
    // migrado, já que a ponte relacional hidrataria `store.users` como vazio a partir de uma tabela
    // igualmente vazia).
    await repositories.users.bootstrapSeed(backend.getPool(), (configuredSeed && configuredSeed.users) || []);
  }
}

async function readStore() {
  const store = await requireBackend().read();
  if (isRelationalBridgeActive()) await hydrateCoreEntities(store);
  return store;
}

async function writeStore(store) {
  if (!isRelationalBridgeActive()) return requireBackend().write(store);
  const baseline = store[CORE_BASELINE] || { users: [], processos: [], legalDeadlines: [], auditCount: 0 };
  const blobVersion = store[backend.VERSION];
  return backend.withTransaction(async client => {
    await persistCoreEntities(client, store, baseline);
    // As 4 coleções nunca são serializadas dentro do app_store depois de H1B — retirar antes de gravar
    // o restante do documento evita dual-write (a tabela relacional é a única fonte para elas).
    const blobStore = { ...store };
    delete blobStore.users;
    delete blobStore.audit;
    if (blobStore.records) {
      blobStore.records = { ...blobStore.records };
      delete blobStore.records.processos;
      delete blobStore.records.legalDeadlines;
    }
    const newBlobVersion = await backend.writeBlobTx(client, blobStore, blobVersion);
    if (newBlobVersion != null) Object.defineProperty(store, backend.VERSION, { value: newBlobVersion, enumerable: false, configurable: true });
    // Re-hidrata o baseline com o estado recém-persistido, para que uma segunda writeStore() no MESMO
    // objeto `store` (raro, mas não impossível dentro de uma mesma requisição) compare contra o estado
    // correto em vez do baseline antigo. Cópia profunda pelo mesmo motivo do baseline inicial (evitar
    // que uma mutação em memória subsequente também altere o baseline por referência compartilhada).
    Object.defineProperty(store, CORE_BASELINE, {
      value: structuredClone({ users: store.users || [], processos: (store.records && store.records.processos) || [], legalDeadlines: (store.records && store.records.legalDeadlines) || [], auditCount: (store.audit || []).length }),
      enumerable: false,
      configurable: true
    });
    return store;
  });
}

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
function reset() { backend = null; configuredSeed = null; }

module.exports = { configure, init, readStore, writeStore, healthcheck, close, mode, reset };
