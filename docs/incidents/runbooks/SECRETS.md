# Runbook — Incidente de Segredo Comprometido (SECRETS)

Aplica-se a: suspeita/confirmação de exposição de qualquer segredo (chave de criptografia, token,
credencial de banco, chave de API de terceiro).

## Checklist

1. Revogar o segredo comprometido no provedor/sistema de origem.
2. Rotacionar o segredo (gerar um novo valor, nunca reaproveitar o comprometido).
3. Invalidar sessões, se o segredo comprometido afeta autenticação (ex.: `MFA_ENCRYPTION_KEY`,
   `RATE_LIMIT_HMAC_KEY`) — coordenar com `docs/incidents/runbooks/AUTH_COMPROMISE.md` se aplicável.
4. Revisar logs (H6) em busca de uso indevido do segredo — a redaction centralizada
   (`observability/redaction.js`) já garante que o próprio segredo nunca aparece no log; revisar padrões
   de uso anômalo (origem, volume, horário).
5. Identificar a janela de exposição (desde quando o segredo pode ter sido acessível).
6. Validar se houve uso indevido real durante essa janela (ex.: acessos anômalos, tentativas de
   autenticação incomuns).
7. Atualizar a configuração/dependência afetada com o novo segredo.

## Nunca fazer

- **Nunca logar o segredo comprometido** — nem para "documentar o incidente". Referenciar apenas pelo
  nome da variável/chave (`MFA_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY`, etc.) e pela janela de tempo.
- Nunca reaproveitar um segredo comprometido "temporariamente" — rotação é sempre imediata e completa.
