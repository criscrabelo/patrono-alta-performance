# Projeto estratégico — Aumento da Recuperação de Crédito

## Governança inicial

- Responsável operacional (`ownerUserId`): Miguel (`usr-miguel`).
- Gestão (`managerUserId`): Cristiane Carneiro Rabelo (`usr-diretoria`).
- Patrocínio executivo (`sponsorUserId`): ainda não definido.
- Co-responsáveis: relação `coOwnerUserIds`, inicialmente vazia.
- Fluxo: responsável operacional → gestora → aprovação superior conforme alçada configurada.

As alterações de governança, meta, alçada, escalonamento, aprovação e rejeição usam a trilha geral de auditoria, com ator, data/hora, antes, depois e justificativa.

## Modelo local e coleções equivalentes

- `projects`, `strategicObjectives`, `projectAssignments`
- `projectWorkstreams`, `projectActions`, `projectMilestones`, `projectRisks`
- `projectIndicators`, `projectTargets`
- `projectApprovalRules`, `projectManagementItems`, `projectRecoverySettings`
- `recoveryCases`, `recoveryNegotiations`, `legalNegotiationHistory`

A migração PostgreSQL equivalente está em `migrations/002_projects_recovery.sql`. O ambiente local continua usando `data/store.json` enquanto o banco oficial não estiver configurado.

## APIs

- `GET /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id/governance`
- `PUT /api/projects/:id/target`
- `PUT /api/projects/:id/approval-rules`
- `PUT /api/projects/:id/recovery-settings`
- `POST /api/projects/:id/actions`
- `POST /api/projects/:id/milestones`
- `POST /api/projects/:id/risks`
- `POST /api/projects/:id/internalizations`
- `POST /api/projects/:id/negotiations`
- `POST /api/projects/:id/legal-treatments`
- `POST /api/projects/:id/management-items`
- `POST /api/projects/:id/management-items/:itemId/approve|reject|escalate`

## Relacionamentos e fontes

- Processo não é duplicado: `recoveryCases.processId` aponta para o processo existente.
- O projeto aponta para o objetivo estratégico por `objectiveId`.
- Responsáveis, gestores, patrocinadores e delegados apontam para usuários por ID.
- Honorários e processos do Monday estão disponíveis para relacionamento, mas não são classificados automaticamente como recuperação.
- Sienge permanece pendente; por isso valores recuperados, taxas, custos e resultado líquido aparecem como indisponíveis.

## Critérios de aceite

1. O menu Projetos abre o portfólio e o projeto estratégico.
2. O cabeçalho mostra Miguel como responsável e Cristiane como gestora por relacionamento de usuário.
3. As dez frentes, doze sugestões de ação, indicadores, marcos, alçadas e fontes são exibidos.
4. Pendências gerenciais só aparecem quando há registro real pendente.
5. Indicadores sem fonte não exibem valores fictícios.
6. Miguel pode executar e acompanhar, mas não aprovar acordo nem alterar alçada.
7. Cristiane pode gerir meta, alçada e decisões escalonadas.
8. A tela é responsiva e não exige rolagem horizontal no celular.

## Integrações pendentes

- Conciliação financeira com Sienge.
- Identificador mestre de cliente, empreendimento e unidade.
- Vínculo validado entre casos de recuperação, processos, notificações e honorários.
- Histórico mensal para gráficos de recuperação, aging, funil e interno x externo.
- Homologação das metas e dos limites de alçada pela gestão.
