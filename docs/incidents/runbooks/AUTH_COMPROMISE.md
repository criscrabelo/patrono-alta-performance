# Runbook — Incidente de Autenticação (AUTH / ACCESS_CONTROL)

Aplica-se a: suspeita/confirmação de credencial comprometida, sessão sequestrada, MFA contornado, ou
acesso indevido via conta legítima.

## Checklist

1. Revogar as sessões da conta afetada (equivalente a `POST /api/auth/logout-all`, H2).
2. Resetar a credencial (senha) da conta afetada — força reautenticação completa.
3. Revisar `credentialsVersion` do usuário — confirmar que o incremento invalidou sessões antigas (H2).
4. Revisar configuração de MFA da conta (ainda ativo? segredo precisa ser reemitido?).
5. Revisar eventos de rate limit (`RATE_LIMIT_TRIGGERED`, H3) associados à conta/IP no período.
6. Revisar tentativas de login (`audit_log`) da conta no período relevante.
7. Bloquear a conta (`deletedAt`/inativação administrativa) se o risco justificar, até nova validação.

## Preservar (H2/H3)

Este runbook nunca altera o comportamento de H2 (autenticação/sessão)/H3 (rate limiting) — apenas usa os
mecanismos já existentes (revogação de sessão, `credentialsVersion`, bloqueio por conta) como ações de
contenção do incidente.

## Nunca fazer

- Nunca logar a senha/segredo MFA comprometido.
- Nunca reverter H2/H3 para "facilitar" a investigação (ex.: desativar rate limiting).
