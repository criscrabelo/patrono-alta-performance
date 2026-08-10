# 06 — Telas e módulos

## Padrão visual

- Sidebar escura, agrupada em Início, Departamentos, Gestão, Inteligência, Governança, Utilitários e Administração.
- Cor COEVO ciano/turquesa preservada nos estados ativos.
- Sidebar recolhível no desktop e drawer no mobile.
- Layouts responsivos em CSS; não há framework de componentes.

## Telas funcionais

### Login, MFA e cadastro

- Dados: usuários locais e segredos de ambiente.
- Ações: login, mostrar senha, mensagem de recuperação, cadastro, MFA.
- Pendências: recuperação de senha não envia e-mail; cadastro não define senha individual; MFA é global de homologação.

### Painel Executivo COEVO

- Dados: financeiro dos dois departamentos, processos e agenda.
- Widgets configuráveis e preferência persistida.
- Parcial: decisões dependem de comitês, hoje vazios.

### Dashboard Jurídico

- Dados: sete coleções Monday e financeiro Jurídico.
- Ações: filtros globais, período customizado e drill-down para pastas.
- Exibe processos ativos, exposição por valor da causa, honorários, riscos operacionais, notificações, distratos e transferências.
- Recuperação financeira permanece indisponível até Sienge/conciliação.

### Processos Judiciais

- Origem: `records.processos`/Monday.
- Filtros principais e avançados, multi-select, chips, paginação 25/50/100, ordenação e busca server-side.
- Normaliza status, escopo, polo, tipo, empreendimento e responsáveis em leitura.
- Ações: copiar número e exibir rastreabilidade. Não há editor de processo.

### Honorários Extrajudiciais

- Origem: `records.honorarios`/Monday.
- Filtros compactos e avançados, chips, paginação e totais por mês/trimestre/semestre.
- Valor: `💰 Honorário Total`, com fallback para `HONORÁRIOS`.
- Responsáveis compostos são divididos em leitura.
- Não grava alterações no Monday.

### Honorários Judiciais

- Deriva processos com `HONORÁRIOS EFETIVADOS` preenchido.
- Total e agrupamento temporal.
- Não possui filtros completos equivalentes aos extrajudiciais.

### Orçamento

- Visão consolidada e por departamento.
- Exibe orçamento, planejado, comprometido, realizado, saldo, forecast e execução.
- Importação CSV existe na API, mas a tela principal usa os valores já persistidos.

### Projetos

- Portfólio com um projeto real estruturado.
- Detalhe com governança, meta, KPIs, ações, marcos, frentes, internalização, negociações, advogados, gráficos vazios, riscos, alçadas e fontes.
- CRUD está nas APIs; a interface atual é predominantemente de leitura.

### Agenda, calculadora, integrações, logs e perfil

- Agenda: lista compromissos; API permite criar.
- Calculadora: operações básicas locais.
- Integrações: status do Monday e agenda de sincronização.
- Logs: últimos eventos de auditoria.
- Perfil: resumo do usuário e permissões.

## Telas parciais

- TI: orçamento e agenda reais; projetos, chamados, progresso e qualidade pendentes.
- Engenharia: todos os widgets aguardam fonte.
- Comitês: apresentação conceitual e APIs; não é um CRUD completo.
- Auditoria/Usuários: aprova cadastros, mas não administra toda a matriz de permissões.
- Alertas: consolida sinais, mas não tem workflow completo de resolução.

## Placeholders

- Têmis, Ivo, Documentos, Lixeira visual, Central de Inconsistências.
- Indicadores & Relatórios, Configurações e Backup visual caem no placeholder genérico.
- Estratégia e Riscos têm definições de widgets, mas payload `integration_pending`.
- Vários submódulos de TI e pastas jurídicas sem quadro dedicado caem no placeholder/tabela vazia.

