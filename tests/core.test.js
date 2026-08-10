const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROLES, allowed, metrics, departmentFinancials, filterProcesses, filterHonorariums, judicialHonorariumPayload, seed, parseCsv, hash } = require('../server');
const { WIDGET_TYPES, DASHBOARD_DEFINITIONS } = require('../dashboard-model');
const { dashboardPayload } = require('../dashboard-service');
const { PROJECT_ID, ensureProjectStore, projectDetail, projectPermissions } = require('../project-service');

test('RBAC mantém ações críticas fora do colaborador', () => {
  assert.equal(allowed({ role: 'colaborador' }, 'orcamento', 'approve'), false);
  assert.equal(allowed({ role: 'lider' }, 'orcamento', 'read'), true);
  assert.equal(allowed({ role: 'diretoria' }, 'comites', 'export'), true);
});
test('consolidação de orçamento preserva execução baseada em realizado/orçado', () => {
  const m = metrics(seed);
  assert.equal(Number(m.budget.toFixed(2)), 1044730.42);
  assert.equal(Number(m.realized.toFixed(2)), 529499.77);
  assert.equal(m.execution, m.realized / m.budget);
});
test('modelo financeiro separa departamentos por departmentId antes do consolidado', () => {
  const rows = departmentFinancials(seed);
  assert.deepEqual(rows.map(row => row.departmentId), ['dep-juridico','dep-ti']);
  assert.equal(rows.find(row => row.departmentId === 'dep-juridico').actual, 145499.77);
  assert.equal(rows.find(row => row.departmentId === 'dep-ti').actual, 384000);
  assert.equal(metrics(seed).composition.length, 2);
  const expanded = {...seed, departments:[...seed.departments,{id:'dep-rh',name:'RH',budget:{}}]};
  const rh = departmentFinancials(expanded).find(row => row.departmentId === 'dep-rh');
  assert.equal(rh.actual, null);
  assert.equal(departmentFinancials(expanded).length, 3);
});
test('papéis privilegiados têm MFA no seed de homologação', () => {
  assert.equal(seed.users.filter(u => ['diretoria','administrador'].includes(u.role)).every(u => u.mfa), true);
});
test('importação rejeita cabeçalhos ausentes e deduplica competência', () => {
  const preview = parseCsv('department,competence,budgeted,planned,committed,realized\nJurídico,2026-08,10,8,1,5\nJurídico,2026-08,10,8,1,5');
  assert.equal(preview.valid.length, 1);
  assert.equal(preview.duplicates.length, 1);
  assert.equal(parseCsv('department,competence\nTI,2026-08').invalid.length, 1);
});
test('checksum é determinístico para reprocessamento idempotente', () => {
  assert.equal(hash('origem-1'), hash('origem-1'));
  assert.notEqual(hash('origem-1'), hash('origem-2'));
});
test('interface consolidada mantém login acessível e MFA embutido', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(source, /COEVO Alta Performance/);
  assert.match(source, /submitMfa/);
  assert.doesNotMatch(source, /prompt\s*\(/);
  assert.doesNotMatch(source, /Plataforma corporativa/i);
});
test('tela de login não traz credenciais pré-preenchidas nem chave de exemplo funcional', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const loginForm = source.match(/function loginScreen\(\)\{[\s\S]*?\n/)[0];
  assert.doesNotMatch(loginForm, /id="login-email"[^>]*\svalue=/);
  assert.doesNotMatch(loginForm, /id="login-password"[^>]*\svalue=/);
  assert.match(loginForm, /id="login-email"[^>]*required/);
  assert.match(loginForm, /id="login-password"[^>]*required/);
  const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const backupKey = example.match(/^\s*COEVO_BACKUP_KEY\s*=([^\r\n]*)/m)[1].trim();
  assert.equal(backupKey, '', 'COEVO_BACKUP_KEY do .env.example deve ficar vazio');
  assert.ok(backupKey.length < 32, 'placeholder não pode satisfazer o mínimo de 32 caracteres exigido por encryptBackup');
});
test('processos e demais pastas oferecem filtros múltiplos e títulos do Monday', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  for (const field of ['Polo','Tipo','Ano','Mês','Empreendimento/Grupo','Escopo','Status']) assert.match(source, new RegExp(field));
  assert.match(source, /Limpar filtros/);
  assert.match(source, /columnsByTitle/);
  assert.match(source, /Notificações/);
});
test('sidebar corporativa inclui seções, accordions e controles responsivos', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  for (const label of ['Painel Executivo','Alertas & Pendências','GESTÃO','INTELIGÊNCIA','GOVERNANÇA','UTILITÁRIOS','ADMINISTRAÇÃO','Auditoria & Compliance','Central de Inconsistências','Backup & Restauração']) assert.match(source, new RegExp(label));
  assert.match(source, /toggleDepartment/);
  assert.match(source, /toggleSidebar/);
  assert.match(source, /toggleMobileMenu/);
  assert.match(source, /isAdmin/);
});
test('dashboard jurídico possui filtros globais, memória de cálculo e estados de integração', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.css'), 'utf8');
  for (const label of ['Painel Executivo Jurídico','Atenção da Gestora','Processos ativos','Exposição','Valor recuperado','Honorários','Memória de cálculo','Qualidade e origem dos dados','Sugestões da Têmis']) assert.match(source, new RegExp(label));
  assert.doesNotMatch(source, /label:'Prazos críticos'/);
  assert.match(source, /clearLegalDashboardFilters/);
  assert.match(source, /dateRangeSelector/);
  assert.match(source, /competencePicker/);
  assert.match(source, /customPeriodDialog/);
  assert.match(source, /periodPreset/);
  assert.match(source, /comparisonCompetence/);
  assert.match(source, /customCompetences/);
  assert.match(source, /syncLegalDashboardUrl/);
  assert.match(source, /2018-01/);
  assert.match(css, /custom-month-grid/);
  assert.match(css, /mobile-period-summary/);
  assert.match(source, /openDashboardDrilldown/);
  assert.match(source, /Aguardando integração Sienge/);
  assert.match(css, /@media \(max-width:680px\)/);
});
test('painel executivo separa Jurídico, Tecnologia e Consolidado COEVO', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  for (const label of ['Painel Executivo COEVO','Painel Executivo Jurídico','Painel Executivo TI','Execução orçamentária por departamento','Consolidado COEVO','Processos ativos','Compromissos agendados','Orçamento aprovado','departmentId']) assert.match(source, new RegExp(label));
  assert.doesNotMatch(source, /<div class="eyebrow">Financeiro<\/div>/);
  assert.match(source, /goBudget\('Jurídico'\)/);
  assert.match(source, /goBudget\('TI'\)/);
});
test('API de processos filtra responsáveis individuais e pagina no backend', () => {
  const rows = [
    {title:'1000000-00.2026.8.00.0001',columnsByTitle:{RESPONSÁVEL:'Miguel, Thamar Victória',EMPREENDIMENTO:'TETUS LOCAÇÃO',"'MEU TRABALHO'":'ACOMPANHANDO','TIPO DE AÇÃO':'EXECUÇÃO CIVIL',LOCAL:'INTERNO',POSIÇÃO:'REQUERENTE','CITAÇÃO/PROTOCOLO':'2026-02-10'}},
    {title:'2000000-00.2025.8.00.0001',columnsByTitle:{RESPONSÁVEL:'Miguel',EMPREENDIMENTO:'ALENCAR MAZZEO',"'MEU TRABALHO'":'FINALIZADO','TIPO DE AÇÃO':'COBRANÇA',LOCAL:'EXTERNO MICHELE',POSIÇÃO:'REQUERIDO','CITAÇÃO/PROTOCOLO':'2025-05-10'}}
  ];
  const result = filterProcesses(rows,new URL('http://local/api/legal/processos?responsible=Thamar%20Vict%C3%B3ria&pageSize=25'));
  assert.equal(result.count,1);
  assert.equal(result.records[0].title,rows[0].title);
  assert.deepEqual(result.facets.responsible,['Michele','Miguel','Thamar Victória']);
  assert.equal(result.pagination.pageSize,25);
  const external = filterProcesses(rows,new URL('http://local/api/legal/processos?responsible=Michele&pageSize=25'));
  assert.equal(external.count,1);
  assert.equal(external.records[0].title,rows[1].title);
});
test('processos judiciais usam filtros compactos, drawer, chips e paginação', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  for (const name of ['processMultiSelect','advancedProcessDrawer','processActiveChips','processPagination','showProcessTraceability','copyProcessNumber']) assert.match(source,new RegExp(name));
  assert.match(source,/Buscar por processo, empreendimento, responsável ou palavra-chave/);
  assert.match(source,/processMultiSelect\('responsible','Responsável'/);
  assert.doesNotMatch(source,/processMultiSelect\('externalResponsible'/);
  assert.match(source,/paginated:'1'/);
});
test('arquitetura de dashboards possui catálogo reutilizável e tipos padronizados', () => {
  for (const id of ['executive','legal','ti','engineering','budget','strategy','projects','risks']) assert.ok(DASHBOARD_DEFINITIONS[id]);
  for (const type of ['ExecutiveKpiCard','BudgetComparison','RiskSummary','AttentionList','DataQualityWidget','DecisionList']) assert.ok(WIDGET_TYPES.includes(type));
  for (const dashboard of Object.values(DASHBOARD_DEFINITIONS)) {
    assert.ok(dashboard.widgets.length);
    assert.equal(new Set(dashboard.widgets.map(widget => widget.id)).size, dashboard.widgets.length);
    assert.ok(dashboard.widgets.every(widget => WIDGET_TYPES.includes(widget.type)));
  }
});
test('agregador de dashboards preserva origem, regra e estados sem inventar dados', () => {
  const store = structuredClone(seed); store.records = { processos: [] };
  const executive = dashboardPayload(store, 'executive', { competence: '2026-08' });
  assert.equal(executive.dashboard.id, 'executive');
  assert.equal(executive.widgets['budget-comparison'].state, 'ready');
  assert.equal(executive.widgets['budget-comparison'].memory.ruleVersion, 'COEVO-DASH-1.0');
  const engineering = dashboardPayload(store, 'engineering', { competence: '2026-08' });
  assert.ok(Object.values(engineering.widgets).every(widget => widget.state === 'integration_pending'));
  assert.ok(Object.values(engineering.widgets).every(widget => widget.memory.source));
});
test('frontend dos dashboards trata widgets isoladamente e permite personalização', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard-widgets.js'), 'utf8');
  for (const state of ['loading','empty','error','forbidden','integration_pending']) assert.match(source, new RegExp(state));
  assert.match(source, /Memória de cálculo/);
  assert.match(source, /hiddenWidgets/);
  assert.match(source, /widgetOrder/);
});
test('honorários normalizam responsáveis e competência sem alterar o registro histórico', () => {
  const rows=[{title:'Honorário A',group:'ABR/24',createdAt:'2024-04-10',syncedAt:'2026-08-09T18:01:00.000Z',columns:{person:'Miguel, Geovana Cavalcanti',status:'PAGO',status_1__1:'AURORA',data:'2024-04-10',n_meros7__1:'100.50'},columnsByTitle:{Pessoa:'Miguel, Geovana Cavalcanti',Status:'PAGO',EMPREENDIMENTO:'AURORA',Data:'2024-04-10',HONORÁRIOS:'100.50','📋 Tipo de Honorário':''}}];
  const result=filterHonorariums(rows,new URL('http://local?responsible=Geovana%20Cavalcanti'));
  assert.equal(result.count,1);
  assert.deepEqual(result.facets.responsible,['Geovana Cavalcanti','Miguel']);
  assert.equal(result.records[0].normalized.competence,'2024-04');
  assert.equal(result.records[0].normalized.type,'Não informado');
  assert.equal(result.summary.total,100.5);
  assert.deepEqual(result.summary.months,[{key:'2024-04',total:100.5,count:1}]);
  assert.deepEqual(result.summary.quarters,[{key:'2024-T2',total:100.5,count:1}]);
  assert.deepEqual(result.summary.semesters,[{key:'2024-S1',total:100.5,count:1}]);
  assert.equal(rows[0].group,'ABR/24');
  assert.equal(rows[0].columns.person,'Miguel, Geovana Cavalcanti');
});
test('tela de honorários usa barra compacta, chips, paginação e filtros avançados', () => {
  const source=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  for(const name of ['honorariumPage','honorariumMultiSelect','honorariumActiveChips','advancedHonorariumDrawer','honorariumPagination','syncHonorariumUrl','restoreHonorariumFiltersFromUrl'])assert.match(source,new RegExp(name));
  for(const label of ['Honorários Extrajudiciais','Busca','Status','Empreendimento','Responsável','Ano','Mais filtros','Competência','Forma de pagamento','Última sincronização'])assert.match(source,new RegExp(label));
  assert.match(source,/As competências não são tratadas como tipo/);
  assert.match(source,/paginated:'1'/);
  for(const name of ['honorariumFinancialSummary','setHonorariumSummaryMode','honorariumPeriodLabel'])assert.match(source,new RegExp(name));
  for(const label of ['Total do recorte filtrado','Mês','Trimestre','Semestre','Totais por período'])assert.match(source,new RegExp(label));
});
test('honorários judiciais usam apenas o campo efetivado dos processos', () => {
  const rows=[
    {title:'1000',createdAt:'2026-01-01',syncedAt:'2026-08-09T18:00:00.000Z',columnsByTitle:{'HONORÁRIOS EFETIVADOS':'1500.50',EMPREENDIMENTO:'AURORA',RESPONSÁVEL:'Miguel',"'MEU TRABALHO'":'ACORDO','TIPO DE AÇÃO':'COBRANÇA','CITAÇÃO/PROTOCOLO':'2026-01-10'},columns:{}},
    {title:'2000',createdAt:'2026-01-01',columnsByTitle:{'HONORÁRIOS EFETIVADOS':'',EMPREENDIMENTO:'VERANO'},columns:{}}
  ];
  const result=judicialHonorariumPayload(rows);
  assert.equal(result.count,1);
  assert.equal(result.summary.total,1500.5);
  assert.deepEqual(result.summary.months,[{key:'2026-01',total:1500.5,count:1}]);
  assert.deepEqual(result.summary.quarters,[{key:'2026-T1',total:1500.5,count:1}]);
  assert.deepEqual(result.summary.semesters,[{key:'2026-S1',total:1500.5,count:1}]);
  assert.equal(result.records[0].normalized.enterprise,'AURORA');
  assert.equal(result.records[0].normalized.status,'Acordo');
});
test('menu e páginas separam honorários extrajudiciais e judiciais', () => {
  const source=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  assert.match(source,/\['honorarios','Honorários Extrajudiciais'\]/);
  assert.match(source,/\['honorarios-judiciais','Honorários Judiciais'\]/);
  assert.match(source,/judicialHonorariumPage/);
  assert.match(source,/HONORÁRIOS EFETIVADOS/);
  assert.match(source,/honorariosJudiciais:'1'/);
  assert.match(source,/syncJudicialHonorariumUrl/);
  assert.match(source,/state\.legalModule==='honorarios-judiciais'\?syncJudicialHonorariumUrl\(\):syncHonorariumUrl\(\)/);
});

test('projeto de recuperação usa relações de usuário e não inventa indicadores', () => {
  const store=structuredClone(seed);
  store.records={processos:[],honorarios:[]};
  store.audit=[];
  ensureProjectStore(store);
  const detail=projectDetail(store,PROJECT_ID);
  assert.equal(detail.project.owner.id,'usr-miguel');
  assert.equal(detail.project.owner.name,'Miguel');
  assert.equal(detail.project.manager.id,'usr-diretoria');
  assert.equal(detail.project.manager.name,'Cristiane Carneiro Rabelo');
  assert.equal(detail.workstreams.length,10);
  assert.equal(detail.actions.length,12);
  assert.equal(detail.indicators.length,24);
  assert.equal(detail.indicators.every(item=>item.value===null&&item.status==='Aguardando integração'),true);
  assert.equal(detail.managementItems.length,0);
  assert.equal(detail.approvalRules[0].levels.length,0);
});

test('alçadas do projeto separam execução operacional de aprovação', () => {
  const operational=projectPermissions({id:'usr-miguel',role:'colaborador',department:'Jurídico'});
  const manager=projectPermissions({id:'usr-diretoria',role:'diretoria',department:null});
  assert.equal(operational.edit,true);
  assert.equal(operational.approveAgreement,false);
  assert.equal(operational.changeApprovalRule,false);
  assert.equal(manager.approveAgreement,true);
  assert.equal(manager.changeApprovalRule,true);
  assert.equal(manager.changeTarget,true);
});

test('interface de Projetos exibe governança, pendências e estados sem dados simulados', () => {
  const source=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  for(const name of ['projectsPage','projectPortfolioPage','projectDetailPage','openRecoveryProject','projectManagementItems','projectTargetPanel','projectCharts'])assert.match(source,new RegExp(name));
  for(const label of ['Responsável operacional','Gestão','Pendências para gestão','Atenção da gestora','Plano de ação','Internalização','Negociações','Advogados e tratativas jurídicas','Recuperação interna x externa','Alçadas e escalonamento','Sem dados simulados','Atual','Baseline','Gap','Tendência','Recuperação mensal','Aging da carteira','Funil de recuperação'])assert.match(source,new RegExp(label));
});

test('API de Projetos expõe ciclo de vida das entidades com exclusão lógica', () => {
  const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(source,/PROJECT_RESOURCE_MAP/);
  assert.match(source,/req\.method === 'PATCH'.*actions\|milestones\|risks\|internalizations\|negotiations/s);
  assert.match(source,/req\.method === 'DELETE'.*deletedAt/s);
  assert.match(source,/restore\$/);
  for(const action of ['UPDATE','ARCHIVE','RESTORE'])assert.match(source,new RegExp(`'${action}'`));
});
