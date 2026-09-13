// Sprint 2, Hardening H1A: erros de storage nomeados, para que o chamador (server.js) distinga
// "conflito de concorrência" (409, o cliente pode tentar de novo) de "persistência indisponível"
// (503, problema de infraestrutura) de "arranque impossível em produção" (fail-fast, processo não sobe).
class StoreConflictError extends Error {
  constructor(message = 'Conflito de concorrência: o estado foi alterado por outra operação. Recarregue e tente novamente.') {
    super(message);
    this.name = 'StoreConflictError';
    this.code = 'STORE_CONFLICT';
  }
}

class StoreUnavailableError extends Error {
  constructor(message = 'Persistência indisponível.') {
    super(message);
    this.name = 'StoreUnavailableError';
    this.code = 'STORE_UNAVAILABLE';
  }
}

// H1A (PRODUCTION_GATE.md, seção 5/23): produção sem DATABASE_URL, ou com Postgres inalcançável/
// schema incompatível, nunca cai silenciosamente em fallback local — o processo não deve subir.
class FailFastError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FailFastError';
    this.code = 'FAIL_FAST';
  }
}

module.exports = { StoreConflictError, StoreUnavailableError, FailFastError };
