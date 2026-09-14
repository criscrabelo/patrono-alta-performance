const { getDashboardDefinition } = require('./dashboard-model');
const { enabledMondaySources } = require('./legal-source-catalog');

// Integração completa do workspace Jurídico (docs/DEMO_DEPLOY.md): moduleLabels deixou de ser uma lista
// curta hardcoded (7 boards) — deriva do mesmo catálogo único usado por server.js/public/app.js, para o
// widget "legal-attention" nunca ficar desatualizado quando um novo board for adicionado ao catálogo.
const moduleLabels = Object.fromEntries(enabledMondaySources().map(entry => [entry.key, entry.label]));
const recordList = (store, key) => (store.records?.[key] || []).filter(row => !row.deletedAt);
const memory = (source, competence, recordCount, rule, lastUpdated) => ({ source, competence, lastUpdated: lastUpdated || null, recordCount, rule, ruleVersion: 'COEVO-DASH-1.0' });
const ready = (id, data, meta) => ({ id, state: 'ready', data, memory: meta });
const pending = (id, source, competence, rule = 'Indicador será calculado após a integração da fonte.') => ({ id, state: 'integration_pending', data: null, memory: memory(source, competence, 0, rule, null) });
const empty = (id, source, competence, rule) => ({ id, state: 'empty', data: null, memory: memory(source, competence, 0, rule, null) });

function financeRows(store) {
  const saved = Array.isArray(store.financials) ? store.financials : [];
  return (store.departments || []).map(department => {
    const b = department.budget || {}, existing = saved.find(row => row.departmentId === department.id) || {};
    const budget = Number(existing.budget ?? b.budgeted), actual = Number(existing.actual ?? b.realized), planned = Number(existing.planned ?? b.planned), committed = Number(existing.committed ?? b.committed);
    return { departmentId: department.id, departmentName: department.name, budget: Number.isFinite(budget) ? budget : null, planned: Number.isFinite(planned) ? planned : null, committed: Number.isFinite(committed) ? committed : null, actual: Number.isFinite(actual) ? actual : null, executionPercentage: Number.isFinite(budget) && budget > 0 && Number.isFinite(actual) ? actual / budget : null, source: existing.source || department.source || 'Origem não informada' };
  });
}

function latestSync(store) { return (store.mondayRuns || []).filter(run => run.finishedAt).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))[0]?.finishedAt || null; }
// P0 (branch demo — "Abrir" sem ação real): resolve um destino de navegação para um compromisso de
// agenda que REPRESENTE um Comitê (reaproveita a tela de Comitês já existente, público.app.js `comites`
// + `state.committeeDepartment`) — nunca hardcoda o título específico de um evento (ex.: "Comitê
// Executivo mensal"), só o padrão semântico "é um comitê deste departamento". Eventos sem esse padrão
// ficam sem `target`; dashboard-widgets.js (list()) já trata a ausência de target corretamente, sem
// mostrar um "Abrir" enganoso.
function agendaEventTarget(event) {
  if (event?.department && /comit[êe]/i.test(String(event.title || ''))) return `comite:${event.department}`;
  return undefined;
}
function processStatus(row) { const value = String(row.columnsByTitle?.["'MEU TRABALHO'"] || row.columnsByTitle?.['STATUS (para comitê)'] || row.columnsByTitle?.STATUS || ''); return /finaliz|encerr|baix|extint|arquiv/i.test(value) ? 'Finalizado' : /acordo/i.test(value) ? 'Acordo' : /acompanha/i.test(value) ? 'Em acompanhamento' : /andamento|suspenso/i.test(value) ? 'Em andamento' : 'A classificar'; }
function activeProcesses(store) { return recordList(store, 'processos').filter(row => processStatus(row) !== 'Finalizado'); }
// P1 corrigido (revisão do PR #5): contagens do dashboard 'legal' (processos ativos, "A classificar",
// qualidade de dados, volumes por pasta) não passavam por scoped() — um usuário autorizado ao
// dashboard departamental podia ver contagens agregadas incluindo registros fora do próprio escopo
// (empresa/SPE), mesmo que os REGISTROS individuais já fossem corretamente negados alhures. Defesa em
// profundidade também para agregados, não só para o Legal Deadline em si — alçada global (diretoria)
// continua vendo o consolidado, pois scoped() retorna true para ela em qualquer registro.
function scopedRecordList(store, key, user, deps) { return recordList(store, key).filter(row => deps.scoped(user, row)); }
// Sprint 2, Fase 2: única fonte canônica de prazo jurídico é `legalDeadlines` — nenhuma view/widget
// jurídico pode mais derivar "prazo"/"vencimento"/"atraso" de DATA/CITAÇÃO/PROTOCOLO ou de qualquer
// outra coluna bruta do Monday (D1, docs/DECISIONS.md). `deps.scoped`/`deps.isLegalDeadlineOverdue`/
// `deps.civilDateAfterDays` são injetados por server.js (mesmas funções usadas em /api/entities/:type)
// para não duplicar aqui nem a autorização, nem a regra de atraso, nem a janela de dias.
function legalDeadlineRows(store, user, deps) {
  const processos = recordList(store, 'processos');
  return recordList(store, 'legalDeadlines')
    .filter(row => deps.scoped(user, row))
    .map(row => {
      const process = processos.find(p => p.id === row.processId);
      // Defesa em profundidade (item 5 do plano): nunca expor um prazo cujo processo relacionado não
      // esteja (mais) acessível ao usuário — não confiar apenas no escopo herdado/gravado no prazo.
      return process && deps.scoped(user, process) ? { ...row, process } : null;
    })
    .filter(Boolean);
}

function dashboardPayload(store, id, query = {}, user = null, deps = {}) {
  const definition = getDashboardDefinition(id); if (!definition) return null;
  const competence = query.competence || new Date().toISOString().slice(0, 7), updated = latestSync(store), finance = financeRows(store);
  const byDepartment = departmentId => finance.find(row => row.departmentId === departmentId);
  const widgets = {};
  const putBudget = (widgetId, row) => { widgets[widgetId] = row ? ready(widgetId, row, memory(row.source, competence, 1, 'Orçamento, planejado, comprometido e realizado consolidados por departamento.', updated)) : empty(widgetId, 'Cadastro financeiro', competence, 'Não há orçamento cadastrado para este departamento.'); };

  if (id === 'executive') {
    // P0 (branch demo — compromisso já vencido aparecendo como "próximo"): `upcoming` passa a ser a
    // agenda filtrada por data civil e ordenada crescente (deps.upcomingAgendaItems(), server.js —
    // mesma convenção de fuso America/Sao_Paulo já usada em Legal Deadline; nunca uma segunda regra de
    // data). `target` (agendaEventTarget(), acima) só existe quando o compromisso é reconhecidamente um
    // Comitê — os demais ficam sem CTA "Abrir" (dashboard-widgets.js já trata isso corretamente).
    const processes = activeProcesses(store);
    const upcoming = (deps.upcomingAgendaItems ? deps.upcomingAgendaItems(store.agenda) : store.agenda || []).map(event => ({ ...event, target: agendaEventTarget(event) }));
    widgets['department-summary'] = ready('department-summary', finance.map(row => ({ ...row, activeProcesses: row.departmentId === 'dep-juridico' ? processes.length : null, commitments: upcoming.filter(event => event.department === row.departmentName || (row.departmentName === 'TI' && event.department === 'Tecnologia')).length })), memory('Financeiro departamental + Monday + Agenda', competence, finance.length, 'Um resumo por departamento permitido ao perfil.', updated));
    widgets['budget-comparison'] = ready('budget-comparison', finance, memory('Financeiro departamental', competence, finance.length, 'Comparação entre planejado, orçamento e realizado por departamento.', updated));
    widgets['upcoming-deadlines'] = upcoming.length ? ready('upcoming-deadlines', upcoming.slice(0, 8), memory('Agenda', competence, upcoming.length, 'Compromissos futuros ordenados por data.', updated)) : empty('upcoming-deadlines', 'Agenda', competence, 'Nenhum compromisso futuro cadastrado.');
    widgets['attention-list'] = ready('attention-list', [{ label: 'Processos ativos', value: processes.length, target: 'legal' }, { label: 'Registros sem classificação', value: processes.filter(row => processStatus(row) === 'A classificar').length, target: 'legal' }], memory('Monday', competence, processes.length, 'Contagem da carteira ativa e de cadastros a classificar.', updated));
    widgets['decision-list'] = (store.committees || []).length ? ready('decision-list', store.committees.slice(-6).reverse(), memory('Comitês', competence, store.committees.length, 'Últimas decisões registradas em comitê.', updated)) : empty('decision-list', 'Comitês', competence, 'Nenhuma decisão registrada.');
  } else if (id === 'legal') {
    // P1 corrigido (revisão do PR #5): `all`/`active` (e, abaixo, `legal-attention`) passam a usar
    // scopedRecordList() — não mais recordList()/activeProcesses() sem scoped() — para que as
    // CONTAGENS agregadas do dashboard jurídico também respeitem empresa/SPE, não só os registros
    // individuais (Legal Deadline já tinha essa defesa em profundidade; os demais widgets não tinham).
    const all = scopedRecordList(store, 'processos', user, deps);
    const active = all.filter(row => processStatus(row) !== 'Finalizado');
    const scopedDeadlines = legalDeadlineRows(store, user, deps);
    // Distinção JUDICIAL_PROCESSUAL x INTERNAL_CONTROL (item 7 do plano da Fase 2): só prazo de fato
    // jurídico-processual entra nos indicadores rotulados como "prazo processual"/"risco jurídico".
    // INTERNAL_CONTROL nunca é somado aqui — permanece disponível apenas na listagem/filtro dedicados
    // (GET /api/entities/legalDeadlines), sem ser rotulado como prazo processual neste dashboard.
    const judicialDeadlines = scopedDeadlines.filter(row => row.originType === 'JUDICIAL_PROCESSUAL');
    const overdue = judicialDeadlines.filter(row => deps.isLegalDeadlineOverdue(row));
    const soonLimit = deps.civilDateAfterDays(30);
    const upcoming = judicialDeadlines.filter(row => row.status === 'ativo' && !deps.isLegalDeadlineOverdue(row) && row.date <= soonLimit);
    const upcomingAndOverdue = [...overdue, ...upcoming].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    widgets['active-processes'] = ready('active-processes', { value: active.length, label: 'Processos ativos', target: 'processos' }, memory('Monday · Processos judiciais', competence, all.length, 'Todos os processos sem status finalizado.', updated));
    putBudget('legal-budget', byDepartment('dep-juridico'));
    // Fonte canônica exclusiva: legalDeadlines (nunca DATA/CITAÇÃO/PROTOCOLO/processDate() do Monday —
    // D1, docs/DECISIONS.md). "Vencido" usa isLegalDeadlineOverdue(); "crítico" é o prazo ativo dentro
    // da janela de 30 dias que ainda não venceu — a mesma regra de atraso não é recalculada aqui.
    widgets['legal-risk'] = ready('legal-risk', [
      { label: 'Prazos vencidos', value: overdue.length },
      { label: 'Prazos críticos (30 dias)', value: upcoming.length },
      { label: 'A classificar', value: active.filter(row => processStatus(row) === 'A classificar').length }
    ], memory('legalDeadlines', competence, judicialDeadlines.length, 'Riscos jurídicos calculados exclusivamente a partir de Legal Deadline (status ativo + date), nunca de data bruta do processo.', updated));
    widgets['legal-attention'] = ready('legal-attention', Object.entries(moduleLabels).map(([key, label]) => ({ label, value: scopedRecordList(store, key, user, deps).length, target: key })), memory('Monday', competence, Object.keys(moduleLabels).reduce((sum, key) => sum + scopedRecordList(store, key, user, deps).length, 0), 'Volumes por pasta jurídica sincronizada, restritos ao escopo do usuário.', updated));
    widgets['legal-quality'] = ready('legal-quality', { classified: active.filter(row => processStatus(row) !== 'A classificar').length, total: active.length }, memory('Monday', competence, active.length, 'Percentual de processos ativos com status reconhecido.', updated));
    // Item 28 (docs/LEGAL_COMMITTEE_READINESS.md): responsibleUserId/processTitle são aditivos ao
    // payload já existente (row já os carrega via legalDeadlineRows() acima) — usados apenas pela seção
    // "Visão para Comitê" do Dashboard Jurídico, nunca alteram a regra de atraso/janela já calculada.
    widgets['legal-deadlines'] = upcomingAndOverdue.length
      ? ready('legal-deadlines', upcomingAndOverdue.slice(0, 8).map(row => ({ title: row.origin, date: row.date, department: 'Jurídico', status: row.status, overdue: deps.isLegalDeadlineOverdue(row), responsibleUserId: row.responsibleUserId ?? null, processTitle: row.process?.title ?? null })), memory('legalDeadlines', competence, upcomingAndOverdue.length, 'Próximos prazos e prazos vencidos (Legal Deadline, JUDICIAL_PROCESSUAL, status ativo).', updated))
      : empty('legal-deadlines', 'legalDeadlines', competence, 'Nenhum Legal Deadline ativo crítico ou vencido identificado.');
  } else if (id === 'ti') {
    widgets['ti-projects'] = pending('ti-projects', 'Sistema de projetos de TI', competence);
    widgets['ti-tickets'] = pending('ti-tickets', 'Sistema de chamados', competence);
    putBudget('ti-budget', byDepartment('dep-ti'));
    widgets['ti-progress'] = pending('ti-progress', 'Roadmap de Tecnologia', competence);
    const events = (store.agenda || []).filter(event => event.department === 'TI' || event.department === 'Tecnologia');
    widgets['ti-deadlines'] = events.length ? ready('ti-deadlines', events, memory('Agenda', competence, events.length, 'Compromissos do departamento de Tecnologia.', updated)) : empty('ti-deadlines', 'Agenda', competence, 'Nenhum compromisso de Tecnologia cadastrado.');
    widgets['ti-quality'] = pending('ti-quality', 'CMDB / Service Desk', competence);
  } else if (id === 'engineering') {
    widgets['engineering-progress'] = pending('engineering-progress', 'Sienge / planejamento de obras', competence);
    widgets['engineering-budget'] = pending('engineering-budget', 'Sienge', competence);
    widgets['engineering-risk'] = pending('engineering-risk', 'Gestão de obras', competence);
    widgets['engineering-quality'] = pending('engineering-quality', 'Sienge', competence);
  } else if (id === 'budget') {
    widgets['budget-all'] = ready('budget-all', finance, memory('Financeiro departamental', competence, finance.length, 'Comparação financeira por departamento.', updated));
    widgets['budget-ranking'] = ready('budget-ranking', [...finance].sort((a, b) => (b.executionPercentage || 0) - (a.executionPercentage || 0)), memory('Financeiro departamental', competence, finance.length, 'Ranking por percentual de execução.', updated));
    widgets['budget-quality'] = ready('budget-quality', { complete: finance.filter(row => Number.isFinite(row.budget) && Number.isFinite(row.actual)).length, total: finance.length }, memory('Financeiro departamental', competence, finance.length, 'Departamentos com orçamento e realizado informados.', updated));
  } else {
    for (const item of definition.widgets) widgets[item.id] = pending(item.id, id === 'strategy' ? 'Planejamento estratégico' : id === 'projects' ? 'Portfólio de projetos' : 'Matriz corporativa de riscos', competence);
  }
  return { dashboard: definition, filters: { competence, period: query.period || 'portfolio' }, widgets, generatedAt: new Date().toISOString() };
}

module.exports = { dashboardPayload, financeRows, memory };
