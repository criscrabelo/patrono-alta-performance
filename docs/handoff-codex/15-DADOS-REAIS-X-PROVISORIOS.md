# 15 — Dados reais x provisórios

| Funcionalidade | Dado real? | Fonte | Observação |
|---|---|---|---|
| Processos Judiciais | Sim | Monday → JSON local | 273 ativos; sincronização concluída |
| Notificações | Sim | Monday → JSON local | 1.074 ativos |
| Distratos/Retomadas | Sim/parcial | Monday → JSON local | 38 no quadro conjunto; retomadas não separadas |
| Honorários Extrajudiciais | Sim, conforme preenchimento | Monday → JSON local | 894 registros; total deriva campos financeiros |
| Honorários Judiciais | Sim, derivado | Processos Monday | Somente registros com `HONORÁRIOS EFETIVADOS` |
| Compra e venda/contratos | Sim | Monday → JSON local | 1.404 registros |
| Unidades/entrega | Sim | Monday → JSON local | 112 registros |
| Transferência intermediada | Sim | Monday → JSON local | 25 registros; nomenclatura substitui recompra |
| Status/escopo/polo/tipo de processo | Derivado | Campos Monday + regex | Não é classificação homologada independente |
| Responsável de processo | Derivado | `RESPONSÁVEL` e `LOCAL` | Normalizado em leitura |
| Orçamento Jurídico | Sim no snapshot | Planilha 2026 | Persistido em JSON; sem atualização automática |
| Orçamento TI | Não | Cadastro de homologação | Provisório |
| Planejado/realizado/saldo Jurídico | Sim no snapshot | Planilha | Regra documentada |
| Forecast Jurídico | Parcial | Planilha/persistência local | Valor informado, não algoritmo |
| Agenda | Provisório | Seed/local | 2 compromissos |
| Comitês/decisões | Não | Coleção vazia | Estrutura sem dados |
| Usuários/perfis | Homologação | Seed/store | 4 usuários; auth não produtiva |
| Projeto Recuperação | Estrutura real | JSON local | Projeto existe, status Planejamento |
| Frentes/ações/marcos | Sugestões | Seed do projeto | Não representam execução concluída |
| Meta da recuperação | Não | Sem fonte | Não cadastrada |
| Casos/negociações/tratativas | Não | Coleções vazias | Estruturas prontas |
| KPIs de recuperação | Não | Sienge futuro | 24 indicadores sem valor |
| Interno x externo | Não | Histórico futuro | Gráfico em estado vazio |
| Dashboard TI operacional | Não/parcial | Agenda + budget provisório | Chamados/projetos/CMDB pendentes |
| Engenharia/Obras | Não | Sienge futuro | Widgets pendentes |
| Estratégia e Riscos corporativos | Não | Sem fonte | Definições de dashboard apenas |
| Sienge | Não | Não integrado | Sem cliente/API |
| CV/Clicksign direto | Não | Não integrado | Campos podem vir via Monday |
| IA/Têmis/Ivo/OpenAI | Não | Não integrado | Placeholders |
| PostgreSQL | Não no runtime | Migrations preparadas | APIs continuam no JSON |
| MongoDB | Não | Inexistente | Nenhum driver/schema |

