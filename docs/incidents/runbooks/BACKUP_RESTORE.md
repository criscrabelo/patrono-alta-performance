# Runbook — Incidente de Backup/Restore (BACKUP_RESTORE)

Aplica-se a: falha de backup, falha de restore, dúvida sobre integridade de um backup/restore.
**Reaproveita H5 sem alterar seu comportamento.**

## Checklist

1. Diferenciar falha do BACKUP em si de falha de TRACKING (`BackupTrackingError`, H5) — um backup pode
   ter tido sucesso mesmo que o registro de evidência (`backup_runs`) tenha falhado; nunca tratar como
   "backup perdido" sem confirmar.
2. Diferenciar um RESTORE que falhou de um restore que **teve sucesso mas cuja evidência não foi
   registrada** (`RestoreEvidenceError`, H5, exit code 2) — este último **nunca deve ser reexecutado**
   (o restore já foi aplicado ao banco de destino).
3. **Nunca reexecutar um restore cegamente** — sempre seguir o fluxo de confirmação forte de H5
   (`RESTORE_CONFIRM_PRODUCTION`, `RESTORE_REPLACE`, `RESTORE_ALLOW_CROSS_ENVIRONMENT` quando aplicável).
4. Validar a mensagem de erro real reportada pelo mecanismo H5 (`scripts/backup-postgres.js`/
   `scripts/restore-postgres.js`) antes de qualquer ação — a mensagem já distingue os cenários acima.
5. Consultar `backup_runs`/`restore_runs` (migration 008, H5) para o estado real registrado.
6. Se um restore for de fato necessário, ele exige aprovação humana explícita, ambiente de destino
   explícito, e confirmação forte — nunca uma ação automática deste runbook.
7. Preservar `backupId`/`restoreId` como evidência no registro do incidente.

## Nunca fazer

- Nunca alterar `BackupTrackingError`/`RestoreEvidenceError` ou seus exit codes como parte da resposta a
  um incidente — são o próprio mecanismo de segurança de H5.
- Nunca apagar um artefato de backup válido por causa de uma falha de tracking.
- Nunca tratar PG-21 (H5, storage offsite real ainda não exercitado) como se fosse resolvido por este
  runbook — este runbook opera sobre o mecanismo já implementado, não expande H5.
