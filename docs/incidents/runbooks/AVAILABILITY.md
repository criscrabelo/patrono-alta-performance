# Runbook — Incidente de Disponibilidade (AVAILABILITY)

Aplica-se a: indisponibilidade parcial/total, degradação de performance, HTTP 5xx repetido.

## Fontes de detecção (H6)

- `GET /api/health/live` — o processo está respondendo?
- `GET /api/health/ready` — banco alcançável e schema compatível?
- `repeated_http_5xx` (alerta, threshold real — ver `docs/OBSERVABILITY.md`)
- `app_start_failed` (FATAL, falha de boot)
- `uncaught_exception`/`unhandled_rejection` (FATAL, término controlado do processo)

## Checklist

1. Confirmar liveness (`/api/health/live` responde 200?).
2. Confirmar readiness (`/api/health/ready` — `databaseReachable`/`schemaReady`?).
3. Verificar conectividade e schema do banco (mesma checagem que `storage.healthcheck()`, H1A/H1B).
4. Verificar os logs estruturados (H6) para o `errorCode` mais recente.
5. Conter tráfego se necessário (ex.: isolar a instância afetada, se houver mais de uma).
6. Corrigir a causa raiz (config, dependência externa, recurso esgotado).
7. Recuperar (reiniciar processo/instância afetada, confirmar `ready:true`).
8. Monitorar `repeated_http_5xx` parar de disparar antes de considerar resolvido.

## Nunca fazer

- Nunca tratar um único 500 isolado como incidente de disponibilidade (o threshold de H6 já filtra
  ruído — ver `HTTP_5XX_ALERT_THRESHOLD`/`HTTP_5XX_ALERT_WINDOW_MS`).
- Nunca reiniciar/alterar readiness para "esconder" uma falha real sem corrigir a causa.
