// P0 — correção de sync Monday/Postgres (branch demo): classificação de erro transitório de conexão e
// um retry limitado com backoff. Usado especificamente no caminho de sincronização do Monday
// (runMondaySync(), server.js) — NUNCA uma política geral de retry sobre toda leitura/escrita do
// storage. Mudança escopada ao problema relatado: "the database system is not yet accepting
// connections" (banco acordando/reiniciando) e "Connection terminated unexpectedly" (conexão idle
// derrubada) são falhas transitórias de infraestrutura, não erros de dado — vale tentar de novo um
// número limitado de vezes, nunca em loop indefinido.
const TRANSIENT_ERROR_PATTERNS = [
  /the database system is not yet accepting connections/i,
  /the database system is starting up/i,
  /connection terminated unexpectedly/i,
  /server closed the connection unexpectedly/i,
  /econnrefused/i,
  /econnreset/i,
  /etimedout/i,
  /timeout expired/i,
  /connection.*reset/i,
  /client has encountered a connection error/i
];

function isTransientDbError(error) {
  const message = String(error?.message || error || '');
  return TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

// Backoff exponencial simples (baseDelayMs, 2x, 4x, ...), sem jitter — determinístico o suficiente para
// ser testado sem depender de tempo real além do próprio delay. `onRetry` é só para observação (logging
// estruturado pelo chamador) — nunca decide se o retry acontece.
async function withTransientRetry(fn, { maxAttempts = 3, baseDelayMs = 500, onRetry } = {}) {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientDbError(error)) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      if (onRetry) onRetry({ attempt, delayMs, error });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { isTransientDbError, withTransientRetry, TRANSIENT_ERROR_PATTERNS };
