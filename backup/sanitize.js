// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): sanitização de
// mensagens de erro antes de logar/persistir (item 8 do escopo H5) — `pg_dump`/`pg_restore` podem incluir
// a própria connection string (com senha embutida) na mensagem de erro de conexão; nunca repassar isso
// para stdout/stderr do processo nem para a coluna `error_message` de `backup_runs`/`restore_runs`.
//
// Hardening H6 (docs/DECISIONS.md, PROD-H6-01): reaproveita o sanitizador genérico de
// observability/redaction.js em vez de manter uma segunda implementação divergente de redaction — o
// comportamento e a assinatura pública de sanitizeErrorMessage() permanecem exatamente os mesmos.
const { sanitizeErrorMessage } = require('../observability/redaction');

module.exports = { sanitizeErrorMessage };
