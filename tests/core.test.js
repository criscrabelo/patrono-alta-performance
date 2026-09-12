const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROLES, allowed, scoped, metrics, departmentFinancials, filterProcesses, filterHonorariums, judicialHonorariumPayload, seed, parseCsv, hash, ENTITY_MODULE_MAP, entityModule, requireMfa, LEGAL_MODULES, PROTECTED_ENTITY_FIELDS, sanitizeEntityInput, isValidCivilDate, sanitizeProjectItemInput, PROTECTED_PROJECT_ITEM_FIELDS, hasGlobalScope, allowedInDepartment, normalizeDeptSlug, dashboardAuthorized, BUSINESS_CONTENT_MODULES, allowedContent, validateInternalizationProcess, AUDIT_TECHNICAL_FIELDS, sanitizeAuditEventForUser, validateLegalDeadline, LEGAL_DEADLINE_ORIGIN_TYPES, LEGAL_DEADLINE_STATUSES, isLegalDeadlineOverdue } = require('../server');
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

// --- Rodada 5: isolamento módulo x departamento, administrador ≠ superusuário de conteúdo ---

test('hasGlobalScope() deixa de tratar administrador como alçada de negócio global (item 3)', () => {
  assert.equal(hasGlobalScope({ role: 'diretoria' }), true, 'diretoria continua sendo a alçada de negócio global verdadeira');
  assert.equal(hasGlobalScope({ role: 'administrador' }), false, 'administrador técnico não é mais alçada de negócio global — MASTER_HANDOFF: administrador ≠ superusuário de conteúdo');
  assert.equal(hasGlobalScope({ role: 'lider' }), false);
  assert.equal(hasGlobalScope({ role: 'colaborador' }), false);
});

test('scoped() nega administrador para conteúdo fora do próprio escopo (item 3)', () => {
  const administrador = { role: 'administrador', department: null };
  assert.equal(scoped(administrador, { department: 'Jurídico' }), false, 'administrador não é superusuário de conteúdo — precisa estar no escopo do registro como qualquer outro usuário');
  assert.equal(scoped(administrador, { scopeType: 'global' }), true, 'registro explicitamente global continua acessível a qualquer um');
  assert.equal(scoped({ role: 'diretoria' }, { department: 'TI' }), true, 'diretoria continua com bypass total (alçada de negócio verdadeiramente global)');
});

test('allowedInDepartment() nega módulo departamental (juridico/ti) para usuário de outro departamento (item 1)', () => {
  const liderJuridico = { role: 'lider', department: 'Jurídico' };
  const liderTi = { role: 'lider', department: 'TI' };
  const diretoria = { role: 'diretoria', department: null };
  const administrador = { role: 'administrador', department: null };
  assert.equal(allowedInDepartment(liderJuridico, 'juridico', 'read'), true);
  assert.equal(allowedInDepartment(liderTi, 'juridico', 'read'), false, 'lider de TI não pode operar módulo Jurídico, mesmo tendo o módulo em ROLES');
  assert.equal(allowedInDepartment(liderJuridico, 'ti', 'read'), false, 'lider Jurídico não pode operar módulo TI');
  assert.equal(allowedInDepartment(liderTi, 'ti', 'read'), true);
  assert.equal(allowedInDepartment(diretoria, 'juridico', 'read'), true, 'alçada de negócio global acessa qualquer módulo departamental');
  assert.equal(allowedInDepartment(diretoria, 'ti', 'read'), true);
  assert.equal(allowedInDepartment(administrador, 'juridico', 'read'), true, 'administrador técnico gerencia integrações de qualquer departamento (ação de módulo, não acesso a conteúdo)');
  assert.equal(allowedInDepartment(administrador, 'ti', 'read'), true);
  assert.equal(allowedInDepartment(liderJuridico, 'central', 'read'), true, 'módulo sem departamento correspondente não é restringido por esta camada');
});

test('normalizeDeptSlug() remove acentos e caixa para comparação de departmentId', () => {
  assert.equal(normalizeDeptSlug('Jurídico'), 'juridico');
  assert.equal(normalizeDeptSlug('TI'), 'ti');
  assert.equal(normalizeDeptSlug(''), '');
  assert.equal(normalizeDeptSlug(null), '');
});

test('dashboardAuthorized() aplica módulo + alçada global corporativa + departamento (item 5)', () => {
  const executive = { module: 'central', scope: 'corporate', departmentId: undefined };
  const legal = { module: 'juridico', scope: 'department', departmentId: 'dep-juridico' };
  const liderJuridico = { role: 'lider', department: 'Jurídico' };
  const liderTi = { role: 'lider', department: 'TI' };
  const diretoria = { role: 'diretoria', department: null };
  assert.equal(dashboardAuthorized(liderJuridico, executive), false, 'dashboard corporate nega papel departamental');
  assert.equal(dashboardAuthorized(diretoria, executive), true, 'dashboard corporate permite alçada global');
  assert.equal(dashboardAuthorized(liderJuridico, legal), true, 'dashboard departamental permite o próprio departamento');
  assert.equal(dashboardAuthorized(liderTi, legal), false, 'dashboard departamental nega outro departamento');
  assert.equal(dashboardAuthorized(liderJuridico, null), false, 'dashboard inexistente nunca autoriza');
});

// ============================================================================================
// Rodada 6 de correções de segurança — testes unitários
// ============================================================================================

test('allowedContent() nega administrador em módulo de CONTEÚDO de negócio, mesmo com modules/actions "*" (item 3)', () => {
  const administrador = { role: 'administrador', department: null };
  const diretoria = { role: 'diretoria', department: null };
  const liderJuridico = { role: 'lider', department: 'Jurídico' };
  for (const module of BUSINESS_CONTENT_MODULES) {
    for (const action of ['create', 'update', 'archive', 'restore', 'export']) {
      assert.equal(allowedContent(administrador, module, action), false, `administrador não pode "${action}" em módulo de conteúdo "${module}"`);
    }
  }
  // Diretoria (alçada de negócio global) continua liberada para os módulos que de fato tem em ROLES.
  assert.equal(allowedContent(diretoria, 'juridico', 'create'), true);
  // Líder do próprio departamento continua liberado para o módulo departamental correspondente.
  assert.equal(allowedContent(liderJuridico, 'juridico', 'create'), true);
  // Líder de outro departamento continua negado (isolamento departamental, item 1, preservado por allowedContent).
  assert.equal(allowedContent({ role: 'lider', department: 'TI' }, 'juridico', 'create'), false);
});

test('BUSINESS_CONTENT_MODULES contém exatamente os módulos operacionais/departamentais do CRUD de negócio', () => {
  for (const module of ['central', 'estrategia', 'projetos', 'agenda', 'comites', 'orcamento', 'juridico', 'ti']) {
    assert.ok(BUSINESS_CONTENT_MODULES.has(module), `"${module}" deveria estar em BUSINESS_CONTENT_MODULES`);
  }
});

test('dashboardAuthorized() nega dashboard departamental para usuário sem department e sem alçada global (item 2)', () => {
  const legal = { module: 'juridico', scope: 'department', departmentId: 'dep-juridico' };
  const ti = { module: 'ti', scope: 'department', departmentId: 'dep-ti' };
  const administrador = { role: 'administrador', department: null };
  const diretoria = { role: 'diretoria', department: null };
  assert.equal(dashboardAuthorized(administrador, legal), false, 'administrador sem department não pode acessar dashboard departamental Jurídico');
  assert.equal(dashboardAuthorized(administrador, ti), false, 'administrador sem department não pode acessar dashboard departamental de TI');
  assert.equal(dashboardAuthorized(diretoria, legal), true, 'diretoria (alçada global) continua acessando qualquer dashboard departamental');
  assert.equal(dashboardAuthorized(diretoria, ti), true);
});

test('validateInternalizationProcess() valida fonte Monday e escopo do processo relacionado', () => {
  const store = { records: { processos: [
    { id: 'proc-ok', source: 'monday', department: 'Jurídico', deletedAt: null },
    { id: 'proc-manual', source: 'manual', department: 'Jurídico', deletedAt: null },
    { id: 'proc-arquivado', source: 'monday', department: 'Jurídico', deletedAt: '2026-01-01T00:00:00.000Z' }
  ] } };
  const liderJuridico = { role: 'lider', department: 'Jurídico' };
  const liderTi = { role: 'lider', department: 'TI' };
  assert.equal(validateInternalizationProcess('proc-ok', liderJuridico, store), null, 'processo Monday, existente e no escopo do usuário deve validar');
  assert.equal(validateInternalizationProcess('proc-manual', liderJuridico, store)?.status, 422, 'processo sem source monday deve ser rejeitado');
  assert.equal(validateInternalizationProcess('proc-arquivado', liderJuridico, store)?.status, 422, 'processo arquivado (deletedAt) não deve ser considerado existente');
  assert.equal(validateInternalizationProcess('proc-inexistente', liderJuridico, store)?.status, 422, 'processo inexistente deve ser rejeitado');
  assert.equal(validateInternalizationProcess('proc-ok', liderTi, store)?.status, 403, 'processo Monday fora do escopo do usuário deve ser rejeitado');
});

// ============================================================================================
// Rodada 7 de correções de segurança — testes unitários
// ============================================================================================

test('sanitizeAuditEventForUser() remove before/after para quem não tem alçada de negócio global (item 2)', () => {
  const event = { id: 'aud-1', action: 'UPDATE', entity: 'processos', entityId: 'proc-1', responsible: 'Alguém', date: '2026-01-01T00:00:00.000Z', reason: 'Teste', before: { title: 'Antes (conteúdo sensível)' }, after: { title: 'Depois (conteúdo sensível)' }, correlationId: 'corr-1' };
  const administrador = { role: 'administrador', department: null };
  const diretoria = { role: 'diretoria', department: null };
  const sanitized = sanitizeAuditEventForUser(administrador, event);
  assert.equal(sanitized.before, undefined, 'administrador não pode ver o snapshot "before" do conteúdo auditado');
  assert.equal(sanitized.after, undefined, 'administrador não pode ver o snapshot "after" do conteúdo auditado');
  for (const field of AUDIT_TECHNICAL_FIELDS) assert.equal(sanitized[field], event[field], `campo técnico "${field}" deve continuar disponível para administrador`);

  const full = sanitizeAuditEventForUser(diretoria, event);
  assert.deepEqual(full, event, 'diretoria (alçada global) continua recebendo o evento completo, incluindo before/after');
});

test('AUDIT_TECHNICAL_FIELDS não inclui before/after nem qualquer campo de conteúdo de negócio', () => {
  assert.ok(!AUDIT_TECHNICAL_FIELDS.includes('before'));
  assert.ok(!AUDIT_TECHNICAL_FIELDS.includes('after'));
  for (const field of ['id', 'action', 'entity', 'entityId', 'responsible', 'date', 'reason', 'correlationId']) {
    assert.ok(AUDIT_TECHNICAL_FIELDS.includes(field), `"${field}" deveria estar em AUDIT_TECHNICAL_FIELDS`);
  }
});

// ============================================================================================
// Sprint 2, Fase 1 — testes unitários (D1 homologada: originType, status, atraso derivado)
// ============================================================================================

test('validateLegalDeadline() exige originType do enum fechado — JUDICIAL_PROCESSUAL/INTERNAL_CONTROL válidos; ausente/vazio/espaços/inválido rejeitados', () => {
  const store = { records: { processos: [{ id: 'proc-1', source: 'monday', department: 'Jurídico', deletedAt: null }] } };
  const user = { role: 'lider', department: 'Jurídico' };
  const base = { processId: 'proc-1', origin: 'Teste', date: '2026-12-01', status: 'ativo' };

  assert.equal(validateLegalDeadline({ ...base, originType: 'JUDICIAL_PROCESSUAL' }, user, store), null);
  assert.equal(validateLegalDeadline({ ...base, originType: 'INTERNAL_CONTROL' }, user, store), null);
  assert.equal(validateLegalDeadline({ ...base }, user, store)?.status, 422, 'originType ausente deve ser rejeitado');
  assert.equal(validateLegalDeadline({ ...base, originType: '' }, user, store)?.status, 422, 'originType vazio deve ser rejeitado');
  assert.equal(validateLegalDeadline({ ...base, originType: '   ' }, user, store)?.status, 422, 'originType só com espaços deve ser rejeitado (fora do enum)');
  assert.equal(validateLegalDeadline({ ...base, originType: null }, user, store)?.status, 422, 'originType null deve ser rejeitado');
  assert.equal(validateLegalDeadline({ ...base, originType: 'ALGO_INVALIDO' }, user, store)?.status, 422, 'originType fora do enum deve ser rejeitado');
});

test('validateLegalDeadline() exige status do enum fechado — ativo/suspenso/cumprido/cancelado válidos; "reaberto"/"vencido"/ausente/inválido rejeitados', () => {
  const store = { records: { processos: [{ id: 'proc-1', source: 'monday', department: 'Jurídico', deletedAt: null }] } };
  const user = { role: 'lider', department: 'Jurídico' };
  const base = { processId: 'proc-1', origin: 'Teste', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' };

  assert.deepEqual([...LEGAL_DEADLINE_STATUSES], ['ativo', 'suspenso', 'cumprido', 'cancelado']);
  for (const status of LEGAL_DEADLINE_STATUSES) {
    assert.equal(validateLegalDeadline({ ...base, status }, user, store), null, `status "${status}" deveria ser aceito`);
  }
  assert.equal(validateLegalDeadline({ ...base, status: 'reaberto' }, user, store)?.status, 422, 'status "reaberto" nunca é aceito — reabertura é o retorno a "ativo", não um status próprio');
  assert.equal(validateLegalDeadline({ ...base, status: 'vencido' }, user, store)?.status, 422, '"vencido" é condição derivada, nunca um status persistido');
  assert.equal(validateLegalDeadline({ ...base, status: 'em_atraso' }, user, store)?.status, 422);
  assert.equal(validateLegalDeadline({ ...base, status: 'pendente' }, user, store)?.status, 422);
  assert.equal(validateLegalDeadline({ ...base }, user, store)?.status, 422, 'status ausente é rejeitado pela validação pura — o default "ativo" é aplicado pelo handler HTTP na criação, não por validateLegalDeadline()');
});

test('isLegalDeadlineOverdue() — atraso é condição derivada de status+date, nunca persistida', () => {
  assert.equal(isLegalDeadlineOverdue({ status: 'ativo', date: '2026-01-01' }, '2026-06-01'), true, 'ativo + data passada = atrasado');
  assert.equal(isLegalDeadlineOverdue({ status: 'ativo', date: '2026-12-31' }, '2026-06-01'), false, 'ativo + data futura = não atrasado');
  assert.equal(isLegalDeadlineOverdue({ status: 'ativo', date: '2026-06-01' }, '2026-06-01'), false, 'ativo + data de hoje = não atrasado até o fim da data civil');
  assert.equal(isLegalDeadlineOverdue({ status: 'suspenso', date: '2026-01-01' }, '2026-06-01'), false, 'suspenso nunca aparece como atraso, mesmo com data passada');
  assert.equal(isLegalDeadlineOverdue({ status: 'cumprido', date: '2026-01-01' }, '2026-06-01'), false, 'cumprido nunca aparece como atraso');
  assert.equal(isLegalDeadlineOverdue({ status: 'cancelado', date: '2026-01-01' }, '2026-06-01'), false, 'cancelado nunca aparece como atraso');
});

test('isLegalDeadlineOverdue() não sofre deslocamento por timezone/UTC — comparação lexicográfica determinística de datas civis', () => {
  assert.equal(isLegalDeadlineOverdue({ status: 'ativo', date: '2026-03-09' }, '2026-03-10'), true);
  assert.equal(isLegalDeadlineOverdue({ status: 'ativo', date: '2026-03-10' }, '2026-03-10'), false);
  assert.equal(isLegalDeadlineOverdue({ status: 'ativo', date: '2026-03-11' }, '2026-03-10'), false);
  assert.equal(isLegalDeadlineOverdue(null, '2026-03-10'), false, 'deadline ausente nunca é atrasado');
  assert.equal(isLegalDeadlineOverdue({ status: 'ativo', date: 'banana' }, '2026-03-10'), false, 'data inválida nunca é considerada atrasada');
  assert.equal(isLegalDeadlineOverdue({ status: 'ativo', date: '2026-99-99' }, '2026-03-10'), false, 'data civil inexistente nunca é considerada atrasada');
});
