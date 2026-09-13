-- Sprint 2, Hardening H8 (docs/PRODUCTION_GATE.md, PG-18/PG-19; docs/DECISIONS.md, PROD-H8-01/02/03):
-- retenção de dados, legal hold e metadados operacionais de auditoria. Mesmo padrão arquitetural já
-- usado por H3/H5 (rate_limit_buckets/backup_runs): estado operacional vive em tabela Postgres própria,
-- nunca em arquivo local paralelo.
--
-- Não altera 001-008 (append-only).

-- `legal_holds`: preservação de evidência/dado sujeito a obrigação legal/investigação — NUNCA apagado
-- historicamente (mesmo após liberado, a linha permanece, só muda `status`/`released_at`). Um hold
-- ativo bloqueia o descarte automático (retention/runner.js) de qualquer registro dentro do seu escopo.
CREATE TABLE IF NOT EXISTS legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('GLOBAL', 'DATA_CLASS', 'ENTITY', 'INCIDENT', 'LEGAL_PROCESS')),
  scope_value text,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by_user_id text NOT NULL,
  released_at timestamptz,
  released_by_user_id text,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- GLOBAL nunca carrega scope_value (aplica-se a tudo); os demais escopos exigem um valor identificando
  -- o que está sob hold (ex.: 'AUTH_SESSION' para DATA_CLASS, 'user:<id>' para ENTITY, o próprio
  -- incidentId para INCIDENT, o id do processo para LEGAL_PROCESS).
  CHECK ((scope_type = 'GLOBAL' AND scope_value IS NULL) OR (scope_type <> 'GLOBAL' AND scope_value IS NOT NULL)),
  -- Liberado exige released_at/released_by_user_id/release_reason coerentes com o status.
  CHECK ((status = 'active' AND released_at IS NULL AND released_by_user_id IS NULL) OR (status = 'released' AND released_at IS NOT NULL AND released_by_user_id IS NOT NULL AND release_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_legal_holds_status ON legal_holds (status);
CREATE INDEX IF NOT EXISTS idx_legal_holds_scope ON legal_holds (scope_type, scope_value);

-- `retention_runs`: evidência de execução do runner de retenção (dry-run ou execute) — nunca contém
-- payload sensível, só um resumo agregado por classe (contagens), a versão da política aplicada e o
-- resultado. Mesmo padrão de `backup_runs`/`restore_runs` (H5): registro operacional durável, nunca um
-- arquivo local paralelo.
CREATE TABLE IF NOT EXISTS retention_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  mode text NOT NULL CHECK (mode IN ('dry_run', 'execute')),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  policy_version text NOT NULL,
  summary jsonb,
  error_code text,
  created_by text
);
CREATE INDEX IF NOT EXISTS idx_retention_runs_started_at ON retention_runs (started_at);

-- PG-18 (auditoria ampliada): metadados operacionais adicionais, ADITIVOS e NULLABLE — nunca reescreve/
-- remove uma coluna já existente, preserva todo dado já auditado. Nenhuma dessas colunas armazena
-- segredo/PII bruto: `request_id`/`session_id` são referências opacas já geradas por H2/H6 (nunca o
-- token/cookie em si); `ip_hmac` é o HMAC-SHA256 do IP (nunca o IP em texto puro); `user_agent_summary`
-- é uma versão minimizada (nunca o cabeçalho User-Agent completo/cru).
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS ip_hmac text,
  ADD COLUMN IF NOT EXISTS user_agent_summary text;
