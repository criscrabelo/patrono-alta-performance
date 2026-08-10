# 14 — Auditoria e segurança

## Auditoria

`audit(store, user, action, entity, entityId, before, after, reason)` grava:

- `id`, `action`, `entity`, `entityId`;
- `responsible` por nome;
- `date` ISO;
- `reason`, `before`, `after`;
- `correlationId` aleatório.

Eventos cobertos incluem CRUD, imports, sincronização, preferências, exportação, backup, restore, governança, metas, alçadas e decisões de projeto. O endpoint retorna somente os 100 mais recentes.

Limitações:

- Ator é nome, não `userId` imutável.
- Auditoria fica no mesmo arquivo mutável dos dados.
- Não há append-only, assinatura, retenção ou exportação para SIEM.
- Tentativas de login falhas e leituras não são auditadas.

## Soft delete e lixeira

- CRUD genérico e recursos de projeto usam `deletedAt` e `deletedBy`.
- Restore remove esses campos.
- A tela “Lixeira” é placeholder; restauração existe apenas por API.
- Dados Monday não são reconciliados como excluídos quando desaparecem do quadro.

## Backup e restauração

- AES-256-GCM com IV de 12 bytes.
- Chave derivada por SHA-256 de `COEVO_BACKUP_KEY`; exige pelo menos 32 caracteres.
- Retorna payload, IV, tag e checksum.
- Restaura o store inteiro após checagem estrutural mínima.
- Não existe armazenamento externo, rota de download, rota de listagem, retenção ou teste automático de restore.

## Segredos

- `.env` e `data/store.json` são ignorados pelo Git.
- `.env.example` contém apenas nomes/exemplos.
- Token Monday não é devolvido pelas APIs.
- Não há secret manager, rotação automática ou verificação de vazamento.

## Headers e transporte

- `X-Content-Type-Options: nosniff` é enviado.
- Não há CSP, HSTS, Referrer-Policy, Permissions-Policy ou proteção de framing.
- O servidor local é HTTP; TLS deve ficar em proxy/hosting futuro.

## Controles ausentes

- Rate limit, body limit e timeout por requisição.
- Validação centralizada e sanitização de schemas.
- Proteção CSRF/cookies HttpOnly; o fluxo usa bearer.
- Mascaramento/anonimização de dados jurídicos.
- Criptografia do store em repouso.
- Monitoramento, alertas, SIEM e trilha imutável.

## Dependências

`npm audit` no snapshot: 2 vulnerabilidades de severidade alta, em `pptxgenjs` por dependência transitiva `image-size`, relacionadas a loops infinitos em parsers de imagem. A correção indicada implica mudança major/downgrade e exige teste de exportação.

