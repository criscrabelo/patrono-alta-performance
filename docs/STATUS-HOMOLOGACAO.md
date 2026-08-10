# Status de homologação - fase atual

## Evidências executadas

| Controle | Resultado | Evidência |
|---|---|---|
| PostgreSQL disponível | Serviço local ativo | PostgreSQL 16 e porta 5432 disponíveis; migração definitiva aguarda a senha oficial do usuário de banco |
| Migration relacional | Preparada | `migrations/001_foundation.sql` e `scripts/migrate.js` |
| Login por senha | Aprovado em homologação local | endpoint `/api/auth/login` com senha somente por variável de ambiente |
| MFA | Presente no núcleo | endpoint `/api/auth/mfa` com desafio de uso único; provedor corporativo pode substituir o modo local |
| Sessão expirável | Aprovado | token em memória com TTL configurável |
| RBAC | Aprovado | testes automatizados e tentativa de acesso negada |
| Versionamento | Aprovado | fluxo observado 1 -> 2 -> 3 |
| Lixeira/restauração | Aprovado | `DELETE` lógico e `/restore` sem remoção física |
| Importação | Aprovado | prévia, campos obrigatórios, números, duplicidades e checksum |
| API v1 | Aprovado | `/api/v1/...` normaliza para o contrato atual |
| Backup cifrado | Implementado, aguardando chave oficial | AES-256-GCM condicionado a `COEVO_BACKUP_KEY` |
| PowerPoint/PDF | Implementado | geração 16:9 em `data/exports`, com histórico por ID |
| Monday.com | Aprovado em homologação | sete quadros conectados; 3.820 registros processados; títulos originais das colunas preservados |
| Sincronização automática | Ativa | três horários diários em `MONDAY_SYNC_TIMES`, fuso America/Sao_Paulo, upsert e auditoria |

## Configurações de homologação ainda necessárias

- A senha do usuário de banco PostgreSQL deve ser fornecida por variável de ambiente; a aplicação não a inventa nem a armazena no código.
- MFA produtivo deve ser ligado ao provedor de identidade e canal aprovados.
- Publicação externa depende de infraestrutura hospedada, segredos gerenciados e storage privado.
- Homologação formal depende dos responsáveis humanos de Jurídico, TI, Compliance e Diretoria.
