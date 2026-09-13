-- Sprint 2, Hardening H2 (revisão pós-PR #13; docs/DECISIONS.md, PROD-H2-01): identidade de login única.
-- `app_users.email` nunca teve constraint de unicidade (gap conhecido, documentado em PROD-H1B-01, item
-- 7) e o próprio seed de homologação tem dois usuários (`usr-diretoria`/`usr-juridico`) compartilhando o
-- mesmo e-mail. Login por `find(first-match)` sobre e-mail duplicado não é compatível com autenticação
-- individual: não há garantia de qual das duas contas efetivamente autentica.
--
-- Não altera 001-005 (append-only, inclusive a própria 005 já entregue nesta mesma rodada H2 — a
-- correção é uma nova migration, nunca uma edição silenciosa de uma migration já aplicada em qualquer
-- ambiente/CI). `email` continua sendo dado de contato, nunca alterado aqui; `login_identifier` é a
-- identidade TÉCNICA de autenticação, separada e estável.
--
-- Backfill: usuários existentes recebem `login_identifier = id` — o identificador técnico já existente,
-- único e estável, sem inventar nenhum dado de negócio (nome de usuário comercial, e-mail fictício).
-- Novos usuários (seed e aprovação de cadastro) também recebem `login_identifier = id` por padrão nesta
-- rodada; uma interface de login amigável (escolha de nome de usuário pelo próprio usuário) fica para
-- rodada futura, fora do escopo desta correção.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS login_identifier text;
UPDATE app_users SET login_identifier = id WHERE login_identifier IS NULL;
ALTER TABLE app_users ALTER COLUMN login_identifier SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_login_identifier ON app_users (login_identifier);
