// Sprint 2, Hardening H1B/H2: agrega os repositories do núcleo canônico normalizado (H1B) e de
// autenticação/sessão (H2). Usado exclusivamente por `storage/index.js` (a ponte relacional) —
// server.js nunca importa isto diretamente, exatamente como nunca importou `pg`/
// `storage/postgres-store.js` diretamente em H1A.
module.exports = {
  users: require('./users-repository'),
  legalProcesses: require('./legal-processes-repository'),
  legalDeadlines: require('./legal-deadlines-repository'),
  audit: require('./audit-repository'),
  sessions: require('./sessions-repository'),
  mfaChallenges: require('./mfa-challenges-repository'),
  passwordResetTokens: require('./password-reset-tokens-repository')
};
