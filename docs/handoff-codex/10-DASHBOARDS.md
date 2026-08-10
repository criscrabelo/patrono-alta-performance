# 10 — Dashboards

## Arquitetura de widgets

`dashboard-model.js` define 14 tipos: KPI executivo/tendência, linha, barras, orçamento, progresso, riscos, atenção, ranking, tabela, prazos, resumo departamental, qualidade e decisões.

Cada payload usa um estado:

- `ready`: dado disponível.
- `empty`: fonte existe, mas não há registros.
- `integration_pending`: fonte ainda não integrada.

`memory` registra fonte, competência, atualização, quantidade, regra e versão `COEVO-DASH-1.0`.

## Painel Executivo COEVO

| KPI/widget | Regra | Fonte | Real? |
|---|---|---|---|
| Resumo por departamento | Financeiro + processos ativos jurídicos + agenda | Store/Monday | Misto |
| Execução orçamentária | realizado / orçamento | `financials` | Jurídico sim; TI provisório |
| Compromissos | primeiros 8 eventos | `agenda` | Seed/local |
| Pontos de atenção | ativos e a classificar | processos | Sim, regra derivada |
| Decisões | últimos 6 comitês | `committees` | Sem dados |

## Dashboard Jurídico

| Indicador | Cálculo | Fonte | Observação |
|---|---|---|---|
| Processos ativos | exclui status finalizado/encerrado/baixado/extinto/arquivado | Processos Monday | Real derivado |
| Exposição | soma `VALOR DA CAUSA` dos ativos na tela executiva | Processos Monday | Real de cadastro, não contingência |
| Honorários | soma campos do quadro extrajudicial | Honorários Monday | Real conforme preenchimento |
| Riscos/prazos | datas vencidas/até janela e itens sem classificação | Monday | Sinal operacional, não matriz formal |
| Qualidade | ativos com status reconhecido / total ativo | Monday | Real derivado |
| Orçamento Jurídico | valores departamentais | Planilha | Real do snapshot |
| Recuperação | sem cálculo financeiro | Sienge futuro | Indisponível |

Nota: existem duas implementações visuais relacionadas ao Jurídico: widgets configuráveis em `dashboard-service.js` e o painel jurídico rico montado em `public/app.js`. O roteamento atual usa o painel rico para `state.screen === juridico`.

## Dashboard TI

- Orçamento: disponível, mas fonte é cadastro de homologação.
- Agenda: dois eventos locais, filtrados por departamento.
- Projetos, chamados, progresso e qualidade: `integration_pending`.

## Engenharia, Estratégia e Riscos

- Engenharia: quatro widgets pendentes de Sienge/gestão de obras.
- Estratégia: definição existe; todos os widgets retornam pendente.
- Riscos: definição existe; todos os widgets retornam pendente.

## Dashboard de Projetos

O catálogo genérico possui widgets pendentes, mas a tela `projetos` usa uma implementação dedicada, alimentada por `/api/projects`, com um projeto real estruturado.

## Personalização

- Usuário pode ocultar widgets, alterar ordem e densidade.
- Persistência em `dashboardPreferences`.
- A UI atual implementa ocultar/mostrar; drag-and-drop de ordem não está evidente.

