const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROLES, allowed, scoped, metrics, departmentFinancials, filterProcesses, filterHonorariums, judicialHonorariumPayload, seed, parseCsv, hash, ENTITY_MODULE_MAP, entityModule, requireMfa, LEGAL_MODULES, PROTECTED_ENTITY_FIELDS, sanitizeEntityInput, isValidCivilDate, sanitizeProjectItemInput, PROTECTED_PROJECT_ITEM_FIELDS, hasGlobalScope, allowedInDepartment, normalizeDeptSlug, dashboardAuthorized, BUSINESS_CONTENT_MODULES, allowedContent, validateInternalizationProcess, AUDIT_TECHNICAL_FIELDS, sanitizeAuditEventForUser, validateLegalDeadline, LEGAL_DEADLINE_ORIGIN_TYPES, LEGAL_DEADLINE_STATUSES, isLegalDeadlineOverdue, civilDateAfterDays, legalDeadlineIntegrityFlag, filterLegalDeadlines, scopedLegalDeadlineRows, legalDeadlineAgendaItems, agendaEventItems, sortAgendaItems, legalDeadlineAttentionItems, isOperationallyVisible, civilWeekWindow, responsibleInfo, myWeekLegalDeadlineItems, googleCalendarStatus, googleCalendarEvents, legalDeadlineLabels, legalDeadlineConfirmationLabel, filterCalendarEventsByWindow, canBeResponsibleForLegalDeadline } = require('../server');
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
test('autenticação individual (H2): sem bypass usr-*, sem senha/MFA global, sessão persistida por hash de token', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /token\.startsWith\('usr-'\)/, 'bypass usr-* deve continuar removido de getUser');
  assert.doesNotMatch(server, /const sessions = new Map\(\)/, 'sessão não pode voltar a viver em memória (Map) — precisa ser persistida (auth_sessions)');
  assert.doesNotMatch(server, /hash\(input\.password\) !== hash\(configured\)/, 'login não pode mais comparar contra uma senha global (COEVO_DEMO_PASSWORD)');
  assert.doesNotMatch(server, /process\.env\.COEVO_MFA_CODE/, 'MFA não pode mais comparar contra um código global (COEVO_MFA_CODE)');
  assert.match(server, /authCrypto\.verifyPassword\(input\.password, found\.passwordHash\)/, 'login deve verificar a senha individual do usuário (hash próprio), nunca uma senha global');
  assert.match(server, /\(store\.authSessions \|\| \[\]\)\.find\(s => s\.tokenHash === tokenHash\)/, 'getUser deve resolver a sessão em auth_sessions pelo hash do token, nunca pelo token bruto nem por um Map em memória');
  assert.match(server, /if \(requireMfa\(found\) && found\.mfaEnabled\)/, 'login só emite desafio de MFA quando o próprio usuário tem MFA individual confirmado, nunca por um código global');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /Bearer usr-/, 'frontend não deve ter fallback de bearer privilegiado');
  assert.match(app, /window\.__coevoToken=result\.data\.token;state\.authenticated=true/, 'submitLogin deve guardar o token antes de autenticar');
});
test('TOTP (H2): implementação bate exatamente com os vetores de teste oficiais do RFC 6238 (Apêndice B, SHA1)', () => {
  const authCrypto = require('../auth/crypto');
  // Segredo padrão do RFC 6238 Apêndice B: os 20 bytes ASCII "12345678901234567890", codificados em
  // base32 pela própria implementação (evita transcrever manualmente a string base32 equivalente).
  const secret = authCrypto.base32Encode(Buffer.from('12345678901234567890', 'ascii'));
  // O RFC especifica os vetores em 8 dígitos (nossa implementação usa 6 por padrão, mas totpAt() aceita
  // `digits` como parâmetro — passamos 8 aqui só para validar contra o vetor oficial exatamente como
  // publicado, sem alterar o comportamento de 6 dígitos usado em produção).
  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130']
  ];
  for (const [unixSeconds, expected] of vectors) {
    assert.equal(authCrypto.totpAt(secret, unixSeconds * 1000, 30, 8), expected, `TOTP em T=${unixSeconds}s deveria bater com o vetor oficial do RFC 6238`);
  }
});
test('MFA_ENCRYPTION_KEY (H2, revisão pós-PR #13): fail-fast em produção, degradação graciosa fora dela', () => {
  const { validateAuthRuntimeConfig } = require('../server');
  const originalEnv = process.env.NODE_ENV;
  const originalKey = process.env.MFA_ENCRYPTION_KEY;
  // H3 (docs/DECISIONS.md, PROD-H3-01): validateAuthRuntimeConfig() também exige RATE_LIMIT_HMAC_KEY em
  // produção — fixada aqui com um valor válido para que este teste continue isolando especificamente o
  // comportamento de MFA_ENCRYPTION_KEY, sem falhar por causa da checagem irmã.
  const originalRateLimitKey = process.env.RATE_LIMIT_HMAC_KEY;
  try {
    process.env.NODE_ENV = 'production';
    process.env.RATE_LIMIT_HMAC_KEY = 'chave-de-producao-valida-com-32-caracteres-ou-mais';
    delete process.env.MFA_ENCRYPTION_KEY;
    assert.throws(() => validateAuthRuntimeConfig(), /MFA_ENCRYPTION_KEY/, 'produção sem a chave deve falhar explicitamente antes de escutar a porta');

    process.env.MFA_ENCRYPTION_KEY = 'curta-demais';
    assert.throws(() => validateAuthRuntimeConfig(), /MFA_ENCRYPTION_KEY/, 'produção com chave curta (<32 caracteres) deve falhar explicitamente, igual à ausência');

    process.env.MFA_ENCRYPTION_KEY = 'chave-de-producao-valida-com-32-caracteres-ou-mais';
    assert.doesNotThrow(() => validateAuthRuntimeConfig(), 'produção com uma chave válida (>=32 caracteres) deve aceitar a configuração normalmente');

    process.env.NODE_ENV = 'test';
    delete process.env.MFA_ENCRYPTION_KEY;
    assert.doesNotThrow(() => validateAuthRuntimeConfig(), 'fora de produção, a ausência da chave nunca impede o boot/carregamento do módulo');
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalKey === undefined) delete process.env.MFA_ENCRYPTION_KEY; else process.env.MFA_ENCRYPTION_KEY = originalKey;
    if (originalRateLimitKey === undefined) delete process.env.RATE_LIMIT_HMAC_KEY; else process.env.RATE_LIMIT_HMAC_KEY = originalRateLimitKey;
  }
});
test('RATE_LIMIT_HMAC_KEY (H3, docs/DECISIONS.md PROD-H3-01): fail-fast em produção, degradação graciosa fora dela', () => {
  const { validateAuthRuntimeConfig } = require('../server');
  const originalEnv = process.env.NODE_ENV;
  const originalKey = process.env.RATE_LIMIT_HMAC_KEY;
  // Mesma disciplina do teste irmão acima: fixa MFA_ENCRYPTION_KEY com um valor válido para isolar
  // especificamente o comportamento de RATE_LIMIT_HMAC_KEY.
  const originalMfaKey = process.env.MFA_ENCRYPTION_KEY;
  try {
    process.env.NODE_ENV = 'production';
    process.env.MFA_ENCRYPTION_KEY = 'chave-de-producao-valida-com-32-caracteres-ou-mais';
    delete process.env.RATE_LIMIT_HMAC_KEY;
    assert.throws(() => validateAuthRuntimeConfig(), /RATE_LIMIT_HMAC_KEY/, 'produção sem a chave deve falhar explicitamente antes de escutar a porta');

    process.env.RATE_LIMIT_HMAC_KEY = 'curta-demais';
    assert.throws(() => validateAuthRuntimeConfig(), /RATE_LIMIT_HMAC_KEY/, 'produção com chave curta (<32 caracteres) deve falhar explicitamente, igual à ausência');

    process.env.RATE_LIMIT_HMAC_KEY = 'chave-de-producao-valida-com-32-caracteres-ou-mais';
    assert.doesNotThrow(() => validateAuthRuntimeConfig(), 'produção com uma chave válida (>=32 caracteres) deve aceitar a configuração normalmente');

    process.env.NODE_ENV = 'test';
    delete process.env.RATE_LIMIT_HMAC_KEY;
    assert.doesNotThrow(() => validateAuthRuntimeConfig(), 'fora de produção, a ausência da chave nunca impede o boot/carregamento do módulo');
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalKey === undefined) delete process.env.RATE_LIMIT_HMAC_KEY; else process.env.RATE_LIMIT_HMAC_KEY = originalKey;
    if (originalMfaKey === undefined) delete process.env.MFA_ENCRYPTION_KEY; else process.env.MFA_ENCRYPTION_KEY = originalMfaKey;
  }
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

// ============================================================================================
// Sprint 2, Fase 2 — testes unitários (views/consumo canônico de Legal Deadline)
// ============================================================================================

test('dashboard-service.js não contém mais processDate()/coluna bruta como fonte de prazo jurídico', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard-service.js'), 'utf8');
  assert.ok(!/function processDate/.test(source), 'a função processDate() (DATA/CITAÇÃO como prazo) foi removida nesta Fase 2');
  assert.ok(!/columnsByTitle\?\.\[.CITA/.test(source), 'nenhum widget deve mais ler CITAÇÃO/PROTOCOLO diretamente como prazo');
});

function buildLegalDashboardStore(deadlines, processOverrides = {}) {
  return {
    records: {
      processos: [{ id: 'proc-1', source: 'monday', department: 'Jurídico', deletedAt: null, columnsByTitle: { DATA: '2026-09-01', 'CITAÇÃO/PROTOCOLO': '2026-09-02' }, ...processOverrides }],
      legalDeadlines: deadlines
    },
    departments: []
  };
}
const legalDashboardUser = { role: 'lider', department: 'Jurídico' };
const legalDashboardDeps = { scoped, isLegalDeadlineOverdue, civilDateAfterDays };

test('dashboard "legal": processo com DATA/CITAÇÃO mas sem nenhum Legal Deadline não gera prazo fictício (regressão obrigatória da Fase 2)', () => {
  const store = buildLegalDashboardStore([]);
  const payload = dashboardPayload(store, 'legal', {}, legalDashboardUser, legalDashboardDeps);
  assert.equal(payload.widgets['legal-deadlines'].state, 'empty', 'sem Legal Deadline cadastrado, o widget de prazo fica vazio — nunca inventa prazo a partir de DATA/CITAÇÃO');
  assert.deepEqual(payload.widgets['legal-risk'].data[0], { label: 'Prazos vencidos', value: 0 });
  assert.deepEqual(payload.widgets['legal-risk'].data[1], { label: 'Prazos críticos (30 dias)', value: 0 });
});

test('dashboard "legal": widget de prazo consome legalDeadlines — ativo+data passada é vencido, ativo+data de hoje não é', () => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const store = buildLegalDashboardStore([
    { id: 'ld-vencido', processId: 'proc-1', origin: 'Prazo vencido', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' },
    { id: 'ld-hoje', processId: 'proc-1', origin: 'Prazo de hoje', date: today, originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' }
  ]);
  const payload = dashboardPayload(store, 'legal', {}, legalDashboardUser, legalDashboardDeps);
  assert.equal(payload.widgets['legal-risk'].data[0].value, 1, 'apenas o prazo com data passada conta como vencido');
  const titles = payload.widgets['legal-deadlines'].data.map(row => row.title);
  assert.ok(titles.includes('Prazo vencido') && titles.includes('Prazo de hoje'), 'ambos os prazos ativos aparecem no widget, vindos de legalDeadlines');
  const vencidoRow = payload.widgets['legal-deadlines'].data.find(row => row.title === 'Prazo vencido');
  assert.equal(vencidoRow.overdue, true);
  const hojeRow = payload.widgets['legal-deadlines'].data.find(row => row.title === 'Prazo de hoje');
  assert.equal(hojeRow.overdue, false, 'prazo com data de hoje ainda não é atraso — só vence após o fim da data civil');
});

test('dashboard "legal": suspenso/cumprido/cancelado com data passada nunca aparecem como vencidos', () => {
  const store = buildLegalDashboardStore([
    { id: 'ld-suspenso', processId: 'proc-1', origin: 'Suspenso', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'suspenso', department: 'Jurídico' },
    { id: 'ld-cumprido', processId: 'proc-1', origin: 'Cumprido', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'cumprido', department: 'Jurídico' },
    { id: 'ld-cancelado', processId: 'proc-1', origin: 'Cancelado', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'cancelado', department: 'Jurídico' }
  ]);
  const payload = dashboardPayload(store, 'legal', {}, legalDashboardUser, legalDashboardDeps);
  assert.equal(payload.widgets['legal-risk'].data[0].value, 0, 'nenhum dos três status entra na contagem de vencidos');
  assert.equal(payload.widgets['legal-deadlines'].state, 'empty', 'suspenso/cumprido/cancelado não aparecem como prazo ativo/crítico/vencido no widget');
});

test('dashboard "legal": INTERNAL_CONTROL nunca é rotulado como prazo processual (não entra em legal-risk/legal-deadlines)', () => {
  const store = buildLegalDashboardStore([
    { id: 'ld-interno', processId: 'proc-1', origin: 'Controle interno vencido', date: '2020-01-01', originType: 'INTERNAL_CONTROL', status: 'ativo', department: 'Jurídico' }
  ]);
  const payload = dashboardPayload(store, 'legal', {}, legalDashboardUser, legalDashboardDeps);
  assert.equal(payload.widgets['legal-risk'].data[0].value, 0, 'INTERNAL_CONTROL não é somado a "Prazos vencidos" (rótulo de prazo processual)');
  assert.equal(payload.widgets['legal-deadlines'].state, 'empty', 'INTERNAL_CONTROL não aparece no widget de "Próximos prazos" jurídico-processual');
});

test('dashboard "legal": JUDICIAL_PROCESSUAL aparece corretamente e múltiplos Legal Deadlines do mesmo processo coexistem sem se substituir', () => {
  const store = buildLegalDashboardStore([
    { id: 'ld-1', processId: 'proc-1', origin: 'Primeira intimação', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' },
    { id: 'ld-2', processId: 'proc-1', origin: 'Segunda intimação (fato gerador distinto)', date: '2020-02-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' }
  ]);
  const payload = dashboardPayload(store, 'legal', {}, legalDashboardUser, legalDashboardDeps);
  assert.equal(payload.widgets['legal-risk'].data[0].value, 2, 'os dois prazos do mesmo processo contam separadamente — um novo prazo não substitui o anterior');
  const titles = payload.widgets['legal-deadlines'].data.map(row => row.title);
  assert.ok(titles.includes('Primeira intimação') && titles.includes('Segunda intimação (fato gerador distinto)'));
});

// P1 corrigido (revisão do PR #5): as CONTAGENS agregadas do dashboard 'legal' (active-processes,
// "A classificar", legal-quality, legal-attention) não passavam por scoped() — só os registros
// individuais de Legal Deadline tinham essa defesa em profundidade. Um usuário Jurídico com companyId
// próprio podia ver contagens somando processos/pastas de outra empresa.
function buildCompanyScopedStore() {
  return {
    records: {
      processos: [
        { id: 'proc-empresa-a', source: 'monday', department: 'Jurídico', companyId: 'empresa-a', deletedAt: null },
        { id: 'proc-empresa-b', source: 'monday', department: 'Jurídico', companyId: 'empresa-b', deletedAt: null }
      ],
      legalDeadlines: [
        { id: 'ld-empresa-a', processId: 'proc-empresa-a', origin: 'Prazo empresa A', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico', companyId: 'empresa-a' },
        { id: 'ld-empresa-b', processId: 'proc-empresa-b', origin: 'Prazo empresa B', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico', companyId: 'empresa-b' }
      ],
      notificacoes: [
        { id: 'not-empresa-a', department: 'Jurídico', companyId: 'empresa-a', deletedAt: null },
        { id: 'not-empresa-b', department: 'Jurídico', companyId: 'empresa-b', deletedAt: null }
      ]
    },
    departments: []
  };
}

test('dashboard "legal": active-processes/"A classificar"/legal-quality/legal-attention respeitam scoped() por companyId — usuário da empresa A não vê contagens da empresa B', () => {
  const store = buildCompanyScopedStore();
  const userEmpresaA = { role: 'lider', department: 'Jurídico', companyId: 'empresa-a' };
  const payload = dashboardPayload(store, 'legal', {}, userEmpresaA, legalDashboardDeps);

  assert.equal(payload.widgets['active-processes'].data.value, 1, 'active-processes só conta o processo da empresa A');
  const classificar = payload.widgets['legal-risk'].data.find(row => row.label === 'A classificar');
  assert.equal(classificar.value, 1, '"A classificar" também respeita companyId, não soma o processo da empresa B');
  assert.equal(payload.widgets['legal-quality'].data.total, 1, 'legal-quality calcula apenas sobre processos visíveis (empresa A)');
  const notificacoes = payload.widgets['legal-attention'].data.find(row => row.target === 'notificacoes');
  assert.equal(notificacoes.value, 1, 'legal-attention não soma o registro de notificacoes da empresa B');
  assert.equal(payload.widgets['legal-risk'].data[0].value, 1, 'Legal Deadline da empresa B continua ausente da contagem de vencidos (regressão já coberta, reforçada aqui)');
});

test('dashboard "legal": diretoria (alçada global) continua vendo o consolidado de todas as empresas, sem tratamento especial manual', () => {
  const store = buildCompanyScopedStore();
  const diretoria = { role: 'diretoria', department: null };
  const payload = dashboardPayload(store, 'legal', {}, diretoria, legalDashboardDeps);

  assert.equal(payload.widgets['active-processes'].data.value, 2, 'diretoria vê os processos das empresas A e B consolidados');
  const notificacoes = payload.widgets['legal-attention'].data.find(row => row.target === 'notificacoes');
  assert.equal(notificacoes.value, 2, 'legal-attention soma as duas empresas para quem tem alçada global');
  assert.equal(payload.widgets['legal-risk'].data[0].value, 2, 'ambos os Legal Deadlines (empresa A e B) contam para diretoria');
});

test('dashboard "legal": deny-by-default também por speId — usuário com speId próprio não vê contagens de outra SPE', () => {
  const store = {
    records: {
      processos: [
        { id: 'proc-spe-x', source: 'monday', department: 'Jurídico', speId: 'spe-x', deletedAt: null },
        { id: 'proc-spe-y', source: 'monday', department: 'Jurídico', speId: 'spe-y', deletedAt: null }
      ],
      legalDeadlines: [],
      notificacoes: []
    },
    departments: []
  };
  const userSpeX = { role: 'lider', department: 'Jurídico', speId: 'spe-x' };
  const payload = dashboardPayload(store, 'legal', {}, userSpeX, legalDashboardDeps);
  assert.equal(payload.widgets['active-processes'].data.value, 1, 'usuário da SPE X não conta o processo da SPE Y em active-processes');
});

test('legalDeadlineIntegrityFlag() sinaliza registros legados sem originType/status para revisão, sem inferir nada', () => {
  assert.equal(legalDeadlineIntegrityFlag({ originType: 'JUDICIAL_PROCESSUAL', status: 'ativo' }), 'ok');
  assert.equal(legalDeadlineIntegrityFlag({ originType: 'JUDICIAL_PROCESSUAL' }), 'requires_review', 'status ausente (registro legado pré-D1) exige revisão manual');
  assert.equal(legalDeadlineIntegrityFlag({ status: 'ativo' }), 'requires_review', 'originType ausente (registro legado pré-D1) exige revisão manual');
  assert.equal(legalDeadlineIntegrityFlag({}), 'requires_review');
  assert.equal(legalDeadlineIntegrityFlag(null), 'requires_review');
});

test('civilDateAfterDays() retorna uma data civil futura no formato YYYY-MM-DD, sem depender de UTC', () => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const in30 = civilDateAfterDays(30);
  assert.match(in30, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(in30 > today, 'a data 30 dias à frente deve ser posterior à data civil de hoje');
});

test('filterLegalDeadlines() filtra por processId/originType/status/overdue/dateFrom/dateTo e pagina com o mesmo padrão de filterProcesses/filterHonorariums', () => {
  const rows = [
    { id: 'ld-1', processId: 'proc-1', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', date: '2020-01-01' },
    { id: 'ld-2', processId: 'proc-1', originType: 'INTERNAL_CONTROL', status: 'ativo', date: '2027-01-01' },
    { id: 'ld-3', processId: 'proc-2', originType: 'JUDICIAL_PROCESSUAL', status: 'suspenso', date: '2020-06-01' }
  ];
  const byProcess = filterLegalDeadlines(rows, new URL('http://x/?processId=proc-1'));
  assert.equal(byProcess.count, 2);
  const byOriginType = filterLegalDeadlines(rows, new URL('http://x/?originType=INTERNAL_CONTROL'));
  assert.equal(byOriginType.count, 1);
  assert.equal(byOriginType.records[0].id, 'ld-2');
  const byStatus = filterLegalDeadlines(rows, new URL('http://x/?status=suspenso'));
  assert.equal(byStatus.count, 1);
  assert.equal(byStatus.records[0].id, 'ld-3');
  const overdueTrue = filterLegalDeadlines(rows, new URL('http://x/?overdue=true'));
  assert.equal(overdueTrue.count, 1, 'apenas ld-1 (ativo + data passada) é vencido — ld-3 é suspenso, nunca conta como vencido');
  assert.equal(overdueTrue.records[0].id, 'ld-1');
  const byDateRange = filterLegalDeadlines(rows, new URL('http://x/?dateFrom=2020-01-01&dateTo=2020-12-31'));
  assert.equal(byDateRange.count, 2);
  const paginated = filterLegalDeadlines(rows, new URL('http://x/?pageSize=25&page=1'));
  assert.equal(paginated.pagination.pageSize, 25, 'apenas 25/50/100 são pageSize válidos, mesmo padrão de filterProcesses/filterHonorariums');
  assert.equal(paginated.pagination.totalPages, 1);
  assert.equal(paginated.records.length, 3);
  assert.equal(paginated.totalAvailable, 3);
  assert.ok('dataIntegrity' in paginated.records[0], 'cada registro paginado inclui o campo de integridade calculado (dataIntegrity)');
});

// ============================================================================================
// Sprint 2, Fase 3 — testes unitários (Agenda/Atenção mínima, Legal Deadline como fonte canônica)
// ============================================================================================

function buildAgendaStore(deadlines, agendaEvents = [], processOverrides = {}) {
  return {
    records: {
      processos: [{ id: 'proc-1', source: 'monday', department: 'Jurídico', deletedAt: null, ...processOverrides }],
      legalDeadlines: deadlines
    },
    agenda: agendaEvents,
    audit: []
  };
}
const agendaUser = { role: 'lider', department: 'Jurídico' };

test('legalDeadlineAgendaItems(): Legal Deadline ativo futuro aparece na Agenda com entityType/entityId/target corretos', () => {
  const future = civilDateAfterDays(10);
  const store = buildAgendaStore([{ id: 'ld-futuro', processId: 'proc-1', origin: 'Prazo futuro', date: future, originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' }]);
  const items = legalDeadlineAgendaItems(store, agendaUser);
  assert.equal(items.length, 1);
  assert.equal(items[0].entityType, 'legalDeadline');
  assert.equal(items[0].entityId, 'ld-futuro');
  assert.equal(items[0].date, future);
  assert.equal(items[0].overdue, false);
  assert.equal(items[0].target, '/api/entities/legalDeadlines/ld-futuro/detail', 'item referencia o detalhe canônico já existente, não uma cópia');
  assert.equal(items[0].process.id, 'proc-1', 'item referencia o processo relacionado, sem duplicar seus dados');
});

test('legalDeadlineAttentionItems(): vencido entra como OVERDUE; suspenso/cumprido/cancelado nunca entram como overdue mesmo com data passada', () => {
  const store = buildAgendaStore([
    { id: 'ld-vencido', processId: 'proc-1', origin: 'Vencido', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' },
    { id: 'ld-suspenso', processId: 'proc-1', origin: 'Suspenso', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'suspenso', department: 'Jurídico' },
    { id: 'ld-cumprido', processId: 'proc-1', origin: 'Cumprido', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'cumprido', department: 'Jurídico' },
    { id: 'ld-cancelado', processId: 'proc-1', origin: 'Cancelado', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', status: 'cancelado', department: 'Jurídico' }
  ]);
  const items = legalDeadlineAttentionItems(store, agendaUser);
  assert.deepEqual(items.map(i => i.entityId), ['ld-vencido'], 'somente o prazo ativo+vencido entra em Atenção; suspenso/cumprido/cancelado nunca contam como overdue');
  assert.equal(items[0].category, 'OVERDUE');

  // Sprint 2, Fase 4B (D4.15 homologada): suspenso/cumprido/cancelado ficam fora da Agenda operacional
  // por padrão — a flag `overdue` deles só é observável passando includeInactive:true explicitamente.
  const agendaItems = legalDeadlineAgendaItems(store, agendaUser, { includeInactive: true });
  const overdueFlags = Object.fromEntries(agendaItems.map(i => [i.entityId, i.overdue]));
  assert.equal(overdueFlags['ld-vencido'], true);
  assert.equal(overdueFlags['ld-suspenso'], false);
  assert.equal(overdueFlags['ld-cumprido'], false);
  assert.equal(overdueFlags['ld-cancelado'], false);

  const defaultAgendaItems = legalDeadlineAgendaItems(store, agendaUser);
  assert.deepEqual(defaultAgendaItems.map(i => i.entityId), ['ld-vencido'], 'por padrão (sem includeInactive), a Agenda operacional só mostra o prazo ativo/vencido — D4.15');
});

test('legalDeadlineAttentionItems(): próximo dentro da janela de 30 dias entra como UPCOMING, reutilizando civilDateAfterDays()', () => {
  const soon = civilDateAfterDays(10);
  const far = civilDateAfterDays(90);
  const store = buildAgendaStore([
    { id: 'ld-proximo', processId: 'proc-1', origin: 'Próximo', date: soon, originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' },
    { id: 'ld-distante', processId: 'proc-1', origin: 'Distante', date: far, originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' }
  ]);
  const items = legalDeadlineAttentionItems(store, agendaUser);
  assert.deepEqual(items.map(i => i.entityId), ['ld-proximo']);
  assert.equal(items[0].category, 'UPCOMING');
});

test('legalDeadlineAttentionItems(): registro legado (dataIntegrity=requires_review) aparece como REQUIRES_REVIEW, sem inferir originType/status', () => {
  const store = buildAgendaStore([
    { id: 'ld-legado', processId: 'proc-1', origin: 'Registro legado', date: '2020-01-01', department: 'Jurídico' }
  ]);
  const items = legalDeadlineAttentionItems(store, agendaUser);
  assert.equal(items.length, 1);
  assert.equal(items[0].category, 'REQUIRES_REVIEW');
  assert.equal(items[0].originType, undefined, 'nenhum originType foi inferido/preenchido para o registro legado');
});

test('legalDeadlineAgendaItems(): JUDICIAL_PROCESSUAL e INTERNAL_CONTROL são identificados corretamente pelo campo originType', () => {
  const store = buildAgendaStore([
    { id: 'ld-judicial', processId: 'proc-1', origin: 'Processual', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' },
    { id: 'ld-interno', processId: 'proc-1', origin: 'Controle interno', date: '2026-12-01', originType: 'INTERNAL_CONTROL', status: 'ativo', department: 'Jurídico' }
  ]);
  const items = legalDeadlineAgendaItems(store, agendaUser);
  const byId = Object.fromEntries(items.map(i => [i.entityId, i.originType]));
  assert.equal(byId['ld-judicial'], 'JUDICIAL_PROCESSUAL');
  assert.equal(byId['ld-interno'], 'INTERNAL_CONTROL', 'INTERNAL_CONTROL é preservado tal como está, nunca rotulado/convertido em prazo processual pela view');
});

test('legalDeadlineAgendaItems(): processo sem Legal Deadline não gera item; DATA/CITAÇÃO do processo nunca viram prazo (regressão obrigatória)', () => {
  const store = buildAgendaStore([], [], { columnsByTitle: { DATA: '2026-09-01', 'CITAÇÃO/PROTOCOLO': '2026-09-02' } });
  const items = legalDeadlineAgendaItems(store, agendaUser);
  assert.deepEqual(items, [], 'processo sem nenhum Legal Deadline não produz item de prazo, mesmo tendo DATA/CITAÇÃO no board Monday');
  const attention = legalDeadlineAttentionItems(store, agendaUser);
  assert.deepEqual(attention, []);
});

test('legalDeadlineAgendaItems(): múltiplos Legal Deadlines do mesmo processo geram itens distintos, sem substituição', () => {
  const store = buildAgendaStore([
    { id: 'ld-1', processId: 'proc-1', origin: 'Primeira intimação', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' },
    { id: 'ld-2', processId: 'proc-1', origin: 'Segunda intimação', date: '2026-12-15', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' }
  ]);
  const items = legalDeadlineAgendaItems(store, agendaUser);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => i.entityId).sort(), ['ld-1', 'ld-2']);
});

test('legalDeadlineAgendaItems() reflete alteração do Legal Deadline sem duplicata persistida — Agenda é view, não source of truth', () => {
  const deadline = { id: 'ld-mutavel', processId: 'proc-1', origin: 'Prazo mutável', date: '2026-09-20', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico', version: 1 };
  const store = buildAgendaStore([deadline]);
  const before = legalDeadlineAgendaItems(store, agendaUser);
  assert.equal(before[0].date, '2026-09-20');

  // Simula um PATCH real: o mesmo registro é mutado in-place (mesmo id/version incrementada) — não um
  // novo registro criado por baixo, exatamente como o PATCH real de /api/entities/legalDeadlines faz.
  deadline.date = '2026-09-25';
  deadline.version = 2;
  const after = legalDeadlineAgendaItems(store, agendaUser);
  assert.equal(after.length, 1, 'nenhum segundo item é criado pela mudança — a view apenas reflete o estado atual');
  assert.equal(after[0].date, '2026-09-25');
  assert.equal(after[0].entityId, 'ld-mutavel', 'mesmo id — não é um registro novo');
  assert.equal(store.records.legalDeadlines.length, 1, 'apenas 1 Legal Deadline persistido, antes e depois da alteração');
});

test('sortAgendaItems(): ordenação determinística por date → entityType → entityId', () => {
  const items = [
    { entityType: 'legalDeadline', entityId: 'z-later', date: '2026-01-02' },
    { entityType: 'agendaEvent', entityId: 'b', date: '2026-01-01' },
    { entityType: 'legalDeadline', entityId: 'a', date: '2026-01-01' },
    { entityType: 'agendaEvent', entityId: 'a', date: '2026-01-01' }
  ];
  const sorted = sortAgendaItems(items);
  assert.deepEqual(sorted.map(i => `${i.date}|${i.entityType}|${i.entityId}`), [
    '2026-01-01|agendaEvent|a',
    '2026-01-01|agendaEvent|b',
    '2026-01-01|legalDeadline|a',
    '2026-01-02|legalDeadline|z-later'
  ], 'mesma data ordena por entityType, depois por entityId — critério estável e previsível');
});

test('itens de Agenda/Atenção sempre contêm entityType/entityId; nenhuma cópia de Legal Deadline é persistida em store.records', () => {
  const store = buildAgendaStore([
    { id: 'ld-1', processId: 'proc-1', origin: 'Prazo', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' }
  ], [
    { id: 'evt-1', title: 'Reunião', department: 'Jurídico', date: '2026-12-02' }
  ]);
  const keysBefore = Object.keys(store.records).sort();
  const agendaItems = legalDeadlineAgendaItems(store, agendaUser);
  const eventItems = agendaEventItems(store, agendaUser);
  const attentionItems = legalDeadlineAttentionItems(store, agendaUser);
  for (const item of [...agendaItems, ...eventItems]) {
    assert.ok('entityType' in item && 'entityId' in item, 'todo item de Agenda/Atenção deve referenciar entityType/entityId da entidade canônica');
  }
  const keysAfter = Object.keys(store.records).sort();
  assert.deepEqual(keysAfter, keysBefore, 'nenhuma nova coleção (agendaDeadline/agendaLegalDeadline/copiedDeadline/deadlineSnapshot ou equivalente) foi criada em store.records');
  assert.equal(store.records.legalDeadlines.length, 1, 'nenhuma duplicata de Legal Deadline foi persistida ao montar as views');
});

// ============================================================================================
// Sprint 2, Fase 4B — testes unitários (responsibleUserId, Minha Semana, D4.15, Calendar adapter)
// ============================================================================================

const responsibleUser = { role: 'lider', department: 'Jurídico' };
function buildResponsibleStore(users, deadlines = [], processOverrides = {}) {
  return {
    records: { processos: [{ id: 'proc-1', source: 'monday', department: 'Jurídico', deletedAt: null, ...processOverrides }], legalDeadlines: deadlines },
    users,
    agenda: [],
    audit: []
  };
}
function baseDeadlineCandidate(overrides = {}) {
  return { processId: 'proc-1', origin: 'Prazo', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', ...overrides };
}

test('validateLegalDeadline(): responsibleUserId ausente permanece válido (campo opcional)', () => {
  const store = buildResponsibleStore([]);
  const result = validateLegalDeadline(baseDeadlineCandidate(), responsibleUser, store);
  assert.equal(result, null);
});

test('validateLegalDeadline(): responsibleUserId de usuário existente, ativo e com acesso ao processo relacionado é aceito', () => {
  const store = buildResponsibleStore([{ id: 'usr-1', name: 'Fulano', role: 'colaborador', department: 'Jurídico', deletedAt: null }]);
  const result = validateLegalDeadline(baseDeadlineCandidate({ responsibleUserId: 'usr-1' }), responsibleUser, store);
  assert.equal(result, null);
});

test('validateLegalDeadline(): NOVA atribuição a usuário que NÃO tem acesso ao processo relacionado (department diferente) é rejeitada (P1.1)', () => {
  const store = buildResponsibleStore([{ id: 'usr-ti', name: 'Líder TI', role: 'lider', department: 'TI', deletedAt: null }]);
  const result = validateLegalDeadline(baseDeadlineCandidate({ responsibleUserId: 'usr-ti' }), responsibleUser, store, null);
  assert.equal(result.status, 403);
});

test('validateLegalDeadline(): NOVA atribuição a administrador técnico (sem alçada de conteúdo jurídico) é rejeitada (P1.1)', () => {
  const store = buildResponsibleStore([{ id: 'usr-admin', name: 'Administrador Técnico', role: 'administrador', department: null, deletedAt: null }]);
  const result = validateLegalDeadline(baseDeadlineCandidate({ responsibleUserId: 'usr-admin' }), responsibleUser, store, null);
  assert.equal(result.status, 403, 'administrador técnico não pode ser responsável — technical admin != content superuser');
});

test('validateLegalDeadline(): NOVA atribuição a usuário de companyId diferente do processo relacionado é rejeitada (P1.1)', () => {
  const store = buildResponsibleStore(
    [{ id: 'usr-empresa-a', name: 'Fulano Empresa A', role: 'colaborador', department: 'Jurídico', companyId: 'empresa-a', deletedAt: null }],
    [],
    { companyId: 'empresa-b', scopeType: 'company' }
  );
  const result = validateLegalDeadline(baseDeadlineCandidate({ responsibleUserId: 'usr-empresa-a' }), responsibleUser, store, null);
  assert.equal(result.status, 403);
});

test('validateLegalDeadline(): atribuição já existente (mesmo previousResponsibleUserId) não é revalidada quanto a acesso — só a NOVA atribuição é checada', () => {
  const store = buildResponsibleStore([{ id: 'usr-ti', name: 'Líder TI', role: 'lider', department: 'TI', deletedAt: null }]);
  const result = validateLegalDeadline(baseDeadlineCandidate({ responsibleUserId: 'usr-ti' }), responsibleUser, store, 'usr-ti');
  assert.equal(result, null, 'reenviar o MESMO responsável já atribuído (sem mudança) não é tratado como nova atribuição');
});

test('validateLegalDeadline(): responsibleUserId de usuário inexistente é rejeitado', () => {
  const store = buildResponsibleStore([{ id: 'usr-1', name: 'Fulano', deletedAt: null }]);
  const result = validateLegalDeadline(baseDeadlineCandidate({ responsibleUserId: 'usr-inexistente' }), responsibleUser, store);
  assert.equal(result.status, 422);
});

test('validateLegalDeadline(): NOVA atribuição a usuário inativo (deletedAt) é rejeitada', () => {
  const store = buildResponsibleStore([{ id: 'usr-inativo', name: 'Inativo', deletedAt: '2026-01-01T00:00:00.000Z' }]);
  const result = validateLegalDeadline(baseDeadlineCandidate({ responsibleUserId: 'usr-inativo' }), responsibleUser, store, null);
  assert.equal(result.status, 422);
});

test('validateLegalDeadline(): campo textual responsible/responsibleName/ownerName nunca substitui responsibleUserId', () => {
  const store = buildResponsibleStore([]);
  const candidate = baseDeadlineCandidate({ responsible: 'Fulano de Tal', responsibleName: 'Fulano', ownerName: 'Fulano' });
  const result = validateLegalDeadline(candidate, responsibleUser, store);
  assert.equal(result, null, 'nenhum desses campos textuais é validado como responsável — responsibleUserId continua undefined');
  assert.equal(candidate.responsibleUserId, undefined);
});

test('validateLegalDeadline(): responsável do Legal Deadline pode ser diferente do responsável do processo (não há herança nem restrição cruzada)', () => {
  const store = buildResponsibleStore([{ id: 'usr-1', name: 'Fulano', role: 'colaborador', department: 'Jurídico', deletedAt: null }], [], { responsibleUserId: 'usr-outro' });
  const result = validateLegalDeadline(baseDeadlineCandidate({ responsibleUserId: 'usr-1' }), responsibleUser, store);
  assert.equal(result, null);
});

test('validateLegalDeadline(): responsibleUserId nunca é inferido automaticamente — omitido na criação permanece omitido', () => {
  const store = buildResponsibleStore([{ id: 'usr-1', name: 'Fulano', deletedAt: null }]);
  const candidate = baseDeadlineCandidate();
  validateLegalDeadline(candidate, responsibleUser, store);
  assert.equal(candidate.responsibleUserId, undefined, 'nada preenche responsibleUserId a partir do criador/processo/departamento');
});

test('validateLegalDeadline(): usuário responsável que SE TORNA inativo depois não invalida revalidações futuras do mesmo Legal Deadline (D4.11 — histórico nunca apagado)', () => {
  const store = buildResponsibleStore([{ id: 'usr-1', name: 'Fulano', deletedAt: '2026-02-01T00:00:00.000Z' }]);
  const candidate = baseDeadlineCandidate({ responsibleUserId: 'usr-1' });
  const result = validateLegalDeadline(candidate, responsibleUser, store, 'usr-1');
  assert.equal(result, null, 'mesma atribuição (previousResponsibleUserId === responsibleUserId) não é bloqueada mesmo com o usuário já inativo');
});

test('responsibleInfo(): sinaliza responsibleInactive quando o usuário responsável está com deletedAt, sem apagar responsibleUserId', () => {
  const store = buildResponsibleStore([{ id: 'usr-1', name: 'Fulano', deletedAt: '2026-02-01T00:00:00.000Z' }]);
  const info = responsibleInfo(store, { responsibleUserId: 'usr-1' });
  assert.equal(info.responsibleUserId, 'usr-1');
  assert.equal(info.responsibleInactive, true);
});

test('responsibleInfo(): sem responsibleUserId retorna responsibleInactive false e responsibleUserId null', () => {
  const store = buildResponsibleStore([]);
  assert.deepEqual(responsibleInfo(store, {}), { responsibleUserId: null, responsibleInactive: false });
});

test('responsibleUserId não amplia scoped() — legalDeadlineAgendaItems() de outra empresa continua fora de escopo mesmo sendo o responsável', () => {
  const store = buildResponsibleStore(
    [{ id: 'usr-1', name: 'Fulano', deletedAt: null }],
    [{ id: 'ld-fora', processId: 'proc-2', origin: 'Fora de escopo', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', responsibleUserId: 'usr-1', companyId: 'empresa-B', scopeType: 'company' }],
    {}
  );
  store.records.processos.push({ id: 'proc-2', source: 'monday', companyId: 'empresa-B', scopeType: 'company', deletedAt: null });
  const scopedUser = { id: 'usr-1', role: 'colaborador', department: 'Jurídico', companyId: 'empresa-A', scopeType: 'company' };
  const items = legalDeadlineAgendaItems(store, scopedUser);
  assert.deepEqual(items, [], 'responsibleUserId === usr-1 não basta — scoped() por companyId continua bloqueando o registro de outra empresa');
});

test('isOperationallyVisible(): cumprido/cancelado/suspenso não são visíveis por padrão; ativo e demais status permanecem', () => {
  assert.equal(isOperationallyVisible('ativo'), true);
  assert.equal(isOperationallyVisible('cumprido'), false);
  assert.equal(isOperationallyVisible('cancelado'), false);
  assert.equal(isOperationallyVisible('suspenso'), false);
  assert.equal(isOperationallyVisible(undefined), true, 'registro legado sem status não é escondido pela D4.15 — apenas os 3 status fechados são');
});

test('D4.15: legalDeadlineAgendaItems() não mostra cumprido/cancelado/suspenso por padrão; includeInactive=true devolve todos, sem apagar/alterar nenhum registro', () => {
  const store = buildAgendaStore([
    { id: 'ld-ativo', processId: 'proc-1', origin: 'Ativo', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', department: 'Jurídico' },
    { id: 'ld-cumprido', processId: 'proc-1', origin: 'Cumprido', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'cumprido', department: 'Jurídico' },
    { id: 'ld-cancelado', processId: 'proc-1', origin: 'Cancelado', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'cancelado', department: 'Jurídico' },
    { id: 'ld-suspenso', processId: 'proc-1', origin: 'Suspenso', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'suspenso', department: 'Jurídico' }
  ]);
  const defaultItems = legalDeadlineAgendaItems(store, agendaUser);
  assert.deepEqual(defaultItems.map(i => i.entityId), ['ld-ativo']);
  const allItems = legalDeadlineAgendaItems(store, agendaUser, { includeInactive: true });
  assert.deepEqual(allItems.map(i => i.entityId).sort(), ['ld-ativo', 'ld-cancelado', 'ld-cumprido', 'ld-suspenso']);
  assert.equal(store.records.legalDeadlines.length, 4, 'nenhum registro foi removido/alterado ao filtrar a view');
});

test('civilWeekWindow(): segunda pertence à própria semana; domingo seguinte não entra; fuso America/Sao_Paulo', () => {
  const monday = civilWeekWindow('2026-09-14');
  assert.equal(monday.start, '2026-09-14');
  assert.equal(monday.end, '2026-09-20');
  const sunday = civilWeekWindow('2026-09-20');
  assert.equal(sunday.start, '2026-09-14', 'domingo pertence à MESMA semana civil corrente (segunda a domingo), não à semana seguinte');
  assert.equal(sunday.end, '2026-09-20');
  const nextMonday = civilWeekWindow('2026-09-21');
  assert.equal(nextMonday.start, '2026-09-21', 'segunda seguinte inicia uma nova janela — não é "próximos 7 dias corridos" a partir de qualquer data');
});

test('myWeekLegalDeadlineItems(): Legal Deadline do usuário logado, dentro da semana civil corrente, aparece; de outro usuário não aparece', () => {
  const window = civilWeekWindow();
  const store = buildResponsibleStore(
    [{ id: 'usr-1', name: 'Fulano', deletedAt: null }, { id: 'usr-2', name: 'Ciclano', deletedAt: null }],
    [
      { id: 'ld-meu', processId: 'proc-1', origin: 'Meu prazo', date: window.start, originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', responsibleUserId: 'usr-1', department: 'Jurídico' },
      { id: 'ld-outro', processId: 'proc-1', origin: 'De outro usuário', date: window.start, originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', responsibleUserId: 'usr-2', department: 'Jurídico' }
    ]
  );
  const user1 = { id: 'usr-1', role: 'lider', department: 'Jurídico' };
  const items = myWeekLegalDeadlineItems(store, user1);
  assert.deepEqual(items.map(i => i.entityId), ['ld-meu']);
});

test('myWeekLegalDeadlineItems(): item fora da janela (semana anterior/seguinte) não aparece; cumprido/cancelado/suspenso não aparecem; nada é persistido (view pura)', () => {
  const window = civilWeekWindow();
  const store = buildResponsibleStore(
    [{ id: 'usr-1', name: 'Fulano', deletedAt: null }],
    [
      { id: 'ld-nesta-semana', processId: 'proc-1', origin: 'Nesta semana', date: window.start, originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', responsibleUserId: 'usr-1', department: 'Jurídico' },
      { id: 'ld-semana-anterior', processId: 'proc-1', origin: 'Semana anterior', date: '2000-01-03', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', responsibleUserId: 'usr-1', department: 'Jurídico' },
      { id: 'ld-cumprido', processId: 'proc-1', origin: 'Cumprido', date: window.start, originType: 'JUDICIAL_PROCESSUAL', status: 'cumprido', responsibleUserId: 'usr-1', department: 'Jurídico' }
    ]
  );
  const keysBefore = Object.keys(store).sort();
  const user1 = { id: 'usr-1', role: 'lider', department: 'Jurídico' };
  const items = myWeekLegalDeadlineItems(store, user1);
  assert.deepEqual(items.map(i => i.entityId), ['ld-nesta-semana']);
  assert.deepEqual(Object.keys(store).sort(), keysBefore, 'myWeekLegalDeadlineItems() nunca cria uma coleção persistida nova (myWeek/weeklyItems/weekSnapshot ou equivalente)');
});

test('myWeekLegalDeadlineItems(): processo fora de escopo bloqueia o item mesmo com responsibleUserId correto (defesa em profundidade)', () => {
  const window = civilWeekWindow();
  const store = {
    records: {
      processos: [{ id: 'proc-restrito', source: 'monday', deletedAt: null, companyId: 'empresa-B', scopeType: 'company' }],
      legalDeadlines: [{ id: 'ld-bloqueado', processId: 'proc-restrito', origin: 'Bloqueado', date: window.start, originType: 'JUDICIAL_PROCESSUAL', status: 'ativo', responsibleUserId: 'usr-1', companyId: 'empresa-B', scopeType: 'company' }]
    },
    users: [{ id: 'usr-1', name: 'Fulano', deletedAt: null }],
    agenda: [], audit: []
  };
  const user1 = { id: 'usr-1', role: 'colaborador', department: 'Jurídico', companyId: 'empresa-A', scopeType: 'company' };
  assert.deepEqual(myWeekLegalDeadlineItems(store, user1), []);
});

test('googleCalendarStatus()/googleCalendarEvents(): nunca expõem token/segredo; status not_configured sem credenciais de ambiente; eventos vazios (somente leitura, adapter)', () => {
  const status = googleCalendarStatus({ id: 'usr-1' });
  assert.equal(typeof status.configured, 'boolean');
  assert.equal(status.connected, false);
  assert.ok(['not_configured', 'unavailable'].includes(status.status));
  assert.ok(!('token' in status) && !('accessToken' in status) && !('refreshToken' in status));
  const events = googleCalendarEvents({ id: 'usr-1' });
  assert.deepEqual(events.events, [], 'sem integração real ativada nesta fase, nenhum evento é sintetizado/simulado');
});

test('legalDeadlineLabels() (D4.5/D4.6): rótulos em português para originType/status, sem alterar o enum técnico persistido', () => {
  assert.deepEqual(legalDeadlineLabels({ originType: 'JUDICIAL_PROCESSUAL', status: 'ativo' }), { originTypeLabel: 'Prazo processual', statusLabel: 'Ativo' });
  assert.deepEqual(legalDeadlineLabels({ originType: 'INTERNAL_CONTROL', status: 'cumprido' }), { originTypeLabel: 'Controle interno', statusLabel: 'Cumprido' });
  assert.deepEqual(legalDeadlineLabels({ originType: 'INTERNAL_CONTROL', status: 'suspenso' }), { originTypeLabel: 'Controle interno', statusLabel: 'Suspenso' });
  assert.deepEqual(legalDeadlineLabels({ originType: 'JUDICIAL_PROCESSUAL', status: 'cancelado' }), { originTypeLabel: 'Prazo processual', statusLabel: 'Cancelado' });
  assert.deepEqual(legalDeadlineLabels({}), { originTypeLabel: null, statusLabel: null }, 'registro legado sem originType/status não recebe rótulo inventado');
});

test('legalDeadlineConfirmationLabel() (D4.4): "Confirmado pelo Jurídico" nunca aparece para requires_review; aparece para qualquer outro estado válido (INTERNAL_CONTROL, suspenso, cumprido, cancelado, reaberto)', () => {
  assert.equal(legalDeadlineConfirmationLabel('requires_review'), null, 'registro legado/sem originType-status nunca é tratado como confirmado');
  assert.equal(legalDeadlineConfirmationLabel('ok'), 'Confirmado pelo Jurídico');
});

test('D4.15/D4.4: item categorizado como REQUIRES_REVIEW nunca recebe confirmationLabel "Confirmado pelo Jurídico"', () => {
  const store = buildAgendaStore([
    { id: 'ld-legado-confirmacao', processId: 'proc-1', origin: 'Legado', date: '2020-01-01', department: 'Jurídico' }
  ]);
  const items = legalDeadlineAttentionItems(store, agendaUser);
  assert.equal(items[0].category, 'REQUIRES_REVIEW');
  assert.equal(items[0].confirmationLabel, null);
});

test('filterCalendarEventsByWindow() (P1.3, revisão pós-PR #8): evento de segunda entra, domingo entra, domingo seguinte e semana anterior não entram', () => {
  const window = { start: '2026-09-14', end: '2026-09-20' };
  const events = [
    { id: 'evt-segunda', date: '2026-09-14T09:00:00.000Z', start: '09:00' },
    { id: 'evt-domingo', date: '2026-09-20' },
    { id: 'evt-domingo-seguinte', date: '2026-09-21' },
    { id: 'evt-semana-anterior', date: '2026-09-07' },
    { id: 'evt-sem-data' }
  ];
  const filtered = filterCalendarEventsByWindow(events, window);
  assert.deepEqual(filtered.map(e => e.id), ['evt-segunda', 'evt-domingo']);
});

test('filterCalendarEventsByWindow() (P1.3): hora externa, campos start/end e allDay nunca são alterados pelo filtro — só decide inclusão/exclusão', () => {
  const window = { start: '2026-09-14', end: '2026-09-20' };
  const eventoComHora = { id: 'evt-com-hora', date: '2026-09-15T14:30:00.000Z', start: '14:30', end: '15:30', allDay: false, title: 'Reunião externa' };
  const eventoDiaInteiro = { id: 'evt-dia-inteiro', date: '2026-09-16', allDay: true };
  const filtered = filterCalendarEventsByWindow([eventoComHora, eventoDiaInteiro], window);
  assert.deepEqual(filtered, [eventoComHora, eventoDiaInteiro], 'os objetos de evento são preservados exatamente como vieram do adapter — nenhum campo é reescrito');
});

test('canBeResponsibleForLegalDeadline() (P1.1, revisão pós-PR #8): combina allowedContent(juridico,read) + scoped() sobre o candidato e sobre o processo relacionado', () => {
  const candidate = { department: 'Jurídico', companyId: undefined, speId: undefined, scopeType: undefined };
  const relatedProcess = { department: 'Jurídico' };
  assert.equal(canBeResponsibleForLegalDeadline({ role: 'colaborador', department: 'Jurídico' }, candidate, relatedProcess), true, 'colaborador do mesmo departamento pode ser responsável');
  assert.equal(canBeResponsibleForLegalDeadline({ role: 'lider', department: 'TI' }, candidate, relatedProcess), false, 'TI não pode ser responsável por prazo jurídico sem permissão real de conteúdo');
  assert.equal(canBeResponsibleForLegalDeadline({ role: 'administrador', department: null }, candidate, relatedProcess), false, 'administrador técnico não vira content user só por ser indicado responsável');
  assert.equal(canBeResponsibleForLegalDeadline({ role: 'diretoria', department: null }, candidate, relatedProcess), true, 'diretoria (alçada global) é consistentemente elegível, sem regra especial — hasGlobalScope() já cobre isso dentro de scoped()');
});

test('canBeResponsibleForLegalDeadline() (P1.1): companyId/speId diferentes do processo relacionado são rejeitados mesmo com permissão de módulo', () => {
  const candidateEmpresaB = { department: 'Jurídico', companyId: 'empresa-b', scopeType: 'company' };
  const processoEmpresaB = { department: 'Jurídico', companyId: 'empresa-b', scopeType: 'company' };
  assert.equal(canBeResponsibleForLegalDeadline({ role: 'colaborador', department: 'Jurídico', companyId: 'empresa-a' }, candidateEmpresaB, processoEmpresaB), false, 'companyId diferente do processo rejeita');
  assert.equal(canBeResponsibleForLegalDeadline({ role: 'colaborador', department: 'Jurídico', companyId: 'empresa-b' }, candidateEmpresaB, processoEmpresaB), true, 'companyId igual ao processo aceita');
  const candidateSpeY = { department: 'Jurídico', speId: 'spe-y', scopeType: 'spe' };
  const processoSpeY = { department: 'Jurídico', speId: 'spe-y', scopeType: 'spe' };
  assert.equal(canBeResponsibleForLegalDeadline({ role: 'colaborador', department: 'Jurídico', speId: 'spe-x' }, candidateSpeY, processoSpeY), false, 'speId diferente do processo rejeita');
});

test('server.js não contém nenhum método de escrita do Google Calendar (events.insert/update/patch/delete) — Calendar é somente leitura', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const writeMethod of ['events.insert', 'events.update', 'events.patch', 'events.delete', 'calendar.events.insert', 'calendar.events.delete']) {
    assert.ok(!source.includes(writeMethod), `server.js não deve conter o método de escrita do Google Calendar: ${writeMethod}`);
  }
});

// --- H3 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H3-01): resolução segura de IP do cliente ---
test('resolveClientIp (H3-proxy-A): sem TRUST_PROXY_HOPS configurado, X-Forwarded-For forjado é ignorado — usa sempre o endereço remoto real', () => {
  const originalHops = process.env.TRUST_PROXY_HOPS;
  delete process.env.TRUST_PROXY_HOPS;
  delete require.cache[require.resolve('../auth/client-ip')];
  const { resolveClientIp } = require('../auth/client-ip');
  const req = { socket: { remoteAddress: '203.0.113.9' }, headers: { 'x-forwarded-for': '1.2.3.4' } };
  assert.equal(resolveClientIp(req), '203.0.113.9', 'sem proxy confiável configurado, o X-Forwarded-For forjado nunca deve ser usado');
  if (originalHops === undefined) delete process.env.TRUST_PROXY_HOPS; else process.env.TRUST_PROXY_HOPS = originalHops;
});

test('resolveClientIp (H3-proxy-B/C): com proxy confiável, resolve o IP conforme o número de saltos configurado, sem escolher arbitrariamente a primeira entrada', () => {
  const originalHops = process.env.TRUST_PROXY_HOPS;
  process.env.TRUST_PROXY_HOPS = '1';
  delete require.cache[require.resolve('../auth/client-ip')];
  const { resolveClientIp } = require('../auth/client-ip');
  // Cadeia esperada com 1 proxy confiável: "cliente, proxy1" — o cliente é a entrada a 1 posição do fim.
  const reqOk = { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.2' } };
  assert.equal(resolveClientIp(reqOk), '198.51.100.7');
  // Cadeia MAIOR que o esperado (um atacante tentando inserir entradas extras à esquerda): a posição
  // resolvida acompanha a fórmula determinística (chain.length - hops), nunca escolhe arbitrariamente a
  // primeira entrada da esquerda como se fosse sempre o cliente.
  const reqLonger = { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '9.9.9.9, 198.51.100.7, 10.0.0.2' } };
  assert.equal(resolveClientIp(reqLonger), '198.51.100.7', 'com hops=1, a posição resolvida é sempre chain.length-1, nunca a primeira entrada da cadeia');
  if (originalHops === undefined) delete process.env.TRUST_PROXY_HOPS; else process.env.TRUST_PROXY_HOPS = originalHops;
});

test('resolveClientIp (H3-proxy-D): normaliza IPv4-mapped IPv6', () => {
  delete require.cache[require.resolve('../auth/client-ip')];
  const { resolveClientIp, normalizeIp } = require('../auth/client-ip');
  assert.equal(normalizeIp('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(normalizeIp('2001:db8::1'), '2001:db8::1', 'IPv6 nativo (não IPv4-mapped) não deve ser alterado');
  const req = { socket: { remoteAddress: '::ffff:203.0.113.9' }, headers: {} };
  assert.equal(resolveClientIp(req), '203.0.113.9');
});
