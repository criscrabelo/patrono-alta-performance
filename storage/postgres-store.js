// Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, PG-01/PG-02/PG-03): PostgreSQL passa a ser a
// persistência CANÔNICA do runtime quando DATABASE_URL está configurada. Arquitetura escolhida
// deliberadamente (ver docs/DECISIONS.md, PROD-H1-01): a store inteira (o mesmo objeto que hoje vive
// em data/store.json) é guardada como UM documento JSONB em `app_store` (id fixo = 1), em vez de
// normalizar cada entidade em tabela própria. Isso:
//   - preserva o contrato de `readStore()`/`writeStore()` usado por ~24 pontos em server.js sem
//     reescrever cada rota de mutação;
//   - dá concorrência otimista REAL (coluna `version`, UPDATE condicional) e atomicidade REAL (cada
//     escrita é um único UPDATE — mutação + auditoria, que já vivem no mesmo objeto JS, são persistidas
//     juntas ou nenhuma das duas, nunca um estado parcial);
//   - NÃO cria FK relacionais entre entidades (Legal Process → Legal Deadline, responsibleUserId →
//     users continuam validados só em JS, exatamente como hoje). Isso é H1B (normalização progressiva
//     por entidade), deliberadamente fora desta rodada — não fechar esse gap silenciosamente.
const { StoreConflictError, StoreUnavailableError } = require('./errors');

const APP_STORE_ID = 1;

function createPostgresStore({ databaseUrl, ssl = false, seed }) {
  if (!databaseUrl) throw new Error('createPostgresStore requer databaseUrl');
  // Pool único, reaproveitado por toda a vida do processo — corrige o padrão anterior de
  // `database.js` (`pool()`/`query()`), que abria e derrubava um Pool a cada chamada, o oposto do que
  // um pool de conexões deve fazer.
  const { Pool } = require('pg');
  // connectionTimeoutMillis evita que uma tentativa de conexão a um host inalcançável (ex.: healthcheck
  // contra um Postgres fora do ar) fique pendurada indefinidamente — falha rápido e reporta `reachable:
  // false`, em vez de travar a requisição.
  const pool = new Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 5000, ssl: ssl ? { rejectUnauthorized: true } : false });

  // Versão lida junto ao dado, para o CAS (compare-and-swap) de `write()`. Anexada como propriedade
  // não enumerável no objeto devolvido por `read()`, para que `JSON.stringify`/spread do restante do
  // código (que nunca soube da existência de "versão de storage") continuem funcionando exatamente
  // como hoje — só `write()` a lê de volta.
  const VERSION = Symbol('storeVersion');

  const REQUIRED_MIGRATION = '003_app_store';
  const REQUIRED_COLUMNS = ['id', 'data', 'version', 'updated_at'];
  const MIGRATE_HINT = 'Rode "npm run migrate" para aplicar as migrations pendentes antes de iniciar a aplicação.';

  // Valida (nunca cria) o schema canônico. O runtime NUNCA deve substituir migration por
  // `CREATE TABLE IF NOT EXISTS`: isso mascararia um banco sem `schema_migrations` populado ou com
  // `app_store` em formato incompatível/antigo, fazendo a aplicação operar sobre um schema que ela não
  // pode garantir ser o esperado. `scripts/migrate.js` continua sendo o único caminho responsável por
  // criar/evoluir o schema (docs/PRODUCTION_GATE.md, PG-03).
  async function validateSchema() {
    const migrationsTable = await pool.query('SELECT to_regclass($1) AS reg', ['schema_migrations']);
    if (!migrationsTable.rows[0] || !migrationsTable.rows[0].reg) {
      throw new StoreUnavailableError(
        `Schema do PostgreSQL não inicializado: tabela "schema_migrations" não existe. ${MIGRATE_HINT}`
      );
    }

    const applied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [REQUIRED_MIGRATION]
    );
    if (!applied.rows.length) {
      throw new StoreUnavailableError(
        `Schema do PostgreSQL incompatível: migration obrigatória "${REQUIRED_MIGRATION}" não foi aplicada. ${MIGRATE_HINT}`
      );
    }

    const appStoreTable = await pool.query('SELECT to_regclass($1) AS reg', ['app_store']);
    if (!appStoreTable.rows[0] || !appStoreTable.rows[0].reg) {
      throw new StoreUnavailableError(
        `Schema do PostgreSQL incompatível: tabela "app_store" não existe. ${MIGRATE_HINT}`
      );
    }

    const columns = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
      ['app_store']
    );
    const existingColumns = new Set(columns.rows.map(row => row.column_name));
    const missingColumns = REQUIRED_COLUMNS.filter(column => !existingColumns.has(column));
    if (missingColumns.length) {
      throw new StoreUnavailableError(
        `Schema do PostgreSQL incompatível: tabela "app_store" não possui a(s) coluna(s) esperada(s) (${missingColumns.join(', ')}). ${MIGRATE_HINT}`
      );
    }
  }

  async function bootstrapIfEmpty() {
    // Seed idempotente (equivalente a `ensureStore()` no modo JSON): só popula se a linha ainda não
    // existir — nunca sobrescreve dado real já persistido.
    await pool.query(
      'INSERT INTO app_store (id, data, version) VALUES ($1, $2, 1) ON CONFLICT (id) DO NOTHING',
      [APP_STORE_ID, JSON.stringify(seed)]
    );
  }

  async function init() {
    await validateSchema();
    await bootstrapIfEmpty();
  }

  async function healthcheck() {
    try {
      await pool.query('SELECT 1');
    } catch {
      return { reachable: false, schemaReady: false };
    }
    try {
      await validateSchema();
      return { reachable: true, schemaReady: true };
    } catch {
      // Banco alcançável, porém schema ausente/incompatível: reportado como não pronto, nunca lançado
      // aqui — quem decide se isso é fatal é o chamador (fail-fast no boot em init(); em healthcheck()
      // isto só alimenta GET /api/health, que deve responder 200 com schemaReady:false, não 503).
      return { reachable: true, schemaReady: false };
    }
  }

  async function read() {
    try {
      const { rows } = await pool.query('SELECT data, version FROM app_store WHERE id = $1', [APP_STORE_ID]);
      if (!rows.length) { await bootstrapIfEmpty(); return read(); }
      const store = rows[0].data;
      Object.defineProperty(store, VERSION, { value: rows[0].version, enumerable: false, configurable: true });
      return store;
    } catch (error) {
      throw new StoreUnavailableError(`Não foi possível ler a persistência PostgreSQL: ${error.message}`);
    }
  }

  async function write(store) {
    const expectedVersion = store[VERSION];
    try {
      if (expectedVersion === undefined) {
        // Sem versão anexada (ex.: objeto construído fora de um read() desta store, como um restore
        // de backup) — grava incondicionalmente. Ver server.js: hoje só o fluxo de restore cai aqui, e
        // já é bloqueado explicitamente para o backend Postgres (RESTORE_NOT_SUPPORTED_FOR_POSTGRES)
        // antes de chegar a este ponto — mantido aqui apenas como salvaguarda, não como caminho normal.
        const { rows } = await pool.query(
          'UPDATE app_store SET data = $1, version = version + 1, updated_at = now() WHERE id = $2 RETURNING version',
          [JSON.stringify(store), APP_STORE_ID]
        );
        if (rows.length) Object.defineProperty(store, VERSION, { value: rows[0].version, enumerable: false, configurable: true });
        return store;
      }
      const { rows } = await pool.query(
        'UPDATE app_store SET data = $1, version = version + 1, updated_at = now() WHERE id = $2 AND version = $3 RETURNING version',
        [JSON.stringify(store), APP_STORE_ID, expectedVersion]
      );
      if (!rows.length) throw new StoreConflictError();
      Object.defineProperty(store, VERSION, { value: rows[0].version, enumerable: false, configurable: true });
      return store;
    } catch (error) {
      if (error instanceof StoreConflictError) throw error;
      throw new StoreUnavailableError(`Não foi possível gravar na persistência PostgreSQL: ${error.message}`);
    }
  }

  async function close() { await pool.end(); }

  return { mode: 'postgres', init, read, write, healthcheck, close };
}

module.exports = { createPostgresStore };
