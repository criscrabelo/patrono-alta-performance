# 12 — Recuperação de crédito

## Implementado

- Projeto estratégico “Aumento da Recuperação de Crédito”.
- 10 frentes, 12 ações sugeridas, 7 marcos e 24 definições de indicadores.
- Estruturas para casos, internalização, negociações, tratativas jurídicas, metas, riscos e pendências gerenciais.
- Status e critérios configuráveis de internalização.
- Faixas de aging configuradas.
- Alçadas com níveis configuráveis; inicialmente sem limites financeiros.
- Políticas de honorários centralizadas em `projectRecoverySettings`.
- Dashboard do projeto com estados indisponíveis em vez de dados simulados.

## Fontes relacionadas existentes

- 1.074 notificações podem apoiar cobrança, mas não foram classificadas como casos de recuperação.
- 273 processos possuem crédito, valor pago e honorários entre suas colunas, mas não estão relacionados a `recoveryCases`.
- 894 honorários extrajudiciais e honorários judiciais derivados existem, mas não estão conciliados a valores recuperados.
- 25 transferências intermediadas representam a nomenclatura de recompra no produto.
- 38 registros do quadro Distratos e Retomadas; retomadas não estão separadas em coleção própria.

## Estado real das entidades

| Entidade | Volume | Estado |
|---|---:|---|
| `recoveryCases` | 0 | Estrutura pronta, sem casos |
| `recoveryNegotiations` | 0 | Sem negociações |
| `legalNegotiationHistory` | 0 | Sem tratativas |
| `projectTargets` | 0 | Meta não cadastrada |
| `projectRisks` | 0 | Sem riscos reais cadastrados |
| `projectManagementItems` | 0 | Sem pendências gerenciais |
| Indicadores com valor | 0 de 24 | Aguardando integração |

## Regras financeiras configuradas

- Extrajudicial: taxa 10% sobre valor recuperado; distribuição 60% Prevotica / 40% Advogados.
- Judicial: distribuição 50/50; base/taxa principal não calculada automaticamente.
- Recompra: Advogados 10% do lucro.

Esses valores estão em configuração editável, mas **não existe motor de cálculo nem lançamento automático**.

## Internalização

API permite criar/atualizar `recoveryCases` vinculados a um processo existente por `processId`. O frontend exibe a seção, mas não possui formulário completo. Nenhum processo está internalizado pelo projeto no snapshot.

## Planejado/pendente

- Definir carteira mestre e identificadores de cliente/empreendimento/unidade.
- Conciliar saldos e recebimentos com Sienge.
- Relacionar processos, notificações e honorários sem duplicar registros.
- Homologar alçadas e meta.
- Implementar motor de aprovação, alertas e cálculos.
- Produzir histórico mensal para gráficos, aging, funil e interno x externo.

