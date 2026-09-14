// P0-DEMO — 3 inconsistências visíveis no Jurídico antes da apresentação (branch demo):
// 1) "Comitê Executivo mensal" mostra "Abrir" mas não abre (dashboard-widgets.js mostrava o CTA mesmo
//    sem destino real; dashboard-service.js não atribuía nenhum destino ao compromisso).
// 2) Evento de agosto (já vencido) aparecia como "próximo" (store.agenda usado sem filtro de data).
// 3) Tela de Integrações mostrava "Jurídico · sete quadros configurados" hardcoded (hoje são 35).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_JS_PATH = path.join(__dirname, '..', 'public', 'app.js');
const WIDGETS_JS_PATH = path.join(__dirname, '..', 'public', 'dashboard-widgets.js');

// ===================================================================================
// Item 1 — CTA "Abrir" sem ação real / roteamento do Comitê Jurídico
// ===================================================================================

test('[P0-1] dashboard-service.js: compromisso de Comitê do Jurídico recebe target "comite:Jurídico"; compromisso comum fica sem target', () => {
  const { seed } = require('../server');
  const { dashboardPayload } = require('../dashboard-service');
  const store = structuredClone(seed);
  store.agenda = [
    { id: 'evt-comite', title: 'Comitê Executivo mensal', department: 'Jurídico', date: '2099-01-10', priority: 'Alta', status: 'Agendado', owner: 'Líder Jurídico' },
    { id: 'evt-comum', title: 'Revisão do roadmap de TI', department: 'TI', date: '2099-01-12', priority: 'Média', status: 'Agendado', owner: 'Líder de Tecnologia' }
  ];

  const { upcomingAgendaItems } = require('../server');
  const payload = dashboardPayload(store, 'executive', {}, null, { upcomingAgendaItems });
  const rows = payload.widgets['upcoming-deadlines'].data;
  const committee = rows.find(r => r.id === 'evt-comite');
  const common = rows.find(r => r.id === 'evt-comum');

  assert.equal(committee.target, 'comite:Jurídico', 'compromisso de Comitê do Jurídico precisa resolver para um destino real (nunca hardcoda o título específico do evento)');
  assert.equal(common.target, undefined, 'compromisso sem padrão de Comitê não pode ganhar um destino inventado');
});

test('[P0-1] dashboard-widgets.js: item de lista COM target vira botão clicável com "Abrir"; item SEM target fica desabilitado e sem CTA falso', () => {
  const source = fs.readFileSync(WIDGETS_JS_PATH, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  const payload = {
    dashboard: { widgets: [{ id: 'upcoming-deadlines', type: 'UpcomingDeadlines', title: 'Próximos compromissos', width: 'third' }] },
    widgets: {
      'upcoming-deadlines': {
        state: 'ready',
        data: [
          { title: 'Comitê Executivo mensal', department: 'Jurídico', date: '2099-01-10', target: 'comite:Jurídico' },
          { title: 'Revisão do roadmap de TI', department: 'TI', date: '2099-01-12' }
        ],
        memory: { source: 'Agenda', competence: '2099-01', recordCount: 2, rule: 'teste', ruleVersion: 'v1' }
      }
    }
  };

  const html = sandbox.window.CoevoDashboardWidgets.dashboard(payload);

  assert.match(html, /onclick="openWidgetTarget\('comite:Jur[íi]dico'\)"[^>]*>[\s\S]*?Comit[êe] Executivo mensal/, 'compromisso de Comitê precisa continuar clicável, com onclick real');
  assert.match(html, /Comit[êe] Executivo mensal[\s\S]*?<strong>Abrir<\/strong>/, 'com destino real, o CTA "Abrir" deve aparecer');

  const commonButton = '<button' + html.split('<button').find(fragment => fragment.includes('Revisão do roadmap de TI'));
  assert.doesNotMatch(commonButton, /onclick=/, 'compromisso sem destino real não pode ter onclick');
  assert.match(commonButton, /^<button\s+disabled>/, 'compromisso sem destino real precisa ficar desabilitado (não pode parecer clicável)');
  assert.doesNotMatch(commonButton, /<strong>Abrir<\/strong>/, 'compromisso sem destino real nunca pode mostrar o CTA "Abrir" (era exatamente o bug)');
});

test('[P0-1] public/app.js: openWidgetTarget("comite:Jurídico") define committeeDepartment e navega para a tela "comites" (mesmo fluxo já existente)', () => {
  const source = fs.readFileSync(APP_JS_PATH, 'utf8');
  const fnSource = source.match(/function openWidgetTarget\(target\)\{[\s\S]*?\n\}/)[0];
  assert.match(fnSource, /target\.startsWith\('comite:'\)/, 'a rota precisa reconhecer o prefixo comite: sem hardcodar um departamento específico');

  const sandbox = { state: { screen: 'executivo', committeeDepartment: null, legalModule: null }, go(screen) { sandbox.state.screen = screen; }, render() {}, LEGAL_KEY: {}, LEGAL_MODULES: [] };
  vm.createContext(sandbox);
  vm.runInContext(fnSource, sandbox);

  sandbox.openWidgetTarget('comite:Jurídico');

  assert.equal(sandbox.state.committeeDepartment, 'Jurídico');
  assert.equal(sandbox.state.screen, 'comites', 'deve reaproveitar o roteamento existente para a tela de Comitês, sem criar tela nova');
});

// ===================================================================================
// Item 2 — evento vencido aparecendo como "próximo"
// ===================================================================================

test('[P0-2] upcomingAgendaItems(): exclui evento passado, inclui hoje e futuro, ordena por data crescente', () => {
  const { upcomingAgendaItems } = require('../server');
  const today = '2026-09-14';
  const agenda = [
    { id: 'futuro-2', date: '2026-10-01', title: 'Futuro 2' },
    { id: 'passado', date: '2026-08-12', title: 'Comitê Executivo mensal' },
    { id: 'hoje', date: today, title: 'Hoje' },
    { id: 'futuro-1', date: '2026-09-20', title: 'Futuro 1' }
  ];

  const result = upcomingAgendaItems(agenda, today);

  assert.ok(!result.some(e => e.id === 'passado'), 'evento com data anterior a hoje nunca pode aparecer como próximo');
  assert.ok(result.some(e => e.id === 'hoje'), 'evento de hoje deve continuar aparecendo');
  assert.deepEqual(result.map(e => e.id), ['hoje', 'futuro-1', 'futuro-2'], 'ordenação deve ser crescente por data');
});

test('[P0-2] upcomingAgendaItems(): nunca muta o array/itens originais da agenda (histórico preservado na store)', () => {
  const { upcomingAgendaItems } = require('../server');
  const agenda = [{ id: 'passado', date: '2020-01-01', title: 'Evento antigo' }];
  const snapshot = structuredClone(agenda);
  upcomingAgendaItems(agenda, '2026-09-14');
  assert.deepEqual(agenda, snapshot, 'filtrar/ordenar a visão "próximos" nunca pode apagar ou alterar o evento histórico na store');
});

test('[P0-2] upcomingAgendaItems(): usa data civil de America/Sao_Paulo por padrão — evento de "hoje" no fuso do projeto não pode virar passado por um cálculo ingênuo em UTC', (t) => {
  // 02:00 UTC de 14/set/2026 já é 13/set no fuso de São Paulo (UTC-3) — um cálculo de "hoje" em UTC
  // puro erraria o dia. upcomingAgendaItems() sem `today` explícito precisa usar a MESMA convenção civil
  // já validada por isLegalDeadlineOverdue()/civilWeekWindow() (todayCivilDate(), America/Sao_Paulo).
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T02:00:00.000Z') });
  const { upcomingAgendaItems, todayCivilDate } = require('../server');
  assert.equal(todayCivilDate(), '2026-09-13', 'sanity check: a data civil de São Paulo neste instante é 13/set, não 14/set');
  const result = upcomingAgendaItems([{ id: 'evento-de-hoje-sp', date: '2026-09-13', title: 'Evento de hoje em SP' }]);
  assert.equal(result.length, 1, 'o evento de "hoje" no fuso do projeto não pode ser tratado como vencido/passado');
});

test('[P0-2] GET /api/dashboard e dashboardPayload("executive"): o compromisso de agosto do seed não aparece mais como próximo (data real do sistema)', () => {
  const { seed, todayCivilDate } = require('../server');
  const { dashboardPayload } = require('../dashboard-service');
  const today = todayCivilDate();
  assert.ok(today > '2026-08-12', 'sanity check do ambiente de teste: a data atual precisa ser posterior ao evento de agosto do seed');

  const { upcomingAgendaItems } = require('../server');
  const store = structuredClone(seed); // agenda original do seed, incluindo "Comitê Executivo mensal" em 2026-08-12
  const payload = dashboardPayload(store, 'executive', {}, null, { upcomingAgendaItems });
  const rows = payload.widgets['upcoming-deadlines']?.data || [];
  assert.ok(!rows.some(r => r.id === 'evt-1'), 'o compromisso de 2026-08-12 do seed não pode continuar aparecendo como "próximo" hoje');
});

// ===================================================================================
// Item 3 — "sete quadros configurados" hardcoded
// ===================================================================================

test('[P0-3] public/app.js: contagem de boards do Monday nunca mais hardcoded — deriva de state.mondayStatus.moduleCount (mesma fonte do catálogo)', () => {
  const source = fs.readFileSync(APP_JS_PATH, 'utf8');
  assert.doesNotMatch(source, /sete quadros/i, 'a contagem fixa "sete quadros" nunca pode voltar ao código');
  assert.doesNotMatch(source, /\b\d+\s+quadros?\s+configurados?/i, 'nenhuma contagem numérica de quadros pode ficar hardcoded em nenhum lugar do frontend');
  const fnSource = source.match(/function integrationsPage\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(fnSource, /state\.mondayStatus\?\.moduleCount/, 'a contagem precisa vir de state.mondayStatus.moduleCount (GET /api/monday/status), nunca de uma constante local');
});

test('[P0-3] GET /api/monday/status moduleCount é exatamente o catálogo de boards habilitados (mesma fonte usada pelo sync e pelo menu Jurídico)', () => {
  const { MONDAY_BOARDS } = require('../server');
  const { enabledMondaySources } = require('../legal-source-catalog');
  assert.equal(Object.keys(MONDAY_BOARDS).length, enabledMondaySources().length);
  assert.equal(Object.keys(MONDAY_BOARDS).length, 35, 'catálogo desta rodada continua com 35 boards habilitados — nenhuma alteração à integração Monday');
});
