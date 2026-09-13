# Incident Response — Resposta Operacional a Incidentes (Hardening H7)

Sprint 2, Hardening H7 (`docs/PRODUCTION_GATE.md`, PG-20; `docs/DECISIONS.md`, PROD-H7-01). Processo
operacional, acionável e testável de resposta a incidentes de segurança/disponibilidade/integridade —
provider-neutro, sem contratar PagerDuty/Opsgenie/Datadog Incident Management/Sentry Incident ou
qualquer outro serviço pago, e sem provisionar infraestrutura externa nesta rodada.

## 1. Objetivo

Garantir que, diante de um incidente real, exista um processo já pronto: quem decide (papéis), como
classificar (severidade/categoria), como se comunicar (canais), o que preservar (evidência), como conter
e recuperar (runbooks) e como fechar com aprendizado (postmortem) — sem depender de improviso no
momento da crise.

## 2. Matriz H7 — Incidentes (auditoria pré-implementação)

Levantamento dos eventos/sinais já detectáveis via H2-H6, mapeados para o processo de incidente:

| Tipo | Fonte de detecção | Severidade típica | Responsável | Contenção | Evidência | Comunicação | Recuperação |
|---|---|---|---|---|---|---|---|
| Falha de boot (`app_start_failed`) | Log estruturado H6 (FATAL) | SEV-2 (bloqueia deploy) a SEV-1 (se em produção já servindo) | Technical Lead | Não promover a versão; considerar reverter para a versão anterior conforme o processo de deploy disponível (H11) | `requestId` n/a; log FATAL com `errorCode` | Interna (canal técnico) | Corrigir config e reimplantar conforme o processo de deploy disponível |
| Exceção não tratada (`uncaught_exception`/`unhandled_rejection`) | Log estruturado H6 (FATAL) + término do processo | SEV-1/SEV-2 conforme recorrência/impacto | Technical Lead | Processo encerra com código != 0; eventual reinício depende do supervisor/orquestrador do ambiente, quando configurado (H11) | Log FATAL sanitizado | Interna | Investigar causa raiz, corrigir; considerar rollback/redeploy conforme infraestrutura disponível |
| HTTP 5xx repetido (`repeated_http_5xx`) | Alerta H6 (threshold real, `HTTP_5XX_ALERT_THRESHOLD`) | SEV-2 (ou SEV-1 se disponibilidade total) | Technical Lead | Avaliar rollback/mitigação | `route`, `statusCode`, `count`, janela | Interna | Corrigir causa, monitorar `repeated_http_5xx` parar |
| Readiness falhando (`readiness_check_failed`, `/api/health/ready`) | Health H6 | SEV-2/SEV-1 conforme duração | Technical Lead | Isolar a instância afetada; considerar reiniciar o processo quando o mecanismo de reinício estiver disponível no ambiente | Log ERROR + resultado do probe | Interna | Restaurar conectividade/schema, confirmar `ready:true` |
| Login/MFA repetidamente falho, lockout (`failed_login_count`/`locked_until`, H2) | `audit_log` de negócio | SEV-3 (isolado) a SEV-1 (indício de comprometimento confirmado) | Security/Privacy Lead | Bloquear conta/revogar sessões | `audit_log` + `credentialsVersion` | Interna, titular se aplicável | Reset de credencial, revisão de acesso |
| `RATE_LIMIT_TRIGGERED` (H3) | `audit_log` de negócio | SEV-3 (padrão) a SEV-2 (recorrente/coordenado) | Security/Privacy Lead | Bloqueio já é automático (H3); avaliar IP/identidade adicional | `audit_log` (categoria, ator) | Interna | Monitorar; sem ação adicional se dentro do esperado |
| Sincronização Monday falha (`monday_sync_failed`) | Log estruturado H6 (WARN/ERROR) | SEV-3 (integração não-core) a SEV-2 se prolongado | Technical Lead | Nenhuma ação destrutiva; integração é opcional | Log WARN/ERROR (nunca token/payload) | Interna | Corrigir integração, resync manual |
| Backup falho (`backup_failed`/`backup_tracking_failed`) | Log estruturado H6 + `backup_runs` (H5) | SEV-2 (RPO em risco) | Technical Lead | Nenhuma (H5 já é fail-closed) | `backupId`, `backup_runs` | Interna | Corrigir causa, reexecutar backup |
| Restore falho/incompleto (`restore_failed`/`restore_evidence_failed`) | Log estruturado H6 + `restore_runs` (H5) | SEV-1 (se em produção) a SEV-2 | Incident Commander + Technical Lead | Nunca reexecutar restore cegamente (ver runbook BACKUP_RESTORE) | `restoreId`, `restore_runs`, relatório H5 | Interna, gestão | Seguir H5: reconciliar evidência, só então decidir novo restore |
| Suspeita de vazamento/uso indevido de segredo | Revisão manual/alerta externo | SEV-1 | Security/Privacy Lead | Revogar/rotacionar segredo imediatamente | Nunca copiar o segredo; referenciar por nome da chave/janela de exposição | Interna, jurídico se dado pessoal envolvido | Rotação completa + validação de uso indevido |
| Suspeita de acesso não autorizado a dados jurídicos (IDOR/BOLA, RBAC) | Revisão de `audit_log`/RBAC | SEV-1 | Security/Privacy Lead + Business/Legal Lead | Revogar sessão, revisar escopo | `requestId`, `audit_log`, scope | Interna, jurídico | Corrigir controle de acesso, revisar dados afetados |

## 3. Classificação de severidade

- **SEV-1 — Crítico**: vazamento confirmado de credencial crítica; acesso não autorizado confirmado a
  dados jurídicos; corrupção/perda relevante de dados; indisponibilidade total prolongada;
  comprometimento de autenticação; restore indevido em produção.
- **SEV-2 — Alto**: falha grave parcial; `repeated_http_5xx` com impacto real; falha de backup
  recorrente; degradação importante de disponibilidade/performance; tentativa de intrusão com indício
  material (não confirmada).
- **SEV-3 — Moderado**: incidente operacional localizado; integração externa (Monday, Calendar)
  indisponível sem perda de dado; erro pontual sem perda de dado.
- **SEV-4 — Baixo**: evento informativo ou quase-incidente sem impacto real.

Os exemplos acima orientam a classificação — não são regra absoluta. A severidade final é decisão do
Incident Commander, documentada no registro do incidente com justificativa.

## 4. Categorias de incidente

`AUTH`, `ACCESS_CONTROL`, `DATA_EXPOSURE`, `DATA_INTEGRITY`, `DATA_LOSS`, `AVAILABILITY`,
`MALWARE_OR_COMPROMISE`, `SECRETS`, `BACKUP_RESTORE`, `INTEGRATION`, `CONFIGURATION`,
`LEGAL_OPERATIONAL`, `OTHER`.

## 5. Papéis (funcionais, não nomes hardcoded)

| Papel | Função |
|---|---|
| **Incident Commander (IC)** | Coordena a resposta ponta a ponta; decide severidade final, contenção e fechamento |
| **Technical Lead** | Lidera diagnóstico técnico, contenção e recuperação de sistemas |
| **Security/Privacy Lead** | Avalia exposição de dados/segredo, decide gatilhos de LGPD/legal hold |
| **Business/Legal Lead** | Avalia impacto jurídico/de negócio, decide comunicação externa |
| **Communications Owner** | Redige e distribui comunicação interna/externa conforme aprovação |
| **Scribe / Evidence Keeper** | Mantém a timeline e preserva evidência durante o incidente |

**Nenhum nome pessoal é versionado neste repositório.** O papel é definido aqui; a pessoa concreta que
ocupa cada papel deve ser preenchida no runbook operacional do ambiente (fora do controle de versão) antes
de produção — ver seção 6.

### Responsável primário (contexto da aplicação)

- **Incident Commander padrão**: Gestor(a) responsável pelo Patrono / Tecnologia.
- **Security/Privacy Lead**: Responsável por Segurança/LGPD/Jurídico.
- **Technical Lead**: Responsável técnico da aplicação/infraestrutura.

Esses três papéis têm um responsável funcional descrito acima, mas **nenhum nome individual real está
parametrizado neste repositório** (correto: nomes pessoais nunca devem ser versionados em código-fonte).
Isso significa que, para o critério de aceite de PG-20 ("responsável nomeado"), falta a etapa de
parametrização nominal operacional pré-produção — ver seção 15 (Limitações) e `docs/PRODUCTION_GATE.md`
seção 24.

## 6. Canal de comunicação

Configuráveis via variáveis de ambiente (nunca com valor real neste repositório — ver `.env.example`):

```
INCIDENT_PRIMARY_CHANNEL=
INCIDENT_SECONDARY_CHANNEL=
INCIDENT_SECURITY_CONTACT=
INCIDENT_PRIVACY_CONTACT=
```

Nenhum canal real (Slack, Teams, e-mail, telefone) está inventado ou versionado neste repositório. Até
que um valor real seja definido no ambiente operacional, esta é uma **pendência objetiva documentada** —
ver seção 15.

## 7. Lifecycle do incidente

```
DETECTED → TRIAGED → CONFIRMED → CONTAINING → CONTAINED → ERADICATING → RECOVERING
  → MONITORING → RESOLVED → POSTMORTEM_PENDING → CLOSED
```

Nesta rodada, o lifecycle é seguido via runbook + registro estruturado em arquivo local/testável (ver
`scripts/create-incident.js` e `docs/incidents/INCIDENT_TEMPLATE.md`) — **não é persistido
automaticamente em banco de dados** (sem justificativa real para isso nesta rodada; um incidente real é
raro o suficiente para não precisar de um novo modelo de armazenamento transacional).

## 8. Checklist operacional mínimo

1. Detectar
2. Registrar
3. Classificar severidade
4. Nomear Incident Commander
5. Preservar evidências
6. Conter
7. Avaliar impacto
8. Avaliar dados pessoais
9. Avaliar impacto jurídico/operacional
10. Comunicar internamente
11. Acionar terceiros se necessário
12. Erradicar causa
13. Recuperar
14. Validar integridade
15. Monitorar
16. Encerrar
17. Postmortem
18. Plano de ação

## 9. Incident Commander — checklist por tempo

**Primeiros 15 minutos:**
- Confirmar que é um incidente real (não falso positivo).
- Classificar severidade inicial (pode ser refinada depois).
- Nomear o Incident Commander.
- Congelar ações destrutivas (nenhum restore, nenhuma exclusão em massa, nenhuma rotação cega de chave
  sem avaliação).
- Preservar evidência disponível (logs, `requestId`s, `backupId`/`restoreId` relevantes).
- Iniciar a timeline.
- Acionar os responsáveis pelos demais papéis.

**Primeiros 60 minutos:**
- Conter (ver seção 12 — ações de contenção).
- Avaliar impacto (sistemas afetados, dados possivelmente expostos).
- Definir comunicação (interna obrigatória; externa só com aprovação jurídica/gestão).
- Decidir estratégia de recuperação.
- Avaliar privacidade/jurídico (LGPD — ver seção 11).

**SEV-1 especificamente:** comunicar imediatamente pelos canais definidos; congelar ações destrutivas;
preservar evidências; restringir alterações não essenciais; o Incident Commander coordena toda a
resposta — sem inventar contato real onde nenhum foi parametrizado.

## 10. Modelo de registro do incidente (Incident Record)

Campos mínimos (ver `docs/incidents/INCIDENT_TEMPLATE.md` para o template preenchível):

`incidentId`, `detectedAt`, `reportedAt`, `severity`, `category`, `status`, `summary`,
`incidentCommander`, `technicalLead`, `securityPrivacyLead`, `businessLegalLead`, `affectedSystems`,
`affectedEnvironment`, `detectionSource`, `requestIds`/`correlationIds` relevantes, `backupIds`/
`restoreIds` relevantes, `timeline`, `containmentActions`, `recoveryActions`, `evidenceReferences`,
`communications`, `dataExposureSuspected`, `dataExposureConfirmed`, `legalAssessmentRequired`,
`legalHoldReviewRequired`, `rootCause`, `resolvedAt`, `closedAt`.

**Nunca armazenado no registro**: segredos, tokens, senhas, payloads sensíveis, conteúdo jurídico
integral.

### Incident ID

Formato: `INC-YYYYMMDD-XXXXXXXX`, onde `YYYYMMDD` é a data UTC de detecção e `XXXXXXXX` é gerado via
`crypto.randomBytes` (nunca um contador incremental previsível). Ver `scripts/create-incident.js`.

## 11. Evidência

Preservar **referências**, nunca cópias desnecessárias de dado sensível: `requestId`, `correlationId`,
`backupId`, `restoreId`, nome do evento de log, `timestamp`, commit SHA, passo do runbook, ou artefato
externo já autorizado (ex.: um dump de log já coletado pela plataforma de deploy).

**Nunca copiado para o registro de incidente**: `Authorization`, tokens, senhas, segredos MFA,
`DATABASE_URL`, payload integral de requisição, documento jurídico integral.

Evidência anexada localmente pode, opcionalmente, ter seu SHA-256 registrado manualmente (não é
necessário um sistema forense nesta rodada).

## 12. Contenção

Ações possíveis (o runbook decide QUANDO considerar cada uma — nenhuma é aplicada automaticamente):
revogar sessões; desabilitar conta; bloquear integração; parar scheduler (Monday); colocar sistema em
modo de manutenção (**não criado nesta rodada** — fora de escopo, salvo mecanismo já existente); revogar
segredo; isolar ambiente.

## 13. LGPD e legal hold (gatilho, não implementação)

O runbook de qualquer incidente inclui a etapa: **"Avaliar se o incidente envolve dados pessoais"** e
**"Avaliar necessidade de comunicação à ANPD/titulares conforme análise jurídica aplicável"** — sem
fixar um prazo legal específico nesta rodada (isso depende de avaliação jurídica no momento real do
incidente; nenhum prazo regulatório é afirmado aqui).

Se houver indício de fraude, vazamento, litígio, investigação ou obrigação regulatória, o registro do
incidente marca `legalHoldReviewRequired = true` — **apenas um gatilho de revisão jurídica**, nunca uma
política de retenção/legal hold em si (isso é H8, explicitamente fora de escopo desta rodada).

## 14. Escalation matrix

| Severidade | Incident Commander | Technical Lead | Jurídico/Privacidade | Diretoria | Comunicação |
|---|---|---|---|---|---|
| SEV-1 | Aciona imediatamente | Aciona imediatamente | Aciona imediatamente | Notificada imediatamente | Interna obrigatória; externa só com aprovação |
| SEV-2 | Aciona | Aciona | Avalia necessidade | Informada | Interna |
| SEV-3 | Ciente | Trata | Avalia se aplicável | Não necessariamente | Interna, se relevante |
| SEV-4 | Registra | Registra | Não necessariamente | Não | Não necessária |

Nomes pessoais não estão listados (não autorizados a versionar) — a matriz define QUEM (papel) por
severidade; o preenchimento nominal é operacional, fora do repositório.

## 15. Limitações explicitamente documentadas (por que PG-20 permanece aberto)

- **Nenhum canal de comunicação real está parametrizado** — `INCIDENT_PRIMARY_CHANNEL`,
  `INCIDENT_SECONDARY_CHANNEL`, `INCIDENT_SECURITY_CONTACT`, `INCIDENT_PRIVACY_CONTACT` permanecem
  vazios em `.env.example`, como deve ser (nenhum valor inventado). A parametrização real é uma decisão
  operacional pré-produção, fora do escopo técnico desta rodada.
- **Nenhum nome individual real está atribuído** aos papéis de Incident Commander/Technical Lead/
  Security-Privacy Lead/Business-Legal Lead — apenas os papéis funcionais estão documentados. Nomes
  pessoais nunca devem ser versionados em código-fonte; a atribuição nominal é responsabilidade da
  gestão do ambiente de produção.
- O processo (checklist, severidade, papéis, lifecycle, templates, runbooks, tabletop) está completo,
  documentado e testável — mas o critério de aceite de PG-20 ("responsável nomeado" e "canal de
  comunicação definido") exige um elemento operacional real que ainda não foi parametrizado. Fechar
  PG-20 sem essa parametrização seria fechar por intenção, não por comprovação — mesma disciplina já
  aplicada a PG-21/H5 e PG-17/H6.
- **Nenhum supervisor/orquestrador de processo (systemd, Docker, Kubernetes, Fly.io, etc.) está
  implementado ou configurado nesta rodada** — isso é H11 (deploy/infraestrutura), explicitamente fora
  de escopo aqui. As ações de "recuperar"/"reiniciar" descritas nos runbooks descrevem o QUE fazer, não
  afirmam QUE existe hoje um mecanismo automático que faça isso — a execução real depende do que estiver
  disponível no ambiente operacional em cada momento.
- **O registro local de incidente (`scripts/create-incident.js`) é uma ferramenta operacional, não um
  armazenamento forense/durável de produção** — o arquivo gerado fica em `incidents/` (diretório local,
  nunca versionado). Persistência/retenção durável desse registro é responsabilidade do processo
  operacional do ambiente (H8/H11), nunca implementada por este script.

## 16. Referências

- `docs/incidents/INCIDENT_TEMPLATE.md` — template de registro de incidente.
- `docs/incidents/POSTMORTEM_TEMPLATE.md` — template de postmortem.
- `docs/incidents/COMMUNICATION_TEMPLATE.md` — template de comunicação interna/externa.
- `docs/incidents/TABLETOP_EXERCISE.md` — exercício de mesa para validar que o runbook é executável.
- `docs/incidents/runbooks/AUTH_COMPROMISE.md`
- `docs/incidents/runbooks/DATA_EXPOSURE.md`
- `docs/incidents/runbooks/AVAILABILITY.md`
- `docs/incidents/runbooks/BACKUP_RESTORE.md`
- `docs/incidents/runbooks/SECRETS.md`
- `scripts/create-incident.js` — gera um arquivo local de incidente a partir do template (nunca
  persiste em produção automaticamente, nunca cria um banco paralelo).
