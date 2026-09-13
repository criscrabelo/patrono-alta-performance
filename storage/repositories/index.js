// Sprint 2, Hardening H1B: agrega os quatro repositories do núcleo canônico normalizado. Usado
// exclusivamente por `storage/index.js` (a ponte relacional) — server.js nunca importa isto
// diretamente, exatamente como nunca importou `pg`/`storage/postgres-store.js` diretamente em H1A.
module.exports = {
  users: require('./users-repository'),
  legalProcesses: require('./legal-processes-repository'),
  legalDeadlines: require('./legal-deadlines-repository'),
  audit: require('./audit-repository')
};
