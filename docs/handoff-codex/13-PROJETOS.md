# 13 — Projetos

## Modelo `Project`

Campos reais do projeto atual:

- Identidade: `id`, `slug`, `name`, `category`, `status`, `version`.
- Escopo: `departmentId`, `department`.
- Estratégia: `objectiveId`, `objective`.
- Governança: `ownerUserId`, `coOwnerUserIds`, `managerUserId`, `sponsorUserId`.
- Acompanhamento: `progress`, `targetId`, `nextMilestoneId`.
- Fontes: `sourceLinks`.
- Auditoria básica: `createdAt`, `updatedAt`.

## Relacionamentos

```text
StrategicObjective
        |
      Project ---- owner/manager/sponsor ---> Users
        |
        +-- Workstreams -- Actions -- Indicator/Dependency
        +-- Milestones
        +-- Risks
        +-- Target -- Indicator
        +-- ApprovalRules / RecoverySettings
        +-- RecoveryCases -- Process existente
              +-- Negotiations
              +-- LegalNegotiationHistory
        +-- ManagementItems
```

## Listagem/dashboard

- `GET /api/projects` retorna resumos no escopo.
- A tela mostra departamento, categoria, eficiência financeira, status, objetivo, responsável, progresso, meta, resultado, risco e próximo marco.
- Não existe criação de novo projeto pela interface nem endpoint POST `/api/projects`.
- O dashboard genérico de projetos do catálogo continua `integration_pending`; a tela dedicada usa o serviço de projetos.

## Projeto atual

### Aumento da Recuperação de Crédito

| Campo | Estado |
|---|---|
| ID | `prj-aumento-recuperacao-credito` |
| Departamento | Jurídico |
| Categoria | Estratégico |
| Status | Planejamento |
| Responsável operacional | Miguel (`usr-miguel`) |
| Gestão | Cristiane Carneiro Rabelo (`usr-diretoria`) |
| Patrocinador | Não definido |
| Meta | Não cadastrada |
| Progresso | Indisponível; ações ainda sem progresso real |
| Próximo marco | Não definido |
| Riscos | 0 |
| Pendências gerenciais | 0 |

O projeto possui 10 frentes, 12 ações marcadas como sugestões, 7 marcos sugeridos e 24 KPIs sem valor.

## Operações

- Governança: PATCH auditado.
- Meta, alçadas e configurações: PUT com capability específica.
- Ações, marcos, riscos, internalizações, negociações, tratativas e pendências: create/update/archive/restore por API.
- Pendências: approve/reject/escalate.
- UI: leitura e navegação; formulários administrativos ainda pendentes.

## Orçamento de projeto

Não existe entidade de orçamento vinculada a `projectId`. O financeiro atual é departamental. Se necessário, criar relacionamento projeto-centro de custo sem duplicar a fonte financeira.

