# Tabletop Exercise — Credencial Administrativa Comprometida

Objetivo: verificar se o runbook de `docs/INCIDENT_RESPONSE.md` e os runbooks específicos são
executáveis na prática, sem executar um incidente real.

## Cenário

Um alerta de segurança externo (ex.: aviso de vazamento em um serviço terceiro) indica que a senha de
uma conta administrativa do Patrono pode ter sido exposta. A sessão dessa conta está ativa no momento da
detecção. Minutos depois, o time jurídico relata uma tentativa suspeita de acesso a um processo jurídico
sensível a partir dessa mesma conta.

## Eventos injetados (para o exercício)

1. Notificação inicial: "possível vazamento de credencial da conta admin-financeiro".
2. `audit_log` mostra uma sessão ativa para essa conta, criada há 2 horas.
3. `audit_log` mostra uma tentativa de acesso a `GET /api/legal/processes/:id` para um processo fora do
   escopo normal dessa conta, 10 minutos após a notificação inicial.
4. Nenhuma confirmação ainda de que dado foi de fato acessado indevidamente.

## Decisões esperadas do time

- Classificar como SEV-1 (comprometimento de autenticação + indício de acesso não autorizado a dado
  jurídico) até prova em contrário.
- Nomear Incident Commander imediatamente.
- Revogar a sessão ativa da conta (`POST /api/auth/logout-all` equivalente administrativo) — ver
  `docs/incidents/runbooks/AUTH_COMPROMISE.md`.
- Forçar reset de credencial (senha + reavaliar MFA) para a conta afetada.
- Preservar evidência: `requestId`s da tentativa de acesso suspeita, `audit_log` relevante, timestamp
  UTC de cada ação.
- Acionar Security/Privacy Lead e Business/Legal Lead (possível `DATA_EXPOSURE` envolvendo processo
  jurídico).
- Marcar `dataExposureSuspected = true` até avaliação concluir se houve exposição confirmada.
- Marcar `legalHoldReviewRequired = true` (indício de acesso indevido a processo jurídico).
- NÃO executar restore, NÃO apagar evidência, NÃO comunicar externamente sem aprovação jurídica.
- Definir comunicação interna inicial (ver `docs/incidents/COMMUNICATION_TEMPLATE.md`).

## Evidências a preservar

- `requestId`/`correlationId` da(s) requisição(ões) suspeita(s).
- Entradas relevantes de `audit_log` (login, tentativa de acesso, revogação de sessão).
- Timestamp UTC de cada ação tomada durante a resposta.
- Nunca preservar a senha/segredo em si — apenas a evidência de que a credencial foi rotacionada.

## Responsáveis (papéis, não nomes)

Incident Commander coordena; Technical Lead executa a revogação/reset técnico; Security/Privacy Lead
avalia exposição de dado pessoal/segredo; Business/Legal Lead avalia impacto no processo jurídico
afetado e decide sobre comunicação externa.

## Critérios de sucesso do exercício

- O time consegue, sem consultar ninguém fora do runbook, identificar corretamente a severidade (SEV-1).
- O time sabe qual runbook consultar (`AUTH_COMPROMISE.md` + `DATA_EXPOSURE.md`).
- O time consegue listar as ações de contenção corretas (revogar sessão, resetar credencial) sem
  inventar uma ação destrutiva desnecessária (ex.: restore).
- O time sabe que a comunicação externa exige aprovação jurídica antes de qualquer envio.
- O exercício é registrado (data, participantes por papel, lacunas identificadas no runbook) para
  alimentar melhoria contínua do processo — sem que isso implique execução de um incidente real.
