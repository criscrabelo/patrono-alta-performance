-- Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): rastreamento
-- operacional de backup/restore do PostgreSQL canônico. Segue o MESMO padrão arquitetural já usado por
-- H3 (rate_limit_buckets): estado operacional vive em uma tabela Postgres própria, nunca num arquivo
-- local paralelo — durável, sobrevive a restart, consultável por qualquer instância.
--
-- Não altera 001-007 (append-only).
--
-- `backup_runs`: uma linha por execução de scripts/backup-postgres.js — criada como 'started' ANTES do
-- pg_dump rodar, atualizada para 'completed' só depois que o upload para o storage offsite E o manifesto
-- de finalização forem confirmados, ou para 'failed' em qualquer etapa que não conclua com sucesso.
-- Nunca contém segredo (chave de criptografia, credenciais de storage, DATABASE_URL) — só metadata.
CREATE TABLE IF NOT EXISTS backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  environment text NOT NULL,
  storage_provider text,
  storage_object_key text,
  format text,
  size_bytes bigint,
  sha256 text,
  encrypted boolean NOT NULL DEFAULT false,
  encryption_key_id text,
  postgres_version text,
  migration_version text,
  application_commit text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_runs_status ON backup_runs (status);

-- `restore_runs`: gravada no banco de DESTINO logo após um restore concluído (com sucesso ou falha),
-- nunca no banco de origem — a evidência de restore deve viajar junto com o ambiente restaurado. Não é
-- log estruturado (H6) nem incident response (H7) — apenas o registro mínimo de auditoria exigido para
-- fechar PG-21 (item 33 do escopo H5): quem, quando, de qual backup, para qual ambiente, com que
-- resultado.
CREATE TABLE IF NOT EXISTS restore_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restore_id text NOT NULL UNIQUE,
  backup_id text NOT NULL,
  target_environment text NOT NULL,
  result text NOT NULL CHECK (result IN ('success', 'failed')),
  application_commit text,
  operator_identity text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_restore_runs_started_at ON restore_runs (started_at DESC);
