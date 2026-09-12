# COEVO Alta Performance (Patrono Alta Performance)

Núcleo executável da plataforma corporativa multidepartamental, com Jurídico e TI como departamentos piloto.

> **Fonte de arquitetura oficial:** [`docs/MASTER_HANDOFF.md`](docs/MASTER_HANDOFF.md) (Handoff Master
> v1.3). Qualquer decisão funcional, de dados, permissões ou integrações deste repositório segue esse
> documento. Decisões técnicas e conflitos registrados estão em [`docs/DECISIONS.md`](docs/DECISIONS.md).
> Demais documentos de referência: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
> [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) · [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) ·
> [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) · [`docs/AI_GOVERNANCE.md`](docs/AI_GOVERNANCE.md) ·
> [`docs/SECURITY.md`](docs/SECURITY.md) · [`docs/QA.md`](docs/QA.md).

## Executar

Requer Node.js 20 ou superior:

```bash
npm start
```

Abra `http://localhost:3007`. O ambiente de homologação mantém a persistência local em `data/store.json`, com dados jurídicos sincronizados do Monday e orçamento importado. A migration PostgreSQL em `migrations/001_foundation.sql` está pronta para a migração definitiva assim que a credencial oficial do banco for configurada.

## Validar

```bash
npm test
```

O núcleo contempla orçamento e central executiva por departamento, agenda, comitês, filtros jurídicos, títulos originais das colunas do Monday, RBAC server-side, login/MFA de homologação, cadastro com aprovação, auditoria, versionamento, lixeira, importação com checksum, backup cifrado condicionado a chave e geração de PPTX/PDF em `data/exports`.

Para habilitar login/MFA e backup local, copie `.env.example` para `.env` e defina os segredos fora do repositório. A conexão PostgreSQL usa `DATABASE_URL`; a migration só executa quando essa variável estiver configurada.

`npm audit` identificou duas vulnerabilidades transitivas de alta severidade no parser de imagens usado pelo `pptxgenjs`; a correção disponível exige upgrade major e deve ser validada antes da homologação.

