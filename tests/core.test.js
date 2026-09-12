const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROLES, allowed, scoped, metrics, departmentFinancials, filterProcesses, filterHonorariums, judicialHonorariumPayload, seed, parseCsv, hash, ENTITY_MODULE_MAP, entityModule, requireMfa, LEGAL_MODULES, PROTECTED_ENTITY_FIELDS, sanitizeEntityInput, isValidCivilDate, sanitizeProjectItemInput, PROTECTED_PROJECT_ITEM_FIELDS } = require('../server');
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
test('autenticação não aceita bypass usr-* nem challenge como token de sessão', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /token\.startsWith\('usr-'\)/, 'bypass usr-* deve estar removido de getUser');
  assert.doesNotMatch(server, /IS_PRODUCTION/, 'constante deixa de existir junto com o bypass');
  assert.match(server, /!session\.challenge/, 'challenge não pode ser aceito como sessão');
  assert.match(server, /if \(!requireMfa\(found\)\)[\s\S]{0,200}sessions\.set\(token/, 'login deve emitir token quando MFA não é exigido');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /Bearer usr-/, 'frontend não deve ter fallback de bearer privilegiado');
  assert.match(app, /window\.__coevoToken=result\.data\.token;state\.authenticated=true/, 'submitLogin deve guardar o token antes de autenticar');
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

// --- Sprint 1 / Fundação: testes de object-level authorization e MFA por papel (item B, D e §11/§26) ---

test('GET /api/entities/:type nega tipo fora do allowlist (deny-by-default, sem depender de coincidência com módulo)', () => {
  assert.equal(entityModule('processos'), 'juridico');
  assert.equal(entityModule('legalDeadlines'), 'juridico');
  assert.equal(entityModule('financeiroBancario'), null, 'tipo não mapeado deve ser negado, nunca aceito por coincidência de nome');
  assert.equal(entityModule('__proto__'), null);
});

test('MFA de perfis privilegiados independe da flag mfa do cadastro (item D corrigido)', () => {
  assert.equal(requireMfa({ role: 'lider', mfa: false }), true, 'papel privilegiado deve exigir MFA mesmo com mfa:false');
  assert.equal(requireMfa({ role: 'diretoria', mfa: false }), true);
  assert.equal(requireMfa({ role: 'administrador', mfa: false }), true);
  assert.equal(requireMfa({ role: 'colaborador', mfa: false }), false, 'colaborador não é perfil privilegiado');
});

// Cobertura funcional real (não baseada em regex de source) das correções de object-level authorization,
// sanitização de campos protegidos e escopo — ver tests/security-integration.test.js para os testes de
// HTTP em runtime equivalentes, exercitando o handler real via servidor real.

test('scoped() nega registro sem department nem classificação global (deny-by-default, corrigido na rodada 2)', () => {
  const colaborador = { role: 'colaborador', department: 'Jurídico' };
  assert.equal(scoped(colaborador, {}), false, 'registro sem department não pode ser tratado como global por omissão');
  assert.equal(scoped(colaborador, { department: 'Jurídico' }), true);
  assert.equal(scoped(colaborador, { department: 'TI' }), false);
  assert.equal(scoped(colaborador, { scopeType: 'global' }), true, 'registro explicitamente global permanece acessível');
  assert.equal(scoped({ role: 'diretoria' }, {}), true, 'diretoria/administrador continuam com acesso total');
});

// P0 corrigido (rodada 3, item 2): a versão anterior deste teste validava exatamente o bug relatado no
// review — "sem companyId no usuário, o gate de empresa não se aplica" era a ausência de
// deny-by-default. Registro com companyId agora exige que o usuário tenha o MESMO companyId; ausência
// ou valor diferente nega. Continua inerte em produção (nenhum registro/usuário real carrega esses
// campos hoje — docs/PERMISSIONS.md), testado aqui apenas com dados sintéticos.
test('scoped() aplica deny-by-default em companyId/speId — corrigido (rodada 3, item 2)', () => {
  const semEmpresa = { role: 'colaborador', department: 'Jurídico' };
  const empresaX = { role: 'colaborador', department: 'Jurídico', companyId: 'empresa-x' };
  const empresaY = { role: 'colaborador', department: 'Jurídico', companyId: 'empresa-y' };
  const registroDaEmpresaX = { department: 'Jurídico', companyId: 'empresa-x' };
  assert.equal(scoped(semEmpresa, registroDaEmpresaX), false, 'usuário SEM companyId deve ser negado quando o registro tem companyId (deny-by-default)');
  assert.equal(scoped(empresaY, registroDaEmpresaX), false, 'usuário com companyId DIFERENTE deve ser negado');
  assert.equal(scoped(empresaX, registroDaEmpresaX), true, 'usuário com o MESMO companyId é permitido');
  assert.equal(scoped({ role: 'diretoria' }, registroDaEmpresaX), true, 'papel global ignora companyId, como qualquer outro escopo');

  const semSpe = { role: 'colaborador', department: 'Jurídico' };
  const speA = { role: 'colaborador', department: 'Jurídico', speId: 'spe-a' };
  const speB = { role: 'colaborador', department: 'Jurídico', speId: 'spe-b' };
  const registroDaSpeA = { department: 'Jurídico', speId: 'spe-a' };
  assert.equal(scoped(semSpe, registroDaSpeA), false, 'mesma lógica de deny-by-default para speId: ausência nega');
  assert.equal(scoped(speB, registroDaSpeA), false, 'speId diferente nega');
  assert.equal(scoped(speA, registroDaSpeA), true, 'speId igual permite');
});

test('sanitizeEntityInput remove campos controlados pelo servidor e o escopo departamental do input do cliente', () => {
  const maliciousInput = {
    id: 'id-forjado', version: 999, createdAt: '2000-01-01', createdBy: 'Invasor',
    updatedAt: '2000-01-01', updatedBy: 'Invasor', deletedAt: '2000-01-01', deletedBy: 'Invasor',
    source: 'monday', externalId: 'ext-forjado', boardId: 'board-x', boardName: 'Board X', syncedAt: '2000-01-01',
    department: 'TI', scopeType: 'global', companyId: 'empresa-forjada', speId: 'spe-forjada', title: 'Registro legítimo'
  };
  const colaborador = { role: 'colaborador', department: 'Jurídico' };
  const sanitizedForColaborador = sanitizeEntityInput(maliciousInput, colaborador);
  for (const field of PROTECTED_ENTITY_FIELDS) assert.equal(sanitizedForColaborador[field], undefined, `campo protegido "${field}" não pode sobreviver à sanitização`);
  assert.equal(sanitizedForColaborador.department, undefined, 'papel com escopo departamental não escolhe o department do próprio registro');
  // P0 corrigido (rodada 3, item 1): scopeType/companyId/speId também precisam ser removidos do input
  // de um papel departamental — do contrário, um colaborador poderia enviar scopeType:'global' e
  // tornar o próprio registro visível a qualquer departamento (scoped() libera scopeType:'global'
  // incondicionalmente), ou atribuir a si mesmo um companyId/speId sem ter essa alçada.
  assert.equal(sanitizedForColaborador.scopeType, undefined, 'papel departamental não pode se autodeclarar scopeType:global');
  assert.equal(sanitizedForColaborador.companyId, undefined, 'papel departamental não escolhe companyId');
  assert.equal(sanitizedForColaborador.speId, undefined, 'papel departamental não escolhe speId');
  assert.equal(sanitizedForColaborador.title, 'Registro legítimo', 'campos de negócio legítimos permanecem intactos');

  const diretoria = { role: 'diretoria', department: null };
  const sanitizedForDiretoria = sanitizeEntityInput(maliciousInput, diretoria);
  for (const field of PROTECTED_ENTITY_FIELDS) assert.equal(sanitizedForDiretoria[field], undefined);
  assert.equal(sanitizedForDiretoria.department, 'TI', 'papel com escopo global (*) pode escolher o department do registro que está criando/gerindo');
  assert.equal(sanitizedForDiretoria.scopeType, 'global', 'papel com escopo global é o único expressamente autorizado a tornar um registro global');
  assert.equal(sanitizedForDiretoria.companyId, 'empresa-forjada');
  assert.equal(sanitizedForDiretoria.speId, 'spe-forjada');
});

test('LEGAL_MODULES é uma allowlist fechada — nenhum tipo de entidade genérica vaza por /api/legal/:module', () => {
  assert.ok(LEGAL_MODULES.has('processos'));
  assert.ok(LEGAL_MODULES.has('honorariosJudiciais'));
  assert.equal(LEGAL_MODULES.has('legalDeadlines'), false, 'entidades do motor genérico não são expostas por /api/legal/:module');
  assert.equal(LEGAL_MODULES.has('__proto__'), false);
  assert.equal(LEGAL_MODULES.has('financeiroBancario'), false);
});

// --- Rodada 4: validação semântica de Legal Deadline e sanitização de sub-recursos de projeto ---

test('isValidCivilDate rejeita valores não-truthy triviais: texto arbitrário, espaços, mês/dia inválidos', () => {
  assert.equal(isValidCivilDate('2026-12-01'), true, 'data civil real deve ser aceita');
  assert.equal(isValidCivilDate('2026-02-29'), false, '2026 não é bissexto — 29/02 não existe');
  assert.equal(isValidCivilDate('2024-02-29'), true, '2024 é bissexto — 29/02 existe');
  assert.equal(isValidCivilDate('banana'), false);
  assert.equal(isValidCivilDate(' '), false);
  assert.equal(isValidCivilDate(''), false);
  assert.equal(isValidCivilDate('2026-99-99'), false, 'mês/dia fora do calendário');
  assert.equal(isValidCivilDate('2026-13-01'), false, 'mês 13 não existe');
  assert.equal(isValidCivilDate('2026-04-31'), false, 'abril não tem dia 31');
  assert.equal(isValidCivilDate(null), false);
  assert.equal(isValidCivilDate(undefined), false);
  assert.equal(isValidCivilDate(20261201), false, 'precisa ser string, não número');
});

test('sanitizeProjectItemInput remove campos controlados pelo servidor de sub-recursos de projeto', () => {
  const maliciousInput = {
    id: 'id-forjado', projectId: 'outro-projeto-forjado', createdAt: '2000-01-01T00:00:00.000Z', createdBy: 'Invasor',
    deletedAt: '2000-01-01T00:00:00.000Z', deletedBy: 'Invasor', departmentId: 'dep-forjado', scopeType: 'global',
    companyId: 'empresa-forjada', speId: 'spe-forjada', title: 'Ação legítima'
  };
  const colaborador = { role: 'colaborador', department: 'Jurídico' };
  const sanitized = sanitizeProjectItemInput(maliciousInput, colaborador);
  for (const field of PROTECTED_PROJECT_ITEM_FIELDS) assert.equal(sanitized[field], undefined, `campo protegido "${field}" não pode sobreviver à sanitização`);
  assert.equal(sanitized.departmentId, undefined);
  assert.equal(sanitized.scopeType, undefined);
  assert.equal(sanitized.companyId, undefined);
  assert.equal(sanitized.speId, undefined);
  assert.equal(sanitized.title, 'Ação legítima', 'campo de negócio legítimo permanece intacto');

  const diretoria = { role: 'diretoria', department: null };
  const sanitizedGlobal = sanitizeProjectItemInput(maliciousInput, diretoria);
  for (const field of PROTECTED_PROJECT_ITEM_FIELDS) assert.equal(sanitizedGlobal[field], undefined);
  assert.equal(sanitizedGlobal.departmentId, 'dep-forjado', 'papel com escopo global pode escolher o departamento do sub-recurso');
});
