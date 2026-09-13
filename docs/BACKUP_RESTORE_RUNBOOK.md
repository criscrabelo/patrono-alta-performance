# Runbook — Backup e Restore do PostgreSQL (Hardening H5)

> Decisão relacionada: `docs/DECISIONS.md`, PROD-H5-01. Fecha `docs/PRODUCTION_GATE.md`, PG-21.
> Este runbook cobre SOMENTE o backup/restore do PostgreSQL canônico. Não cobre logging/monitoramento
> (H6), resposta a incidente (H7) ou retenção/legal hold formal (H8) — esses continuam em rodadas
> futuras. `docs/MASTER_HANDOFF.md` não foi alterado por este documento.

## 1. Objetivo

Garantir que o Patrono tenha um backup real e restaurável do PostgreSQL canônico, com destino offsite,
metas de recuperação definidas e evidência de que o restore funciona de fato — nunca apenas "o pg_dump
terminou sem erro".

## 2. RPO e RTO

- **RPO (Recovery Point Objective): 6 horas.** Justificativa: o Jurídico opera com prazos processuais
  com consequência legal direta (`legal_deadlines`) — um RPO de 24h arriscaria perder o registro de
  atualizações feitas no mesmo dia de um incidente. 6 horas é tecnicamente executável com
  `npm run backup:postgres` agendado 4x/dia via cron/scheduler externo (H5 deixa o processo
  automatizável; o próprio agendamento de produção fica para H11 — infraestrutura como código).
- **RTO (Recovery Time Objective): 4 horas.** Baseado no tempo observado no teste de restore real
  (`tests/h5-backup-restore-postgres.test.js`, evidência abaixo) — a execução completa de
  `pg_dump`→upload→`pg_restore`→validação levou menos de 1 segundo para o volume de dados atual; 4h dá
  margem generosa para: localizar o backup correto, provisionar/reapontar o banco de destino,
  coordenar a decisão de qual ambiente restaurar, e validar manualmente antes de liberar o sistema.
  Esta meta será revisada à medida que o volume de dados cresça.

## 3. Frequência e destino offsite

- Frequência recomendada: a cada 6 horas (alinhada ao RPO), via `npm run backup:postgres` disparado por
  um scheduler externo (cron, GitHub Actions agendado, scheduler do provedor de hospedagem — a escolha
  concreta é H11).
- Destino: **storage S3-compatible** (`BACKUP_STORAGE_PROVIDER=s3`) — AWS S3 ou qualquer alternativa
  compatível (MinIO, Backblaze B2, Cloudflare R2) via `BACKUP_ENDPOINT`. Em produção, o adapter
  `filesystem` é recusado explicitamente (fail-fast) — nunca é aceito como destino de produção, pois
  `/data`, `/tmp` ou qualquer disco da mesma VM/processo não são "offsite": um incidente que destrua o
  filesystem também destruiria o backup.
- **Nenhum bucket real foi criado nesta rodada** (H5 não provisiona infraestrutura — isso é H11). O
  adapter `s3` está implementado e testado com um cliente S3 injetado (`tests/h5-backup-restore.test.js`)
  mas nunca foi exercitado contra um bucket real, por falta de credencial/autorização para provisionar
  infraestrutura nesta rodada. Ver seção 10 (limitações).

## 4. Criptografia

- **Em trânsito**: TLS (dependendo do provider S3-compatible configurado).
- **Em repouso**: duas camadas possíveis, não mutuamente exclusivas:
  1. Server-side encryption do storage (se o provider oferecer e estiver configurado — fora do controle
     do código do Patrono).
  2. Criptografia **application-side opcional**, AES-256-GCM, via `BACKUP_ENCRYPTION_KEY` (mínimo 32
     caracteres). Se configurada, o artefato de `pg_dump` é cifrado ANTES do upload; o manifesto registra
     `encrypted: true` e um `encryptionKeyId` lógico (hash não-reversível da chave — nunca a chave em
     si), preparando rotação futura: uma chave nova gera um `encryptionKeyId` diferente, mas backups
     antigos continuam decifráveis desde que a chave antiga usada para gerá-los ainda esteja disponível
     ao operador. **Nunca existe uma única chave eterna sem identificação.**
- `BACKUP_ENCRYPTION_KEY` é independente de `COEVO_BACKUP_KEY` (que cifra apenas o snapshot JSON legado
  de `POST /api/backup`) — rotacionar uma nunca afeta a outra.
- Se `BACKUP_ENCRYPTION_KEY` estiver definida mas tiver menos de 32 caracteres, os scripts de
  backup/restore falham explicitamente no início da execução (nunca degradam silenciosamente para "sem
  criptografia").

## 5. Como executar um backup manual

```bash
DATABASE_URL=postgresql://usuario:senha@host:5432/banco \
APP_ENVIRONMENT=production \
BACKUP_STORAGE_PROVIDER=s3 \
BACKUP_BUCKET=meu-bucket-de-backups \
BACKUP_REGION=us-east-1 \
BACKUP_ACCESS_KEY_ID=... \
BACKUP_SECRET_ACCESS_KEY=... \
npm run backup:postgres
```

Se `BACKUP_ENCRYPTION_KEY` estiver definida no ambiente, o artefato é cifrado automaticamente — nada
adicional a passar.

## 6. Como confirmar que um backup foi bem-sucedido

O script imprime `Backup concluído: <backupId> (<bytes>, sha256=...)` e sai com código 0 apenas quando:
o `pg_dump` terminou com sucesso, o artefato tem tamanho > 0, `pg_restore --list` confirma que o arquivo
é um archive válido, o upload do artefato E do manifesto para o storage offsite foram confirmados. Uma
falha em qualquer etapa produz saída não-zero e NUNCA marca o backup como `completed`.

Evidência operacional (durável, consultável a qualquer momento): tabela `backup_runs` no próprio
PostgreSQL de origem (migration `008_h5_backup_restore_runs.sql`) — uma linha por execução, com
`status` (`started`/`completed`/`failed`), tamanho, sha256, versão do PostgreSQL, versão de migration
aplicada, commit da aplicação, e mensagem de erro sanitizada (nunca segredo) em caso de falha.

```sql
SELECT backup_id, status, started_at, completed_at, size_bytes, sha256, error_message
FROM backup_runs ORDER BY started_at DESC LIMIT 10;
```

## 7. Como executar um restore

**Nunca em cima do banco de produção sem análise prévia.** Padrão recomendado: restaurar num banco NOVO
e isolado, validar, só então decidir o próximo passo operacional (esse próximo passo — trocar o banco
ativo da aplicação — é uma decisão manual, fora do escopo deste script).

```bash
DATABASE_URL_TARGET=postgresql://usuario:senha@host:5432/banco_novo_isolado \
RESTORE_TARGET_ENVIRONMENT=production \
BACKUP_SOURCE_ENVIRONMENT=production \
BACKUP_ID=bkp_2026-01-01T00-00-00-000Z_abcd1234 \
BACKUP_STORAGE_PROVIDER=s3 \
BACKUP_BUCKET=meu-bucket-de-backups \
RESTORE_CONFIRM_PRODUCTION=YES_I_UNDERSTAND \
npm run restore:postgres
```

Guardas obrigatórias, todas fail-closed:

- **`DATABASE_URL_TARGET`** é sempre explícita — o restore nunca assume um banco "atual" implicitamente.
- **Integridade**: tamanho e SHA-256 do artefato baixado são conferidos contra o manifesto ANTES de
  qualquer ação no banco; mismatch bloqueia o restore incondicionalmente.
- **Cross-environment**: por padrão, só um backup do MESMO ambiente do alvo pode ser restaurado. Um
  backup de `staging`/`development` restaurado sobre `production` (ou qualquer combinação divergente) é
  bloqueado, a menos que `RESTORE_ALLOW_CROSS_ENVIRONMENT=I_ACCEPT_THE_RISK` seja definida explicitamente
  — um override raro, intencional e auditável (nunca o comportamento padrão).
- **Confirmação de produção**: restaurar com `RESTORE_TARGET_ENVIRONMENT=production` exige
  `RESTORE_CONFIRM_PRODUCTION=YES_I_UNDERSTAND` — uma string longa e intencional, nunca um booleano
  trivial (`true`). Ausente, o restore falha antes de tocar qualquer banco.
- **Nunca sobrescreve silenciosamente**: se o banco de destino já tiver dados (schema_migrations não
  vazia), o restore exige `RESTORE_REPLACE=YES_REPLACE_TARGET_DATA` explicitamente; sem isso, falha.
- **Formato**: `pg_restore --list` valida o archive antes de qualquer restauração real.

## 8. Política pós-restore: dados efêmeros são revogados, nunca restaurados cegamente

Após um `pg_restore` bem-sucedido, as tabelas `auth_sessions`, `auth_challenges`,
`password_reset_tokens` e `rate_limit_buckets` são **esvaziadas (`TRUNCATE`)** no banco de destino —
sempre, sem exceção, nesta versão do script. Nenhuma delas é dado de negócio: a causa raiz de um
disaster recovery pode ter sido justamente um incidente de segurança, e reautenticar todos os usuários
é mais seguro do que ressuscitar sessões/tokens/estado de rate limit potencialmente obsoletos ou
comprometidos. Esta decisão está registrada em `docs/DECISIONS.md`, PROD-H5-01, e é coberta pelo teste
`[H5-real-D]`.

## 9. Como testar um restore (sem afetar produção)

Sempre restaurar num banco recém-criado e isolado (nunca sobre um banco em uso):

```bash
createdb patrono_restore_teste
DATABASE_URL_TARGET=postgresql://usuario:senha@host:5432/patrono_restore_teste \
RESTORE_TARGET_ENVIRONMENT=staging \
BACKUP_SOURCE_ENVIRONMENT=staging \
BACKUP_ID=<backupId> \
npm run restore:postgres
# validar manualmente os dados, depois:
dropdb patrono_restore_teste
```

## 10. Restore Validation Evidence

Execução automatizada real (`pg_dump`/`pg_restore` reais, nunca mock), reproduzível via
`TEST_DATABASE_URL=... node --test tests/h5-backup-restore-postgres.test.js`. Nenhum dado real/sensível
foi usado — todo o dataset é sintético (`usr-h5-teste`, `proc-h5-teste`, `deadline-h5-teste`,
`audit-h5-teste`).

- **Commit**: ver `git log` no momento da execução (`applicationCommit` no manifesto/`backup_runs`).
- **Banco de origem**: banco Postgres isolado criado só para o teste (`patrono_h5_source_*`), com as 8
  migrations aplicadas (`001` a `008`) e o dataset sintético descrito acima.
- **Banco de destino**: banco Postgres isolado, vazio antes do restore (`patrono_h5_target_*`).
- **backupId**: gerado dinamicamente a cada execução (formato `bkp_<timestamp-ISO>_<8-hex>`).
- **Formato**: `custom` (`pg_dump -Fc`).
- **SHA-256**: calculado e conferido contra o manifesto em toda execução — mismatch bloqueia o restore
  (testado explicitamente em `[H5-real-G]`, com um manifesto deliberadamente adulterado).
- **Tamanho**: sempre > 0 — um artefato de tamanho zero nunca é aceito como backup válido.
- **Tempo de backup observado**: tipicamente < 1s para o volume de dados atual (`pg_dump` +
  `pg_restore --list` de smoke validation + upload local + cálculo de hash).
- **Tempo de restore observado**: tipicamente < 1s (`pg_restore` real + revogação de estado efêmero +
  validação de contagens + escrita da evidência em `restore_runs`).
- **Checks executados**: contagem de `app_users`/`legal_processes`/`legal_deadlines`/`audit_log` no
  destino idêntica à origem; relação `legal_deadlines.process_id`/`responsible_user_id` preservada;
  `schema_migrations` no destino aponta para a mesma migration mais recente do manifesto;
  `auth_sessions`/`auth_challenges`/`password_reset_tokens`/`rate_limit_buckets` vazias no destino
  (política de revogação) enquanto continuam intactas na origem; linha em `restore_runs` no destino com
  `result='success'`.
- **Resultado**: sucesso, 18/18 testes desta suíte passando (ver `tests/h5-backup-restore-postgres.test.js`).

## 11. Como agir em falha de backup

Uma falha nunca apaga um backup anterior válido nem marca a execução como `completed` — a linha em
`backup_runs` fica `status='failed'` com `error_message` sanitizado (nunca contém a connection string ou
qualquer segredo). H6 (logging/monitoramento estruturado, alerta automático) ainda não existe — até lá,
verificar `backup_runs` periodicamente (ou script de status externo) é o mecanismo disponível.

## 12. Como rotacionar credenciais/chaves

- **`BACKUP_ENCRYPTION_KEY`**: gerar uma chave nova, defini-la no ambiente; o próximo backup passa a
  usar o novo `encryptionKeyId`. Backups antigos continuam decifráveis desde que a chave antiga usada
  para gerá-los ainda seja preservada (ex.: em um cofre de segredos) — nunca descartar uma chave antiga
  enquanto qualquer backup cifrado com ela ainda for necessário.
- **`BACKUP_ACCESS_KEY_ID`/`BACKUP_SECRET_ACCESS_KEY`**: rotacionar no provedor de storage e atualizar a
  variável de ambiente — não requer nenhuma ação nos backups já existentes (a credencial só concede
  acesso ao bucket, nunca decifra nada).

## 13. Como verificar integridade de um backup manualmente

```bash
sha256sum caminho/para/o/artefato.dump
# comparar com o campo "sha256" do arquivo .manifest.json correspondente
pg_restore --list caminho/para/o/artefato.dump   # confirma que é um archive válido
```

## 14. Rollback do restore

Se um restore for executado no banco de destino ERRADO por engano: como o script recusa sobrescrever um
banco já populado sem `RESTORE_REPLACE=YES_REPLACE_TARGET_DATA` explícito, o cenário mais provável é
"restaurei num banco vazio que não deveria ter recebido dados" — nesse caso, o rollback é
`DROP DATABASE`/recriar o banco de destino (ele nunca era o banco de produção ativo, dado que a
confirmação de produção é sempre exigida separadamente). Se um restore COM `RESTORE_REPLACE` for
aplicado por engano sobre um banco em uso, não há rollback automático nesta rodada — a única forma de
reverter é um NOVO restore, a partir de um backup anterior ainda disponível, para o mesmo banco (por
isso a retenção mínima de múltiplos backups, seção 15, é importante).

## 15. Retenção operacional de backups

Política inicial (H8 poderá impor regras jurídicas adicionais no futuro, sobrepondo esta):

- Backups a cada 6 horas: retidos por 7 dias.
- Um backup diário (o primeiro de cada dia): retido por 30 dias.
- Um backup mensal (o primeiro de cada mês): retido por 12 meses.

**Nenhuma rotina de exclusão automática foi implementada nesta rodada** — H5 deixa a política
documentada e o `backupId`/manifesto com timestamp suficiente para um processo de limpeza futuro
identificar o que está expirado, mas a exclusão em si (especialmente irreversível contra um storage sem
versionamento) fica para quando H8 (retenção/legal hold formal) definir se algum backup precisa ser
preservado além da política operacional (legal hold). Excluir automaticamente hoje, sem essa camada,
arriscaria remover um backup que uma obrigação legal futura exigiria preservar.

## 16. Immutability (Object Lock / versionamento)

Não implementado nesta rodada — o adapter `s3` não configura nem verifica Object Lock/versionamento do
bucket (isso é provisionamento de infraestrutura, fora do escopo de H5, ver H11). Registrado como
limitação conhecida: se o provider de storage escolhido suportar retenção imutável, é recomendável
habilitá-la na configuração do bucket (fora do código do Patrono) antes de produção.

## 17. Responsabilidades

- **Execução do backup agendado**: depende de H11 (infraestrutura/deploy) para o agendamento real em
  produção — até lá, execução manual via `npm run backup:postgres` conforme necessário.
- **Decisão de restaurar em produção**: sempre uma decisão humana explícita (por isso a confirmação
  forte) — nunca automatizada.
- **Rotação de chaves/credenciais**: responsabilidade operacional de quem administra o ambiente de
  produção.

## 18. Limitações conhecidas (registradas para não fechar PG-21 por intenção)

- O adapter `s3` nunca foi exercitado contra um bucket real (nenhuma infraestrutura foi provisionada
  nesta rodada, conforme instrução explícita) — testado com um cliente S3 injetado
  (`tests/h5-backup-restore.test.js`), cobrindo a lógica de upload/download/existência, mas não a
  integração de rede/credenciais reais contra um provedor S3-compatible.
- Sem multipart upload — artefatos maiores que o limite de um `PutObject` único do provider (5GB na AWS
  S3) exigiriam essa evolução, fora do escopo desta rodada dado o volume de dados atual do Patrono.
- Sem exclusão automática de backups expirados (seção 15) — só a política está documentada.
- Sem Object Lock/immutability configurado (seção 16).
- Sem agendamento de produção real (cron/scheduler) — isso é H11.
