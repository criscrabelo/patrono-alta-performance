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

  async function ensureSchema() {
    // Idempotente: cria a tabela apenas se ainda não existir (a migration 003 já faz isso; isto é uma
    // rede de segurança para ambientes onde a migration ainda não rodou, sem duplicar o DDL dela).
    await pool.query(`CREATE TABLE IF NOT EXISTS app_store (
      id smallint PRIMARY KEY DEFAULT 1,
      data jsonb NOT NULL,
      version integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT app_store_singleton CHECK (id = 1)
    )`);
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
    await ensureSchema();
    await bootstrapIfEmpty();
  }

  async function healthcheck() {
    try {
      await pool.query('SELECT 1');
      const { rows } = await pool.query('SELECT to_regclass($1) AS reg', ['app_store']);
      return { reachable: true, schemaReady: Boolean(rows[0] && rows[0].reg) };
    } catch {
      return { reachable: false, schemaReady: false };
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
