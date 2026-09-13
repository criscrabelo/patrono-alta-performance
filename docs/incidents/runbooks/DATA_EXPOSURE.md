# Runbook — Incidente de Exposição de Dados (DATA_EXPOSURE / ACCESS_CONTROL)

Aplica-se a: suspeita/confirmação de acesso não autorizado a dado jurídico ou pessoal, IDOR/BOLA,
vazamento de dado.

## Checklist

1. Revogar a sessão/credencial envolvida (ver `AUTH_COMPROMISE.md` se aplicável).
2. Invalidar credenciais associadas, se necessário.
3. Revisar RBAC/escopo (`allowed()`/`scoped()` em `server.js`) do acesso envolvido — sem alterar o RBAC
   nesta rodada, apenas revisar o que ocorreu.
4. Revisar `audit_log` e `requestId`s relevantes para reconstruir o que foi acessado.
5. Verificar indício de IDOR/BOLA (acesso a um recurso fora do escopo esperado do ator).
6. Preservar evidência: `requestId`, rota acessada (normalizada), timestamp, ator.
7. Avaliar se dado pessoal está envolvido (marcar `dataExposureSuspected`/`dataExposureConfirmed`).
8. Avaliar necessidade de comunicação à ANPD/titulares conforme análise jurídica aplicável — nunca fixar
   prazo legal sem essa validação.
9. Marcar `legalHoldReviewRequired = true` se houver indício de vazamento, fraude, litígio ou
   investigação.

## Nunca fazer

- Nunca copiar o conteúdo jurídico integral acessado para o registro do incidente — referenciar pelo ID
  do recurso.
- Nunca alterar RBAC como parte da resposta a um incidente isolado sem avaliação de impacto mais ampla.
- Nunca comunicar externamente (cliente, titular, ANPD) sem aprovação jurídica/gestão.
