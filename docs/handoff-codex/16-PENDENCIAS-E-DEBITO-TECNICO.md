# 16 — Pendências e débito técnico

## Crítico

| Item | Impacto | Recomendação |
|---|---|---|
| JSON como banco, reescrito integralmente | Corrupção, corrida e perda de dados sob concorrência | Migrar para PostgreSQL e transações |
| Autenticação global de demonstração | Acesso não individualizável | Senha por usuário, Argon2/bcrypt, MFA real e revogação |
| Bypass bearer `usr-*` fora de produção | Escalada total se ambiente estiver exposto | Remover ou isolar por flag/test harness |
| Ausência de backup operacional externo/testado | Risco de perda do store | Backup automatizado, retenção e restore drill |

## Alto

| Item | Evidência |
|---|---|
| Migration 002 não executada | `scripts/migrate.js` lê apenas `001_foundation.sql` |
| PostgreSQL desacoplado | APIs usam exclusivamente `readStore`/`writeStore` |
| Duas vulnerabilidades altas | `pptxgenjs` / `image-size` no `npm audit` |
| Sem validação declarativa | Bodies são mesclados diretamente em várias rotas |
| Tipos de coleção dinâmicos | `/api/legal/:module` e `/api/entities/:type` sem allowlist robusta |
| Sem rate limit/body limit | Login, sync, import, backup e APIs podem sofrer abuso |
| Escopo incompleto | `scoped` usa `department` textual; ignora `departmentId` e empreendimento |
| Recuperação sem dados | Nenhum caso, negociação, meta ou KPI real |

## Médio

- `public/app.js` tem aproximadamente 138 KB e concentra estado, templates e regras de UI.
- `server.js` tem aproximadamente 60 KB e concentra responsabilidades demais.
- Não há TypeScript, lint, formatter ou cobertura formal.
- Testes são majoritariamente unitários/estruturais; faltam E2E e integração.
- Heurísticas de data/moeda/status podem classificar dados incorretamente.
- Monday não arquiva itens removidos na origem.
- Scheduler em processo único não é adequado a múltiplas instâncias.
- Dashboard Jurídico possui implementação rica separada do sistema genérico de widgets.
- Honorários judiciais não têm filtros equivalentes aos extrajudiciais.
- CRUD de Projetos existe na API, mas a UI é predominantemente de leitura.
- Lixeira, backup, documentos, IA, riscos e estratégia não possuem experiência completa.
- Parser CSV não implementa RFC 4180.
- IDs padrão de boards estão hardcoded no backend.

## Baixo

- Nomes internos ainda misturam conceitos de painel genérico e tela dedicada.
- `module` local no handler é calculado e pouco utilizado.
- Alguns estilos são arquivos minificados em uma linha, dificultando manutenção.
- Não há geração automática de documentação de API.

## Bugs/riscos funcionais específicos

- Dois usuários seed usam o mesmo e-mail; login escolhe o primeiro.
- Usuário privilegiado com `mfa: false` não é obrigado a cadastrar MFA.
- Cadastro aprovado não tem fluxo de senha individual.
- `/api/departments` não aplica RBAC específico.
- `/api/monday/status` e `/schedule` são públicos e expõem metadados operacionais.
- Restauração de backup substitui o store inteiro com validação estrutural mínima.

