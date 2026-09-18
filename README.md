# COEVO Alta Performance (Patrono Alta Performance)

Núcleo executável da plataforma corporativa multidepartamental, com Jurídico e TI como departamentos piloto.

> **Fonte de arquitetura oficial:** [`docs/MASTER_HANDOFF.md`](docs/MASTER_HANDOFF.md) (Handoff Master
> v1.3). Qualquer decisão funcional, de dados, permissões ou integrações deste repositório segue esse
> documento. Decisões técnicas e conflitos registrados estão em [`docs/DECISIONS.md`](docs/DECISIONS.md).
> Demais documentos de referência: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
> [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) · [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) ·
> [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) · [`docs/AI_GOVERNANCE.md`](docs/AI_GOVERNANCE.md) ·
> [`docs/SECURITY.md`](docs/SECURITY.md) · [`docs/QA.md`](docs/QA.md). Estado operacional **atual** do
> ambiente de demonstração (infra, sincronização, pendências): [`docs/DEMO_CURRENT_STATE.md`](docs/DEMO_CURRENT_STATE.md).

## Executar

Requer Node.js 20 ou superior:

```bash
npm start
```

Abra `http://localhost:3007`. **Isto descreve apenas a execução local sem `DATABASE_URL`** — o processo
cai automaticamente no fallback local (`data/store.json`), útil para desenvolvimento e testes. Quando
`DATABASE_URL` está configurada, o PostgreSQL passa a ser a persistência canônica (schema completo em
`migrations/`, aplicado por `scripts/migrate.js`) — essa migração para PostgreSQL **já foi implementada**
(Hardening H1A/H1B, ver `docs/PRODUCTION_GATE.md`) e está em uso real no ambiente de demonstração
(`docs/DEMO_DEPLOY.md`; estado operacional atual consolidado em `docs/DEMO_CURRENT_STATE.md`). Isso não
altera o status de produção: **produção continua NO-GO** (`docs/PRODUCTION_GATE.md`) até o hardening
completo (H1–H11) ser fechado.

## Validar

```bash
npm test
```

O núcleo contempla orçamento e central executiva por departamento, agenda, comitês, filtros jurídicos, títulos originais das colunas do Monday, RBAC server-side, login/MFA de homologação, cadastro com aprovação, auditoria, versionamento, lixeira, importação com checksum, backup cifrado condicionado a chave e geração de PPTX/PDF em `data/exports`.

Para habilitar login/MFA e backup local, copie `.env.example` para `.env` e defina os segredos fora do repositório. A conexão PostgreSQL usa `DATABASE_URL`; a migration só executa quando essa variável estiver configurada.

`npm audit` identificou duas vulnerabilidades transitivas de alta severidade no parser de imagens usado pelo `pptxgenjs`; a correção disponível exige upgrade major e deve ser validada antes da homologação.

