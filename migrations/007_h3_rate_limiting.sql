-- Sprint 2, Hardening H3 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H3-01): rate limiting
-- distribuído e proteção contra abuso/força bruta. Substitui qualquer limiter em memória (`new Map()`)
-- como fonte canônica — perde estado a cada restart e não funciona com múltiplas instâncias, permitindo
-- bypass trivial alternando processo/instância.
--
-- Não altera 001-006 (append-only).
--
-- `bucket_key` é sempre um valor DERIVADO (HMAC-SHA256, nunca o dado bruto): nunca senha, OTP, token de
-- reset/sessão, segredo MFA, e-mail em texto puro ou IP em texto puro — minimização LGPD (o IP é dado
-- pessoal). `scope` identifica a política/rota (ex.: 'login:ip', 'login:identity',
-- 'mfa-verify:challenge') só para diagnóstico/auditoria, nunca contém o valor identificador em si.
--
-- Janela fixa (fixed window) simples e determinística: cada linha representa UMA janela ativa por
-- bucket_key. Ao expirar (agora - window_started_at >= duração da janela), a próxima requisição reinicia
-- a janela (count=1) em vez de acumular indefinidamente — não há necessidade de um algoritmo de janela
-- deslizante mais complexo para esta finalidade.
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  scope text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_scope ON rate_limit_buckets (scope);
-- Usado pela limpeza oportunística (auth/rate-limit.js) — remove linhas cuja janela e eventual bloqueio
-- já expiraram há um bom tempo, evitando crescimento indefinido da tabela sem exigir um cron externo.
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_updated_at ON rate_limit_buckets (updated_at);
