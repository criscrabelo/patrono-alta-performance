# Incident Record Template

Preencher para cada incidente real. **Nunca preencher com dados reais neste arquivo de template** — ele
é versionado como modelo; um incidente real gerado por `scripts/create-incident.js` vai para `incidents/`
(diretório não versionado, ver `.gitignore`).

```
incidentId:                  INC-YYYYMMDD-XXXXXXXX
detectedAt:                  <UTC ISO-8601>
reportedAt:                  <UTC ISO-8601>
severity:                    SEV-1 | SEV-2 | SEV-3 | SEV-4
category:                    AUTH | ACCESS_CONTROL | DATA_EXPOSURE | DATA_INTEGRITY | DATA_LOSS |
                              AVAILABILITY | MALWARE_OR_COMPROMISE | SECRETS | BACKUP_RESTORE |
                              INTEGRATION | CONFIGURATION | LEGAL_OPERATIONAL | OTHER
status:                      DETECTED | TRIAGED | CONFIRMED | CONTAINING | CONTAINED | ERADICATING |
                              RECOVERING | MONITORING | RESOLVED | POSTMORTEM_PENDING | CLOSED
summary:                     <resumo objetivo, sem dado pessoal/segredo>

incidentCommander:           <papel/pessoa designada — preenchido operacionalmente>
technicalLead:                <papel/pessoa designada>
securityPrivacyLead:          <papel/pessoa designada>
businessLegalLead:            <papel/pessoa designada>

affectedSystems:             <lista>
affectedEnvironment:         production | staging | development
detectionSource:             <ex.: repeated_http_5xx, readiness_check_failed, revisão manual, terceiro>

requestIds:                  <lista de requestId/correlationId relevantes>
backupIds:                   <lista de backupId relevantes, se aplicável>
restoreIds:                  <lista de restoreId relevantes, se aplicável>

timeline:
  - timestamp: <UTC ISO-8601>
    actorRole: <papel>
    action: <ação tomada>
    result: <resultado>
    reference: <requestId/log/commit/runbook step>

containmentActions:          <lista>
recoveryActions:             <lista>
evidenceReferences:          <lista de referências — nunca o segredo/dado em si>
communications:
  - timestamp: <UTC ISO-8601>
    audience: internal | external
    summary: <resumo da comunicação enviada>

dataExposureSuspected:       true | false
dataExposureConfirmed:       true | false
legalAssessmentRequired:     true | false
legalHoldReviewRequired:     true | false

rootCause:                   <preenchido ao final da investigação>
resolvedAt:                  <UTC ISO-8601>
closedAt:                    <UTC ISO-8601>
```

## Campos nunca preenchidos com

- `Authorization` / Bearer token
- senha / hash de senha
- segredo ou código MFA
- `DATABASE_URL` ou qualquer connection string com credencial
- payload integral de requisição
- conteúdo jurídico integral (usar referência ao processo/ID interno, nunca o texto completo)
