const WIDGET_TYPES = Object.freeze([
  'ExecutiveKpiCard', 'TrendKpiCard', 'LineTrendChart', 'BarComparisonChart',
  'BudgetComparison', 'ProgressWidget', 'RiskSummary', 'AttentionList',
  'ExecutiveRanking', 'ExecutiveTable', 'UpcomingDeadlines', 'DepartmentSummary',
  'DataQualityWidget', 'DecisionList'
]);

const widget = (id, type, title, options = {}) => ({ id, type, title, width: options.width || 'third', ...options });

const DASHBOARD_DEFINITIONS = Object.freeze({
  // P0 corrigido (rodada 4 → generalizado na rodada 5, item 2): 'central' também pertence a
  // lider/colaborador (ver ROLES em server.js), então `allowed(user, module)` sozinho deixava a Visão
  // Executiva/Centro de Comando alcançável por qualquer papel departamental. Na rodada 4 isso foi
  // corrigido com uma flag manual (`requiresGlobalScope:true`) só em `executive` — mas isso dependia de
  // lembrar de marcá-la em todo dashboard corporativo novo. Na rodada 5, a regra passou a ser
  // AUTOMÁTICA: `dashboardRequiresGlobalScope()` (abaixo) exige alçada global para QUALQUER dashboard
  // com `scope:'corporate'`, sem exceção manual — a única forma de abrir mão disso é declarar
  // `allowDepartmentScope:true` explicitamente no próprio dashboard (nenhum declara essa exceção hoje).
  executive: {
    id: 'executive', name: 'Painel Executivo COEVO', scope: 'corporate', module: 'central',
    filters: ['competence', 'period', 'departments'],
    widgets: [
      widget('department-summary', 'DepartmentSummary', 'Resumo por departamento', { width: 'full' }),
      widget('budget-comparison', 'BudgetComparison', 'Execução orçamentária', { width: 'two-thirds' }),
      widget('upcoming-deadlines', 'UpcomingDeadlines', 'Próximos compromissos'),
      widget('attention-list', 'AttentionList', 'Pontos de atenção', { width: 'half' }),
      widget('decision-list', 'DecisionList', 'Decisões executivas', { width: 'half' })
    ]
  },
  legal: {
    id: 'legal', name: 'Painel Executivo Jurídico', scope: 'department', departmentId: 'dep-juridico', module: 'juridico',
    filters: ['competence', 'period', 'enterprise', 'responsible', 'processType'],
    widgets: [
      widget('active-processes', 'ExecutiveKpiCard', 'Processos ativos'),
      widget('legal-budget', 'BudgetComparison', 'Orçamento Jurídico', { width: 'two-thirds' }),
      widget('legal-risk', 'RiskSummary', 'Riscos jurídicos'),
      widget('legal-attention', 'AttentionList', 'Atenção da Gestora', { width: 'full' }),
      widget('legal-quality', 'DataQualityWidget', 'Qualidade dos dados', { width: 'half' }),
      widget('legal-deadlines', 'UpcomingDeadlines', 'Próximos prazos', { width: 'half' })
    ]
  },
  ti: {
    id: 'ti', name: 'Painel Executivo TI', scope: 'department', departmentId: 'dep-ti', module: 'ti',
    filters: ['competence', 'period'],
    widgets: [
      widget('ti-projects', 'ExecutiveKpiCard', 'Projetos ativos'),
      widget('ti-tickets', 'ExecutiveKpiCard', 'Chamados abertos'),
      widget('ti-budget', 'BudgetComparison', 'Orçamento de Tecnologia', { width: 'two-thirds' }),
      widget('ti-progress', 'ProgressWidget', 'Evolução da área'),
      widget('ti-deadlines', 'UpcomingDeadlines', 'Próximos compromissos', { width: 'half' }),
      widget('ti-quality', 'DataQualityWidget', 'Qualidade dos dados', { width: 'half' })
    ]
  },
  engineering: {
    id: 'engineering', name: 'Painel Executivo Engenharia / Obras', scope: 'department', departmentId: 'dep-engenharia', module: 'central',
    filters: ['competence', 'period', 'enterprise'],
    widgets: [
      widget('engineering-progress', 'ProgressWidget', 'Evolução física'),
      widget('engineering-budget', 'BudgetComparison', 'Orçamento de Obras', { width: 'two-thirds' }),
      widget('engineering-risk', 'RiskSummary', 'Riscos de prazo e custo', { width: 'half' }),
      widget('engineering-quality', 'DataQualityWidget', 'Qualidade dos dados', { width: 'half' })
    ]
  },
  budget: { id: 'budget', name: 'Dashboard Orçamentário', scope: 'corporate', module: 'orcamento', filters: ['competence', 'period', 'departments'], widgets: [widget('budget-all', 'BudgetComparison', 'Planejado x realizado', { width: 'full' }), widget('budget-ranking', 'ExecutiveRanking', 'Execução por departamento', { width: 'half' }), widget('budget-quality', 'DataQualityWidget', 'Qualidade orçamentária', { width: 'half' })] },
  strategy: { id: 'strategy', name: 'Dashboard Estratégico', scope: 'corporate', module: 'estrategia', filters: ['competence', 'period', 'departments'], widgets: [widget('strategy-kpis', 'DepartmentSummary', 'Indicadores estratégicos', { width: 'full' }), widget('strategy-trend', 'LineTrendChart', 'Evolução de metas', { width: 'half' }), widget('strategy-decisions', 'DecisionList', 'Decisões', { width: 'half' })] },
  projects: { id: 'projects', name: 'Dashboard de Projetos', scope: 'corporate', module: 'projetos', filters: ['competence', 'period', 'departments'], widgets: [widget('projects-progress', 'ProgressWidget', 'Progresso dos projetos', { width: 'half' }), widget('projects-risk', 'RiskSummary', 'Riscos dos projetos', { width: 'half' }), widget('projects-table', 'ExecutiveTable', 'Carteira de projetos', { width: 'full' })] },
  risks: { id: 'risks', name: 'Dashboard de Riscos', scope: 'corporate', module: 'central', filters: ['competence', 'period', 'departments'], widgets: [widget('risk-summary', 'RiskSummary', 'Resumo de riscos', { width: 'half' }), widget('risk-attention', 'AttentionList', 'Riscos que exigem atenção', { width: 'half' }), widget('risk-table', 'ExecutiveTable', 'Matriz de riscos', { width: 'full' })] }
});

function getDashboardDefinition(id) { return DASHBOARD_DEFINITIONS[id] || null; }
// P0 corrigido (rodada 5, item 2): global-by-default para qualquer dashboard `scope:'corporate'` —
// não depende mais de marcar manualmente cada dashboard sensível. `budget`, `strategy`, `projects` e
// `risks` (todos `scope:'corporate'`) passam a exigir alçada global pela mesma regra que já protegia
// `executive`. Só uma exceção explícita e documentada (`allowDepartmentScope:true` no próprio
// dashboard) escaparia dessa exigência — nenhum dashboard atual declara essa exceção.
function dashboardRequiresGlobalScope(definition) { return !!definition && definition.scope === 'corporate' && definition.allowDepartmentScope !== true; }
// hasGlobalScope é opcional para não quebrar chamadores existentes que só verificam módulo, mas
// server.js sempre o passa — sem ele, um dashboard corporativo seria listado indevidamente.
function visibleDashboards(user, allowed, hasGlobalScope) { return Object.values(DASHBOARD_DEFINITIONS).filter(item => allowed(user, item.module) && (!dashboardRequiresGlobalScope(item) || (typeof hasGlobalScope === 'function' && hasGlobalScope(user)))); }

module.exports = { WIDGET_TYPES, DASHBOARD_DEFINITIONS, getDashboardDefinition, visibleDashboards, dashboardRequiresGlobalScope };
