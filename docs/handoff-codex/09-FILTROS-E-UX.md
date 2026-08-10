# 09 — Filtros e UX

## Processos Judiciais

### Principais

- Busca textual.
- Status.
- Empreendimento.
- Responsável.
- Ano.
- Mais filtros / Limpar.

### Avançados

- Escopo interno/externo/a classificar.
- Tipo de processo.
- Mês.
- Polo (requerente/requerida/a classificar).

### Comportamento

- Status, empreendimento, responsável e demais facets são multi-select.
- Seleções aparecem como chips removíveis.
- Query params persistem busca, filtros, página, page size e ordenação.
- Backend filtra e pagina quando `paginated=1`.
- Responsáveis internos e externos são combinados no filtro “Responsável”.
- Valores externos são extraídos de `LOCAL` quando segue `EXTERNO <nome>`.
- Página é limitada a 25, 50 ou 100 registros.

### Problemas

- Busca varre todos os valores de todas as colunas em memória; não escala sem banco/índice.
- Facets são recalculadas sobre toda a coleção em cada requisição.
- Normalização depende de títulos/IDs específicos do Monday e regex.

## Honorários Extrajudiciais

### Principais

Busca, status, empreendimento, responsável, ano, mais filtros e limpar.

### Avançados

Tipo, mês, competência, forma de pagamento e unidade.

### Comportamento

- Multi-select pesquisável, chips, query string, paginação e backend filtering.
- Responsáveis compostos são separados por vírgula, ponto e vírgula ou barra sem alterar o registro original.
- Grupo como `ABR/24` é convertido em competência e não tratado como tipo.
- Resumo acompanha o recorte filtrado e agrega mês, trimestre e semestre.

### Problemas

- Valores monetários são convertidos por heurística de ponto/vírgula.
- Competências não reconhecidas caem em data/criação ou “Não informada”.
- Honorários judiciais ainda não reutilizam todo esse sistema de filtros.

## Competência e período dos dashboards

- Competências geradas de janeiro/2018 até o mês atual.
- Presets: carteira atual/histórico, mês atual, anterior, 3/6/12 meses, YTD e personalizado.
- Seleção personalizada aceita múltiplas competências.
- Comparação: mês anterior, ano anterior ou competência específica.
- Query params persistem o recorte do Dashboard Jurídico.

Limitação: o endpoint configurável recebe apenas `competence` e `period`; boa parte do recorte jurídico é aplicada no frontend sobre coleções carregadas.

## Responsividade e acessibilidade

- Sidebar drawer, KPIs empilhados, tabelas convertidas em cards e filtros mobile estão previstos em CSS.
- Existem labels, `aria-*`, foco no dialog e botões semânticos em vários controles.
- Não existe auditoria automatizada WCAG, teste de teclado completo ou teste com leitor de tela.

