-- Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): autenticação
-- individual, MFA individual e sessões persistentes. Substitui a senha global (COEVO_DEMO_PASSWORD),
-- o código MFA global (COEVO_MFA_CODE) e a sessão em memória (`const sessions = new Map()`).
--
-- Não altera 001-004 (append-only). ALTER TABLE em app_users é aditivo (ADD COLUMN IF NOT EXISTS) —
-- nunca remove/renomeia coluna existente, preserva todo dado já migrado por H1B.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_method text,
  ADD COLUMN IF NOT EXISTS mfa_secret_encrypted text,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS credentials_version integer NOT NULL DEFAULT 1;

-- Sessões persistentes — substitui `sessions = new Map()`. `token_hash` (nunca o token bruto) é o único
-- valor persistido; um vazamento do banco não permite reutilizar a sessão sem também ter o token bruto
-- original. `credentials_version` é uma cópia do valor de `app_users.credentials_version` no momento da
-- emissão — uma sessão cuja versão não bate mais com a do usuário está automaticamente revogada
-- (troca/reset de senha invalidam todas as sessões anteriores sem precisar varrer/apagar linha por linha).
CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  credentials_version integer NOT NULL,
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_sessions_token_hash ON auth_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id);

-- Challenges de MFA (segundo fator pendente de confirmação no login, ou enrolamento de MFA pendente de
-- confirmação) — nunca armazena o OTP em si, só a referência ao fluxo pendente. `secret_encrypted` só é
-- preenchido para `type='totp-enrollment'` (o segredo TOTP ainda não confirmado, cifrado em repouso com
-- a mesma chave/algoritmo de app_users.mfa_secret_encrypted — AES-256-GCM/MFA_ENCRYPTION_KEY); é nulo
-- para desafios de login (`type='totp'`), que só referenciam o segredo já confirmado do usuário.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  type text NOT NULL,
  secret_encrypted text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_user_id ON auth_challenges (user_id);

-- Tokens de reset de senha — uso único, hash apenas (nunca o token bruto).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_tokens_token_hash ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens (user_id);
