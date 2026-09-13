// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): sanitização de
// mensagens de erro antes de logar/persistir (item 8 do escopo H5) — `pg_dump`/`pg_restore` podem incluir
// a própria connection string (com senha embutida) na mensagem de erro de conexão; nunca repassar isso
// para stdout/stderr do processo nem para a coluna `error_message` de `backup_runs`/`restore_runs`.
const SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s"']*/gi,
  /password\s*=\s*[^\s"']+/gi
];

function sanitizeErrorMessage(message) {
  let sanitized = String(message == null ? 'erro desconhecido' : message);
  for (const pattern of SECRET_PATTERNS) sanitized = sanitized.replace(pattern, '[REDACTED]');
  return sanitized;
}

module.exports = { sanitizeErrorMessage };
