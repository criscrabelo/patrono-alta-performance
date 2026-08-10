# 11 — Orçamento e financeiro

## Separação por departamento

| Departamento | Fonte atual | Natureza |
|---|---|---|
| Jurídico | `Orcamento_JURIDICO_2026.xlsx · Painel/Planejado/Realizado` | Dado importado/real no snapshot |
| TI | `Cadastro de homologação do núcleo COEVO` | Provisório |

## Valores no snapshot

| Departamento | Orçamento | Planejado | Comprometido | Realizado | Saldo | Forecast | Execução |
|---|---:|---:|---:|---:|---:|---:|---:|
| Jurídico | R$ 324.730,42 | R$ 209.173,48 | R$ 0,00 | R$ 145.499,77 | R$ 179.230,65 | R$ 324.730,42 | 44,81% |
| TI | R$ 720.000,00 | R$ 680.000,00 | R$ 146.000,00 | R$ 384.000,00 | R$ 190.000,00 | R$ 698.000,00 | 53,33% |

Não tratar o valor de TI como dado financeiro homologado.

## Regras implementadas

- `budget`: `financials.budget`, fallback para `department.budget.budgeted`.
- `planned`: planejado informado.
- `committed`: comprometido informado.
- `actual`: realizado informado.
- `balance = budget - committed - actual` quando todos são finitos.
- `executionPercentage = actual / budget` quando budget > 0.
- `forecast`: valor informado; não é recalculado por algoritmo.
- Consolidado: soma budget e actual dos departamentos; execução consolidada = soma actual / soma budget.

## Importação CSV

- Headers obrigatórios: `department`, `competence`, `budgeted`, `planned`, `committed`, `realized`.
- Valida competência `YYYY-MM` e números.
- Detecta duplicidade por departamento + competência dentro do arquivo.
- Commit rejeita lote com inválidos/duplicados.
- Checksum SHA-256 deduplica lote.
- Parser usa `split(',')`; não suporta CSV com campos entre aspas/vírgulas internas.

## Persistência

- Valores atuais estão em `departments[].budget` e `financials`.
- `budgetImports` guarda lotes quando a API é usada.
- Migration PostgreSQL define tabela `budgets`, mas não é usada pelo runtime.

## Sienge

Integração futura. Não existe conciliação com contas a pagar, centros de custo, realizado contábil ou forecast automático.

