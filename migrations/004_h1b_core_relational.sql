-- Sprint 2, Hardening H1B (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H1B-01): normalização
-- relacional progressiva do núcleo canônico. Migra users/legalProcesses(=processos)/legalDeadlines/audit
-- para tabelas próprias — deixam de ser canônicas dentro do documento JSONB `app_store` (H1A) a partir
-- do momento em que `scripts/migrate-h1b-data.js` roda (ver runbook em docs/DECISIONS.md).
--
-- Não altera 001/002/003 (append-only). Não reaproveita as tabelas `users`/`audit_events` de
-- 001_foundation.sql: aquele schema (department_id uuid FK, mfa_enrolled, active boolean, email UNIQUE,
-- id uuid) é incompatível com o shape real do runtime (department como texto, mfa, deletedAt, email
-- não-único hoje, ids não-uuid como 'usr-diretoria') e nunca foi usado pela aplicação — permanece como
-- está, intocado, sem FK/uso cruzado com as tabelas abaixo. Por isso as tabelas novas usam nomes
-- distintos (`app_users`, `audit_log`) em vez de colidir com `users`/`audit_events` já existentes.
--
-- IDs preservados como `text` (não `uuid`): ids existentes incluem strings não-uuid como
-- 'usr-diretoria'/'usr-juridico'/'usr-ti' (seed) — usar `uuid` quebraria a preservação de ID exigida.

CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  department text,
  mfa boolean NOT NULL DEFAULT false,
  temporary_password boolean NOT NULL DEFAULT false,
  company_id text,
  spe_id text,
  deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Sem UNIQUE(email): a regra vigente no runtime nunca foi de unicidade rígida (só bloqueia nova
-- solicitação de registro, case-insensitive, e o seed atual já tem dois usuários com o mesmo email) —
-- ver docs/DECISIONS.md, PROD-H1B-01, para o registro explícito desse gap preexistente e não fechado
-- nesta rodada. Índice não-único para acelerar o lookup de login por email.
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users (lower(email));

CREATE TABLE IF NOT EXISTS legal_processes (
  id text PRIMARY KEY,
  source text NOT NULL,
  external_id text,
  module text,
  board_id text,
  board_name text,
  department text,
  title text,
  "group" text,
  columns jsonb,
  columns_by_title jsonb,
  classification text,
  company_id text,
  spe_id text,
  scope_type text,
  created_at_source timestamptz,
  synced_at timestamptz,
  deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Upsert do sync Monday casa por (source, external_id) — mesma chave já usada em runMondaySync().
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_processes_source_external ON legal_processes (source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_legal_processes_external_id ON legal_processes (external_id);
CREATE INDEX IF NOT EXISTS idx_legal_processes_company_id ON legal_processes (company_id);
CREATE INDEX IF NOT EXISTS idx_legal_processes_spe_id ON legal_processes (spe_id);

CREATE TABLE IF NOT EXISTS legal_deadlines (
  id text PRIMARY KEY,
  process_id text NOT NULL REFERENCES legal_processes(id) ON DELETE RESTRICT,
  origin text NOT NULL,
  date date NOT NULL,
  origin_type text NOT NULL CHECK (origin_type IN ('JUDICIAL_PROCESSUAL', 'INTERNAL_CONTROL')),
  status text NOT NULL CHECK (status IN ('ativo', 'suspenso', 'cumprido', 'cancelado')),
  responsible_user_id text REFERENCES app_users(id) ON DELETE RESTRICT,
  department text,
  company_id text,
  spe_id text,
  scope_type text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  deleted_at timestamptz,
  deleted_by text
);
CREATE INDEX IF NOT EXISTS idx_legal_deadlines_process_id ON legal_deadlines (process_id);
CREATE INDEX IF NOT EXISTS idx_legal_deadlines_responsible_user_id ON legal_deadlines (responsible_user_id);
CREATE INDEX IF NOT EXISTS idx_legal_deadlines_date ON legal_deadlines (date);
CREATE INDEX IF NOT EXISTS idx_legal_deadlines_status ON legal_deadlines (status);

-- Nome `audit_log` (não `audit_events`) para não colidir/confundir com a tabela incompatível já
-- existente em 001_foundation.sql (nunca usada pelo runtime, permanece intocada).
CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  responsible text,
  date timestamptz NOT NULL DEFAULT now(),
  reason text,
  before jsonb,
  after jsonb,
  correlation_id text
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_id ON audit_log (entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_date ON audit_log (date);
