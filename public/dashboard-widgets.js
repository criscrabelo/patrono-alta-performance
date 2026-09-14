(function () {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(value)) : 'Não disponível';
  const number = value => Number(value || 0).toLocaleString('pt-BR');
  const percent = value => Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : 'Não disponível';
  const action = target => target ? `onclick="openWidgetTarget('${esc(target)}')"` : '';
  const memory = widget => { const item = widget.memory || {}; return `<details class="widget-memory"><summary>Memória de cálculo</summary><dl><div><dt>Fonte</dt><dd>${esc(item.source || 'Não informada')}</dd></div><div><dt>Competência</dt><dd>${esc(item.competence || 'Não informada')}</dd></div><div><dt>Última atualização</dt><dd>${esc(item.lastUpdated ? new Date(item.lastUpdated).toLocaleString('pt-BR') : 'Não disponível')}</dd></div><div><dt>Registros</dt><dd>${number(item.recordCount)}</dd></div><div><dt>Regra</dt><dd>${esc(item.rule || 'Não informada')} · ${esc(item.ruleVersion || '')}</dd></div></dl></details>`; };
  const state = widget => {
    const labels = { loading: ['Carregando dados…', 'Aguarde enquanto este indicador é calculado.'], empty: ['Sem dados no período', 'Altere os filtros ou cadastre informações na fonte.'], error: ['Não foi possível carregar', 'Este widget falhou sem interromper os demais.'], forbidden: ['Sem permissão', 'Seu perfil não pode consultar este indicador.'], integration_pending: ['Integração pendente', 'A fonte está preparada, mas ainda não foi conectada.'] };
    const [title, text] = labels[widget.state] || labels.empty;
    return `<div class="widget-state ${esc(widget.state)}"><span aria-hidden="true">${widget.state === 'loading' ? '◌' : '◇'}</span><div><b>${title}</b><small>${text}</small></div></div>${memory(widget)}`;
  };
  const budget = rows => { const list = Array.isArray(rows) ? rows : [rows]; return `<div class="widget-budget">${list.map(row => `<button ${action(row.departmentId === 'dep-juridico' ? 'legal' : row.departmentId === 'dep-ti' ? 'ti' : '')}><span>${esc(row.departmentName || 'Departamento')}</span><b>${money(row.actual)}</b><small>Planejado: ${money(row.planned)} · Orçamento: ${money(row.budget)}</small><i><em style="width:${Math.min(100, Math.max(0, Number(row.executionPercentage || 0) * 100))}%"></em></i><strong>${percent(row.executionPercentage)}</strong></button>`).join('')}</div>`; };
  // P0 (branch demo — CTA "Abrir" sem ação real): o texto "Abrir" só aparece quando existe um `target`
  // que de fato resolve para uma navegação real (mesmo cálculo que decide o atributo `onclick`, via
  // `action()` — nunca dois critérios divergentes). Sem target, o botão fica `disabled` (nunca parece
  // clicável, nunca mostra um CTA enganoso) — regra de UX explícita, não uma correção pontual de um
  // único item: qualquer linha de qualquer widget de lista que não tenha destino real cai neste mesmo
  // caminho.
  const list = rows => `<div class="widget-list">${(rows || []).map(row => {
    const target = row.target || (row.departmentId === 'dep-juridico' ? 'legal' : row.departmentId === 'dep-ti' ? 'ti' : '');
    const cta = row.value !== undefined ? number(row.value) : Number.isFinite(row.executionPercentage) ? percent(row.executionPercentage) : (target ? 'Abrir' : '');
    return `<button ${action(target)}${target ? '' : ' disabled'}><span><b>${esc(row.label || row.title || row.departmentName || 'Registro')}</b><small>${esc(row.department || row.date || (Number.isFinite(row.actual) ? `Realizado: ${money(row.actual)}` : ''))}</small></span><strong>${cta}</strong></button>`;
  }).join('')}</div>`;
  const quality = data => { const complete = Number(data?.complete ?? data?.classified ?? 0), total = Number(data?.total || 0), ratio = total ? complete / total : 0; return `<div class="widget-quality"><div><strong>${percent(ratio)}</strong><span>${number(complete)} de ${number(total)} registros completos</span></div><i><em style="width:${ratio * 100}%"></em></i></div>`; };
  function content(definition, widget) {
    if (widget.state !== 'ready') return state(widget);
    const data = widget.data;
    if (definition.type === 'ExecutiveKpiCard' || definition.type === 'TrendKpiCard') return `<button class="widget-kpi" ${action(data?.target)}><strong>${number(data?.value)}</strong><span>${esc(data?.label || definition.title)}</span><small>Abrir detalhamento →</small></button>${memory(widget)}`;
    if (definition.type === 'BudgetComparison' || definition.type === 'ExecutiveRanking') return `${budget(data)}${memory(widget)}`;
    if (definition.type === 'DataQualityWidget') return `${quality(data)}${memory(widget)}`;
    if (definition.type === 'RiskSummary' || definition.type === 'AttentionList' || definition.type === 'UpcomingDeadlines' || definition.type === 'DecisionList' || definition.type === 'DepartmentSummary' || definition.type === 'ExecutiveTable') return `${list(data)}${memory(widget)}`;
    if (definition.type === 'ProgressWidget') return `${quality(data)}${memory(widget)}`;
    return `<div class="widget-state empty"><div><b>Visualização preparada</b><small>O componente será preenchido quando houver série histórica.</small></div></div>${memory(widget)}`;
  }
  function widget(definition, value, options = {}) {
    const width = definition.width || 'third', hidden = options.hidden;
    if (hidden) return '';
    return `<section class="dashboard-widget width-${esc(width)}"><header><div><span>Indicador executivo</span><h2>${esc(definition.title)}</h2></div>${options.personalizing ? `<button class="widget-hide" onclick="toggleDashboardWidget('${esc(definition.id)}')">Ocultar</button>` : ''}</header>${content(definition, value || { state: 'loading' })}</section>`;
  }
  function dashboard(payload, preference = {}, options = {}) {
    const defs = payload.dashboard.widgets || [], byId = Object.fromEntries(defs.map(item => [item.id, item])), order = preference.widgetOrder?.length ? preference.widgetOrder : defs.map(item => item.id), hidden = new Set(preference.hiddenWidgets || []);
    const cards = order.filter(id => byId[id]).map(id => widget(byId[id], payload.widgets[id], { hidden: hidden.has(id), personalizing: options.personalizing })).join('');
    const hiddenControls = options.personalizing && hidden.size ? `<div class="hidden-widgets"><b>Widgets ocultos:</b>${[...hidden].map(id => `<button onclick="toggleDashboardWidget('${esc(id)}')">Restaurar ${esc(byId[id]?.title || id)}</button>`).join('')}</div>` : '';
    return `<div class="configured-dashboard ${preference.density === 'compact' ? 'compact' : ''}">${hiddenControls}<div class="dashboard-widget-grid">${cards || '<div class="notice">Todos os widgets estão ocultos. Use Personalizar para restaurá-los.</div>'}</div></div>`;
  }
  window.CoevoDashboardWidgets = { dashboard, widget, memory };
}());
