# COEVO Alta Performance

Núcleo executável da plataforma corporativa multidepartamental, com Jurídico e TI como departamentos piloto.

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

