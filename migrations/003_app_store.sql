-- Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, PG-01/PG-02/PG-03; docs/DECISIONS.md, PROD-H1-01).
-- Append-only: nunca altera 001/002. `schema_migrations` passa a existir a partir desta migration —
-- scripts/migrate.js registra 001/002/003 nela na primeira execução determinística contra um banco novo.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- `app_store`: documento único (id fixo = 1) contendo a store inteira em JSONB — a mesma estrutura que
-- hoje vive em data/store.json. Arquitetura de PONTE deliberada (H1A): preserva o contrato de
-- readStore()/writeStore() usado por toda a aplicação sem normalizar cada entidade em tabela própria.
-- `version` é a coluna de concorrência otimista: toda escrita é um único UPDATE condicional
-- (`WHERE id = 1 AND version = $lida`), nunca um last-write-wins silencioso (PG-02). Normalização por
-- entidade (users, legalProcesses, legalDeadlines, audit — nesta ordem, com FK real) é H1B, deliberada e
-- explicitamente FORA desta migration.
CREATE TABLE IF NOT EXISTS app_store (
  id smallint PRIMARY KEY DEFAULT 1,
  data jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_store_singleton CHECK (id = 1)
);
