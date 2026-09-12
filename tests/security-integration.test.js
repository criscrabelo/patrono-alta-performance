// Testes de integração em runtime real — sobem um servidor HTTP de verdade (o mesmo `handler`
// exportado por server.js), fazem requisições reais e verificam status HTTP e corpo da resposta.
// Complementam (não substituem) os testes unitários de tests/core.test.js: aqui o que é exercitado é
// o comportamento observável do sistema, não a presença de um trecho de texto no código-fonte.
//
// Isolamento: COEVO_DATA_DIR aponta para um diretório temporário exclusivo deste processo de teste
// (node --test roda cada arquivo *.test.js em um processo próprio), portanto nada aqui toca a store
// real do repositório. As variáveis de ambiente precisam ser definidas ANTES do primeiro `require('../server')`.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-integration-'));
process.env.COEVO_DATA_DIR = TEST_DATA_DIR;
process.env.COEVO_DEMO_PASSWORD = 'integration-test-password-0000000000';
process.env.COEVO_MFA_CODE = '000000';
process.env.COEVO_SESSION_MS = '300000';
process.env.NODE_ENV = 'test';
delete process.env.MONDAY_TOKEN; // garante que nenhuma chamada real ao Monday seja tentada nos testes

const { handler, readStore, writeStore } = require('../server');
const { PROJECT_ID } = require('../project-service');

let server;
let baseUrl;

const EMAILS = {
  liderJuridico: 'lider.juridico.teste@coevo.local',
  colaboradorJuridico: 'colaborador.juridico.teste@coevo.local',
  liderTi: 'lider.ti.teste@coevo.local',
  semAcesso: 'sem.acesso.teste@coevo.local',
  // Usuário seed já existente (não criado por este teste) com papel diretoria — alçada global.
  diretoria: 'juridico@coevoconstrutora.com.br'
};

test.before(async () => {
  // Injeta usuários de teste com e-mails únicos — o seed de homologação tem um e-mail duplicado entre
  // usr-diretoria/usr-juridico (docs/SEGURANCA-CORRECOES.md, item J), o que tornaria usr-juridico
  // inalcançável por login normal. Também semeia um "processo" (coleção 'processos', a mesma que
  // representa o Legal Process do piloto) para validar a integridade relacional de Legal Deadline.
  const store = readStore();
  store.users.push(
    { id: 'usr-teste-lider-juridico', name: 'Líder Jurídico Teste', email: EMAILS.liderJuridico, role: 'lider', department: 'Jurídico', mfa: true },
    { id: 'usr-teste-colaborador-juridico', name: 'Colaborador Jurídico Teste', email: EMAILS.colaboradorJuridico, role: 'colaborador', department: 'Jurídico', mfa: false },
    { id: 'usr-teste-lider-ti', name: 'Líder TI Teste', email: EMAILS.liderTi, role: 'lider', department: 'TI', mfa: true },
    // Papel inexistente em ROLES — simula um usuário autenticado sem NENHUM módulo autorizado,
    // cobrindo o caso QA §30 #1 ("usuário sem acesso tenta registro jurídico → bloqueio server-side").
    // department:'Jurídico' propositalmente (não null) — reproduz exatamente o cenário do P0 da
    // rodada 4 (item 8): projectPermissions() concedia edit/create a um papel desconhecido só por
    // coincidência de department, mesmo sem nenhum módulo reconhecido em ROLES.
    { id: 'usr-teste-sem-acesso', name: 'Sem Acesso Teste', email: EMAILS.semAcesso, role: 'externo', department: 'Jurídico', mfa: false }
  );
  if (!store.records) store.records = {};
  store.records.processos = [
    { id: 'proc-juridico-teste', source: 'monday', externalId: 'ext-1', module: 'processos', department: 'Jurídico', title: 'Processo Jurídico de Teste', deletedAt: null },
    // Registro sintético para testar a checagem de escopo do processId relacionado — na prática todo
    // board Monday sincronizado hoje é do Jurídico (normalizeMondayItem), mas a validação de
    // integridade relacional de Legal Deadline precisa negar corretamente mesmo que uma fonte futura
    // introduza processos de outro departamento.
    { id: 'proc-ti-teste', source: 'monday', externalId: 'ext-2', module: 'processos', department: 'TI', title: 'Processo TI de Teste (sintético, apenas para o teste)', deletedAt: null },
    // Registro SEM source:'monday' — simula um "processo local falso" que teria sido inserido por
    // algum caminho fora do pipeline de sincronização (o generic CRUD já bloqueia isso via
    // rejectIfMondaySourced, mas este registro sintético prova que, mesmo que existisse, Legal
    // Deadline ainda o rejeitaria por não vir da fonte autorizada — defesa em profundidade, item 4).
    { id: 'proc-falso-nao-monday', source: 'manual', module: 'processos', department: 'Jurídico', title: 'Processo forjado (sem fonte Monday)', deletedAt: null }
  ];
  // Segundo projeto, em departamento diferente do único projeto real do seed (Jurídico) — usado
  // apenas para provar que as rotas de sub-recurso de projeto (target/approval-rules/recovery-
  // settings/DELETE/restore/management-items) respeitam scoped(user,project) e não apenas a
  // existência do projectId (item 5/8 da rodada 3).
  if (!Array.isArray(store.projects)) store.projects = [];
  store.projects.push({ id: 'prj-ti-teste', slug: 'projeto-ti-teste', name: 'Projeto TI de Teste', departmentId: 'dep-ti', department: 'TI', category: 'Operacional', objectiveId: null, ownerUserId: null, coOwnerUserIds: [], managerUserId: null, sponsorUserId: null, status: 'Planejamento', progress: null, targetId: null, nextMilestoneId: null, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  // Agenda de dois departamentos distintos, para provar que GET /api/agenda filtra por escopo.
  store.agenda.push(
    { id: 'evt-teste-juridico', title: 'Evento Jurídico de Teste', department: 'Jurídico', date: '2026-12-01', priority: 'Alta', status: 'Agendado', owner: 'Líder Jurídico Teste', classification: 'Interno' },
    { id: 'evt-teste-ti', title: 'Evento TI de Teste', department: 'TI', date: '2026-12-02', priority: 'Média', status: 'Agendado', owner: 'Líder TI Teste', classification: 'Interno' }
  );
  writeStore(store);

  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

async function api(method, pathname, { token, json } = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: json !== undefined ? JSON.stringify(json) : undefined
  });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

async function loginAs(email) {
  const login = await api('POST', '/api/auth/login', { json: { email, password: process.env.COEVO_DEMO_PASSWORD } });
  assert.equal(login.status, 200, `login deveria aceitar credenciais válidas para ${email}: ${JSON.stringify(login.body)}`);
  if (login.body.token) return login.body.token;
  assert.equal(login.body.mfaRequired, true);
  const mfa = await api('POST', '/api/auth/mfa', { json: { challenge: login.body.challenge, code: process.env.COEVO_MFA_CODE } });
  assert.equal(mfa.status, 200, `MFA deveria ser aceito para ${email}: ${JSON.stringify(mfa.body)}`);
  assert.ok(mfa.body.token);
  return mfa.body.token;
}

// --- 1. usuário sem Jurídico recebe 403 ---

test('[HTTP] usuário sem nenhum módulo autorizado recebe 403 ao tentar ler registro jurídico', async () => {
  const token = await loginAs(EMAILS.semAcesso);
  const res = await api('GET', '/api/legal/processos', { token });
  assert.equal(res.status, 403);
  assert.ok(res.body.error);
});

test('[HTTP] requisição sem token recebe 401 (nunca 200 nem 403 mascarando ausência de sessão)', async () => {
  const res = await api('GET', '/api/legal/processos');
  assert.equal(res.status, 401);
});

test('[HTTP] bypass usr-* continua bloqueado em runtime real', async () => {
  const res = await api('GET', '/api/entities/processos', { token: 'usr-diretoria' });
  assert.equal(res.status, 401);
});

// --- 2. alteração de :module em /api/legal/:module não permite acesso a coleção não autorizada ---

test('[HTTP] GET /api/legal/:module nega módulo fora da allowlist sem criar a coleção incidentalmente', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('GET', '/api/legal/legalDeadlines', { token }); // tipo real do motor genérico, não pertence a /api/legal
  assert.equal(res.status, 404);
  const outroTipo = await api('GET', '/api/legal/users', { token }); // tentativa de alcançar outra coleção arbitrária pela URL
  assert.equal(outroTipo.status, 404);
  // confirma que nada foi criado incidentalmente em store.records.legalDeadlines por essa tentativa
  const viaEntities = await api('GET', '/api/entities/legalDeadlines', { token });
  assert.equal(viaEntities.status, 200);
  assert.deepEqual(viaEntities.body, []);
});

test('[HTTP] GET /api/legal/processos (módulo real, autorizado) continua funcionando para quem tem acesso', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('GET', '/api/legal/processos', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.module, 'processos');
});

// --- 3. tipo desconhecido em /api/entities/:type é negado ---

test('[HTTP] GET /api/entities/:type nega tipo desconhecido/arbitrário, incluindo __proto__', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  for (const type of ['financeiroBancario', '__proto__', 'constructor', 'usuarios']) {
    const res = await api('GET', `/api/entities/${type}`, { token });
    assert.equal(res.status, 403, `tipo "${type}" deveria ser negado`);
  }
});

// --- 4. GET/PATCH/restore fora do escopo são bloqueados (object-level authorization) ---

test('[HTTP] registro de outro departamento não aparece na listagem, e PATCH/restore por ID fora do escopo são bloqueados', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const tokenTi = await loginAs(EMAILS.liderTi);

  const created = await api('POST', '/api/entities/legalDeadlines', {
    token: tokenJuridico,
    json: { processId: 'proc-juridico-teste', origin: 'Intimação eletrônica (teste)', date: '2026-12-01' }
  });
  assert.equal(created.status, 201);
  const deadlineId = created.body.id;
  assert.equal(created.body.department, 'Jurídico', 'registro criado por papel departamental herda o department do próprio usuário');

  // TI não deve nem ver este registro na coleção...
  const listAsTi = await api('GET', '/api/entities/legalDeadlines', { token: tokenTi });
  assert.equal(listAsTi.status, 200);
  assert.ok(!listAsTi.body.some(item => item.id === deadlineId), 'registro do Jurídico não pode vazar para listagem do TI');

  // ...nem alterar por ID direto...
  const patchAsTi = await api('PATCH', `/api/entities/legalDeadlines/${deadlineId}`, { token: tokenTi, json: { origin: 'Alterado indevidamente' } });
  assert.equal(patchAsTi.status, 404, 'PATCH por ID fora do escopo não pode revelar nem alterar o registro');

  // ...nem restaurar um registro que arquivou não sendo dele. Hoje só diretoria/administrador têm a
  // ação 'restore' em ROLES — um lider de outro departamento já é barrado no gate de ação (403), antes
  // de chegar ao gate de escopo do registro. A checagem scoped() em restore (server.js) permanece como
  // defesa em profundidade para o dia em que 'restore' for concedido a um papel departamental.
  const archiveAsJuridico = await api('DELETE', `/api/entities/legalDeadlines/${deadlineId}`, { token: tokenJuridico });
  assert.equal(archiveAsJuridico.status, 200);
  const restoreAsTi = await api('POST', `/api/entities/legalDeadlines/${deadlineId}/restore`, { token: tokenTi });
  assert.equal(restoreAsTi.status, 403, 'papel "lider" não tem ação restore em nenhum departamento (gate de ação, antes do gate de escopo)');

  const restoreAsJuridico = await api('POST', `/api/entities/legalDeadlines/${deadlineId}/restore`, { token: tokenJuridico });
  assert.equal(restoreAsJuridico.status, 403, 'e nem mesmo o líder do próprio departamento pode restaurar — só diretoria/administrador têm essa ação');

  // Nota sobre cobertura: a v.13 pede um teste HTTP de "restore fora do escopo bloqueado". Com o RBAC
  // atual (ROLES em server.js), só diretoria/administrador têm a ação 'restore', e ambos têm escopo
  // global (scoped() sempre true) — não há papel departamental capaz de restaurar para exercitar o
  // 404 por escopo via HTTP hoje. A proteção de código (scoped() dentro do handler de restore) já
  // existe e é coberta por teste unitário direto em tests/core.test.js ("scoped() nega registro sem
  // department..."); fica registrado aqui, e não simulado artificialmente, para não passar a falsa
  // impressão de que o RBAC atual concede restore a um papel departamental.
});

// --- 5 e 6. POST/PATCH não permitem sobrescrever campos protegidos ---

test('[HTTP] POST /api/entities/:type ignora id/version/createdBy/department forjados no corpo da requisição', async () => {
  const token = await loginAs(EMAILS.colaboradorJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', {
    token,
    json: {
      id: 'id-forjado-pelo-cliente', version: 999, createdAt: '2000-01-01T00:00:00.000Z', createdBy: 'Invasor',
      updatedAt: '2000-01-01T00:00:00.000Z', updatedBy: 'Invasor', source: 'monday', externalId: 'ext-forjado',
      department: 'TI', // colaborador não pode escolher o department do próprio registro
      processId: 'proc-juridico-teste', origin: 'Intimação eletrônica (teste)', date: '2026-12-05'
    }
  });
  assert.equal(res.status, 201);
  assert.notEqual(res.body.id, 'id-forjado-pelo-cliente');
  assert.equal(res.body.version, 1);
  assert.notEqual(res.body.createdBy, 'Invasor');
  assert.equal(res.body.createdBy, 'Colaborador Jurídico Teste');
  assert.notEqual(res.body.createdAt, '2000-01-01T00:00:00.000Z');
  assert.equal(res.body.source, undefined, 'metadado de origem/sincronização não pode ser forjado por um registro criado manualmente');
  assert.equal(res.body.department, 'Jurídico', 'department é definido pelo servidor a partir do próprio usuário, nunca pelo corpo da requisição');
});

test('[HTTP] PATCH /api/entities/:type ignora id/createdBy/version/deletedAt/department forjados no corpo da requisição', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', {
    token, json: { processId: 'proc-juridico-teste', origin: 'Origem original (teste)', date: '2026-12-10' }
  });
  assert.equal(created.status, 201);
  const originalId = created.body.id;
  const originalCreatedAt = created.body.createdAt;

  const patch = await api('PATCH', `/api/entities/legalDeadlines/${originalId}`, {
    token,
    json: {
      id: 'outro-id-forjado', version: 42, createdAt: '1999-01-01T00:00:00.000Z', createdBy: 'Invasor',
      updatedBy: 'Invasor', deletedAt: '1999-01-01T00:00:00.000Z', deletedBy: 'Invasor',
      department: 'TI', origin: 'Origem corrigida legitimamente (teste)'
    }
  });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.id, originalId, 'id não pode ser alterado por PATCH');
  assert.equal(patch.body.version, 2, 'version é controlada pelo servidor, incrementada em 1 — nunca o valor enviado pelo cliente');
  assert.equal(patch.body.createdAt, originalCreatedAt, 'createdAt é imutável após a criação');
  assert.notEqual(patch.body.createdBy, 'Invasor');
  assert.equal(patch.body.updatedBy, 'Líder Jurídico Teste');
  assert.equal(patch.body.deletedAt, undefined, 'PATCH não pode arquivar o registro por injeção de deletedAt');
  assert.equal(patch.body.department, 'Jurídico', 'department não muda por PATCH quando o papel tem escopo departamental');
  assert.equal(patch.body.origin, 'Origem corrigida legitimamente (teste)', 'campo de negócio legítimo é atualizado normalmente');
});

// --- 7 e 8. Legal Deadline: origem obrigatória e integridade relacional do processo ---

test('[HTTP] Legal Deadline sem origem/processId/date é rejeitado com 422', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const semOrigem = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', date: '2026-12-01' } });
  assert.equal(semOrigem.status, 422);
  const semProcesso = await api('POST', '/api/entities/legalDeadlines', { token, json: { origin: 'Teste', date: '2026-12-01' } });
  assert.equal(semProcesso.status, 422);
  const semData = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste' } });
  assert.equal(semData.status, 422);
});

test('[HTTP] Legal Deadline com processId inexistente é rejeitado com 422', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'processo-que-nao-existe', origin: 'Teste', date: '2026-12-01' } });
  assert.equal(res.status, 422);
});

test('[HTTP] Legal Deadline apontando para processo fora do escopo do usuário é rejeitado com 403, nunca criado', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-ti-teste', origin: 'Teste', date: '2026-12-01' } });
  assert.equal(res.status, 403);
  const list = await api('GET', '/api/entities/legalDeadlines', { token });
  assert.ok(!list.body.some(item => item.processId === 'proc-ti-teste'), 'nenhum registro deve ter sido criado apontando para o processo fora de escopo');
});

// --- 9. perfil privilegiado exige MFA ---

test('[HTTP] papel privilegiado (lider) sempre passa por desafio de MFA no login, mesmo sem token completar', async () => {
  const login = await api('POST', '/api/auth/login', { json: { email: EMAILS.liderJuridico, password: process.env.COEVO_DEMO_PASSWORD } });
  assert.equal(login.status, 200);
  assert.equal(login.body.mfaRequired, true);
  assert.equal(login.body.token, undefined, 'nenhum token é emitido antes do segundo fator para papel privilegiado');
});

test('[HTTP] challenge de MFA não funciona como token de sessão', async () => {
  const login = await api('POST', '/api/auth/login', { json: { email: EMAILS.liderJuridico, password: process.env.COEVO_DEMO_PASSWORD } });
  const res = await api('GET', '/api/legal/processos', { token: login.body.challenge });
  assert.equal(res.status, 401);
});

test('[HTTP] MFA com código incorreto é rejeitado e não emite token', async () => {
  const login = await api('POST', '/api/auth/login', { json: { email: EMAILS.liderJuridico, password: process.env.COEVO_DEMO_PASSWORD } });
  const mfa = await api('POST', '/api/auth/mfa', { json: { challenge: login.body.challenge, code: '999999' } });
  assert.equal(mfa.status, 401);
  assert.equal(mfa.body.token, undefined);
});

// --- 10. __proto__ e tipos arbitrários seguem bloqueados nas rotas de restore/patch/delete também ---

test('[HTTP] __proto__ e outros tipos arbitrários são negados em todos os verbos de /api/entities/:type', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  for (const type of ['__proto__', 'constructor', 'financeiroBancario']) {
    assert.equal((await api('GET', `/api/entities/${type}`, { token })).status, 403);
    assert.equal((await api('POST', `/api/entities/${type}`, { token, json: { title: 'x' } })).status, 403);
    assert.equal((await api('PATCH', `/api/entities/${type}/qualquer-id`, { token, json: { title: 'x' } })).status, 403);
    assert.equal((await api('DELETE', `/api/entities/${type}/qualquer-id`, { token })).status, 403);
    assert.equal((await api('POST', `/api/entities/${type}/qualquer-id/restore`, { token })).status, 403);
  }
});

// ============================================================================================
// Rodada 3 de correções de segurança — testes de integração HTTP real
// ============================================================================================

// --- Item 1: scopeType/companyId/speId não podem ser forjados por papel departamental ---

test('[HTTP] usuário departamental não consegue definir scopeType:"global" via POST nem PATCH', async () => {
  const token = await loginAs(EMAILS.colaboradorJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste scopeType', date: '2026-12-15', scopeType: 'global' } });
  assert.equal(created.status, 201);
  assert.notEqual(created.body.scopeType, 'global', 'scopeType não pode ser definido por papel departamental na criação');

  const patch = await api('PATCH', `/api/entities/legalDeadlines/${created.body.id}`, { token, json: { scopeType: 'global' } });
  assert.equal(patch.status, 200);
  assert.notEqual(patch.body.scopeType, 'global', 'scopeType não pode ser definido por papel departamental via PATCH');

  // Prova que a tentativa de forjar scopeType:'global' realmente não teve efeito: TI continua sem
  // enxergar o registro do Jurídico.
  const tokenTi = await loginAs(EMAILS.liderTi);
  const listAsTi = await api('GET', '/api/entities/legalDeadlines', { token: tokenTi });
  assert.ok(!listAsTi.body.some(item => item.id === created.body.id), 'registro não pode ter se tornado global via forjamento de scopeType');
});

// --- Item 2: companyId/speId negam por ausência ou mismatch, mesmo com department correspondente ---

// Nota: legalDeadlines NÃO é usado aqui — desde a rodada 4 (item 7), seus campos de escopo são
// sempre herdados do processo relacionado, sobrescrevendo qualquer companyId enviado pelo cliente
// (inclusive por diretoria). Esse comportamento tem teste próprio mais abaixo ("Legal Deadline herda
// o escopo do processo relacionado"). Aqui testamos companyId de forma genérica, via um tipo de
// entidade sem regra de herança (documentReferences), para isolar o comportamento de scoped().
test('[HTTP] companyId nega por ausência mesmo quando department coincide (deny-by-default)', async () => {
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const created = await api('POST', '/api/entities/documentReferences', {
    token: tokenDiretoria,
    json: { title: 'Documento de teste companyId', department: 'Jurídico', companyId: 'empresa-sintetica-x' }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.companyId, 'empresa-sintetica-x', 'papel global pode definir companyId — fundação para quando o cadastro de empresa existir');

  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const listAsJuridico = await api('GET', '/api/entities/documentReferences', { token: tokenJuridico });
  assert.ok(!listAsJuridico.body.some(item => item.id === created.body.id), 'usuário sem companyId deve ser negado quando o registro tem companyId, mesmo com department igual');
});

// --- Item 3: PATCH de Legal Deadline preserva as invariantes de criação ---

test('[HTTP] PATCH de Legal Deadline não permite quebrar as invariantes de origem/processo/data', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem válida', date: '2026-12-25' } });
  assert.equal(created.status, 201);
  const id = created.body.id;

  assert.equal((await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { processId: 'processo-que-nao-existe' } })).status, 422, 'PATCH com processId inexistente deve ser rejeitado');
  assert.equal((await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { processId: 'proc-ti-teste' } })).status, 403, 'PATCH com processo fora do escopo deve ser rejeitado');
  assert.equal((await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { origin: '' } })).status, 422, 'PATCH apagando origin deve ser rejeitado');
  assert.equal((await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { date: '' } })).status, 422, 'PATCH apagando date deve ser rejeitado');

  const afterInvalidAttempts = await api('GET', '/api/entities/legalDeadlines', { token });
  const record = afterInvalidAttempts.body.find(item => item.id === id);
  assert.equal(record.processId, 'proc-juridico-teste');
  assert.equal(record.origin, 'Origem válida');
  assert.equal(record.date, '2026-12-25');
  assert.equal(record.version, 1, 'nenhuma tentativa inválida deve ter alterado o registro nem incrementado a versão');

  const patchValido = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { origin: 'Origem atualizada legitimamente' } });
  assert.equal(patchValido.status, 200, 'PATCH válido preservando a integridade continua funcionando');
  assert.equal(patchValido.body.origin, 'Origem atualizada legitimamente');
  assert.equal(patchValido.body.version, 2);
});

// --- Item 4: tipos mantidos pelo Monday não podem ser criados/alterados pela API genérica ---

test('[HTTP] processo do Monday não pode ser criado/alterado/arquivado/restaurado pela API genérica; Legal Deadline rejeita processo não-Monday', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  assert.equal((await api('POST', '/api/entities/processos', { token, json: { title: 'Processo local falso' } })).status, 403, 'não pode criar uma cópia concorrente de processos pela API genérica');
  assert.equal((await api('PATCH', '/api/entities/processos/proc-juridico-teste', { token, json: { title: 'Alterado indevidamente' } })).status, 403);
  assert.equal((await api('DELETE', '/api/entities/processos/proc-juridico-teste', { token })).status, 403);
  assert.equal((await api('POST', '/api/entities/processos/proc-juridico-teste/restore', { token })).status, 403);
  assert.equal((await api('GET', '/api/entities/processos', { token })).status, 200, 'leitura via generic engine continua permitida');

  // Mesmo que um "processo" sem source:'monday' existisse na store (defesa em profundidade — não deve
  // ser alcançável na prática, já que o bloqueio acima impede sua criação pela API), Legal Deadline
  // ainda o rejeita.
  const deadlineFalso = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-falso-nao-monday', origin: 'Teste', date: '2026-12-01' } });
  assert.equal(deadlineFalso.status, 422, 'Legal Deadline só pode apontar para processo da fonte autorizada (Monday)');
});

// --- Item 5: Agenda não vaza entre departamentos; mass assignment de id bloqueado ---

test('[HTTP] agenda não vaza entre departamentos e ignora id/department forjados no corpo', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const listJuridico = await api('GET', '/api/agenda', { token: tokenJuridico });
  assert.equal(listJuridico.status, 200);
  assert.ok(listJuridico.body.some(item => item.id === 'evt-teste-juridico'));
  assert.ok(!listJuridico.body.some(item => item.id === 'evt-teste-ti'), 'agenda de TI não pode vazar para o Jurídico');

  const tokenTi = await loginAs(EMAILS.liderTi);
  const listTi = await api('GET', '/api/agenda', { token: tokenTi });
  assert.ok(listTi.body.some(item => item.id === 'evt-teste-ti'));
  assert.ok(!listTi.body.some(item => item.id === 'evt-teste-juridico'), 'agenda do Jurídico não pode vazar para a TI');

  const created = await api('POST', '/api/agenda', { token: tokenJuridico, json: { id: 'id-forjado', department: 'TI', title: 'Evento forjado' } });
  assert.equal(created.status, 201);
  assert.notEqual(created.body.id, 'id-forjado');
  assert.equal(created.body.department, 'Jurídico', 'department é definido pelo servidor a partir do usuário, não pelo corpo da requisição');
});

// --- Item 6: Comitês e Compliance exigem a permissão correspondente ---

test('[HTTP] comitês e compliance não ficam acessíveis sem a permissão correspondente', async () => {
  const tokenColaborador = await loginAs(EMAILS.colaboradorJuridico); // colaborador não tem módulo 'comites'
  assert.equal((await api('GET', '/api/committees', { token: tokenColaborador })).status, 403);

  const tokenLider = await loginAs(EMAILS.liderJuridico); // lider TEM módulo 'comites'
  assert.equal((await api('GET', '/api/committees', { token: tokenLider })).status, 200);

  // compliance: nenhum papel departamental tem alçada hoje (deny-by-default até existir módulo próprio)
  assert.equal((await api('GET', '/api/compliance', { token: tokenLider })).status, 403);
  assert.equal((await api('POST', '/api/compliance', { token: tokenLider, json: { title: 'x' } })).status, 403);

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  assert.equal((await api('GET', '/api/compliance', { token: tokenDiretoria })).status, 200);
  const createdCompliance = await api('POST', '/api/compliance', { token: tokenDiretoria, json: { id: 'id-forjado', title: 'Entrada legítima' } });
  assert.equal(createdCompliance.status, 201);
  assert.notEqual(createdCompliance.body.id, 'id-forjado', 'mass assignment de id continua bloqueado em /api/compliance');
});

test('[HTTP] mass assignment continua bloqueado em /api/committees', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/committees', { token, json: { id: 'id-forjado', createdBy: 'Invasor', createdAt: '2000-01-01T00:00:00.000Z', title: 'Comitê legítimo' } });
  assert.equal(created.status, 201);
  assert.notEqual(created.body.id, 'id-forjado');
  assert.notEqual(created.body.createdBy, 'Invasor');
  assert.notEqual(created.body.createdAt, '2000-01-01T00:00:00.000Z');
});

// --- Item 7: /api/dashboard não expõe departamento/agenda/orçamento fora de escopo ---

test('[HTTP] /api/dashboard filtra departamentos/agenda por escopo; papel global continua vendo o consolidado', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const dashJuridico = await api('GET', '/api/dashboard', { token: tokenJuridico });
  assert.equal(dashJuridico.status, 200);
  assert.ok(dashJuridico.body.departments.length > 0 && dashJuridico.body.departments.every(d => d.name === 'Jurídico'), 'papel departamental só vê o próprio departamento em /api/dashboard');
  assert.ok(!dashJuridico.body.upcoming.some(item => item.department === 'TI'), 'agenda de TI não pode aparecer no dashboard do Jurídico');

  const tokenTi = await loginAs(EMAILS.liderTi);
  const dashTi = await api('GET', '/api/dashboard', { token: tokenTi });
  assert.ok(dashTi.body.departments.length > 0 && dashTi.body.departments.every(d => d.name === 'TI'));

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const dashDiretoria = await api('GET', '/api/dashboard', { token: tokenDiretoria });
  assert.ok(dashDiretoria.body.departments.some(d => d.name === 'Jurídico') && dashDiretoria.body.departments.some(d => d.name === 'TI'), 'papel global continua vendo o consolidado de todos os departamentos');
});

// --- Item 8: rotas críticas de projeto respeitam scoped(project) ---

test('[HTTP] target/approval-rules/recovery-settings/DELETE/restore/management-items respeitam o escopo do projeto', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);

  assert.equal((await api('PUT', '/api/projects/prj-ti-teste/target', { token: tokenJuridico, json: { indicatorId: 'qualquer' } })).status, 404, 'meta de projeto de outro departamento não pode ser alterada');
  assert.equal((await api('PUT', '/api/projects/prj-ti-teste/approval-rules', { token: tokenJuridico, json: { levels: [] } })).status, 404, 'alçadas de projeto de outro departamento não podem ser alteradas');
  assert.equal((await api('PUT', '/api/projects/prj-ti-teste/recovery-settings', { token: tokenJuridico, json: {} })).status, 404, 'parâmetros de recuperação de projeto de outro departamento não podem ser alterados');

  // Semeia diretamente uma ação e uma pendência de gestão pertencentes ao projeto sintético de TI —
  // usado para provar que DELETE/restore/decisão de gestão negam por escopo do PROJETO, não apenas
  // por módulo/ação genérica (que o papel Jurídico de fato possui).
  const store = readStore();
  store.projectActions.push({ id: 'pac-ti-sintetica', projectId: 'prj-ti-teste', title: 'Ação TI sintética', status: 'Não iniciado', createdAt: new Date().toISOString(), createdBy: 'seed' });
  store.projectManagementItems.push({ id: 'pmi-ti-sintetica', projectId: 'prj-ti-teste', title: 'Pendência TI sintética', status: 'Pendente', createdAt: new Date().toISOString(), createdBy: 'seed' });
  writeStore(store);

  // O gate de escopo (scoped(user,project)) foi colocado ANTES do gate de ação nestas rotas — então
  // lider Jurídico recebe 404 (não 403) ao mirar o projeto de outro departamento, mesmo sem ter a ação
  // 'archive'/'approveAgreement' em nenhum projeto: o escopo nega primeiro, e nunca revela se a ação
  // seria ou não permitida caso o projeto fosse do departamento certo — consistente com "erro de
  // permissão nunca revela existência de registro restrito" (MASTER_HANDOFF §11).
  assert.equal((await api('DELETE', '/api/projects/prj-ti-teste/actions/pac-ti-sintetica', { token: tokenJuridico })).status, 404, 'projeto de outro departamento nega por escopo antes mesmo de avaliar a ação');
  assert.equal((await api('POST', '/api/projects/prj-ti-teste/management-items/pmi-ti-sintetica/approve', { token: tokenJuridico })).status, 404, 'idem para decisão de gestão em projeto de outro departamento');

  // Nota sobre cobertura: `archive`/`restore`/`approveAgreement` em projectPermissions são `elevated`
  // (diretoria/administrador), e ambos os papéis elevados têm escopo global (scoped() sempre true) —
  // não existe hoje, no RBAC real, um papel com essa ação que NÃO tenha também escopo global. Por isso,
  // confirmar que a rota "funciona de verdade" para quem tem a ação só é possível com diretoria — que,
  // por ter escopo global, consegue operar em qualquer projeto (esperado e correto).
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  assert.equal((await api('DELETE', '/api/projects/prj-ti-teste/actions/pac-ti-sintetica', { token: tokenDiretoria })).status, 200);
  assert.equal((await api('POST', '/api/projects/prj-ti-teste/management-items/pmi-ti-sintetica/approve', { token: tokenDiretoria })).status, 200);

  // Ciclo legítimo no projeto real do piloto, com o papel que de fato tem create/edit nele (lider
  // Jurídico) para criar, e diretoria (única com archive/restore) para arquivar/restaurar.
  const created = await api('POST', `/api/projects/${PROJECT_ID}/actions`, { token: tokenJuridico, json: { title: 'Ação de teste rodada 3' } });
  assert.equal(created.status, 201);
  const actionId = created.body.id;
  assert.equal((await api('DELETE', `/api/projects/${PROJECT_ID}/actions/${actionId}`, { token: tokenDiretoria })).status, 200);
  assert.equal((await api('POST', `/api/projects/${PROJECT_ID}/actions/${actionId}/restore`, { token: tokenDiretoria })).status, 200);
});

// --- Item 9: metadados internos do Monday exigem autenticação e não vazam solicitantes/erros ---

test('[HTTP] /api/monday/status e /api/monday/schedule exigem autenticação e não vazam metadados internos', async () => {
  assert.equal((await api('GET', '/api/monday/status')).status, 401, 'status do Monday não pode ser lido sem autenticação');
  assert.equal((await api('GET', '/api/monday/schedule')).status, 401, 'schedule do Monday não pode ser lido sem autenticação');

  const token = await loginAs(EMAILS.liderJuridico);
  const statusAuth = await api('GET', '/api/monday/status', { token });
  assert.equal(statusAuth.status, 200);
  assert.equal(statusAuth.body.boards, undefined, 'lista de boards com IDs/nomes internos não deve mais ser exposta, nem para usuário autenticado');

  const scheduleAuth = await api('GET', '/api/monday/schedule', { token });
  assert.equal(scheduleAuth.status, 200);
  for (const run of scheduleAuth.body.lastRuns || []) {
    assert.equal(run.requestedBy, undefined, 'nome de solicitante não deve ser exposto');
    for (const m of run.modules || []) assert.equal(m.error, undefined, 'mensagem de erro de sincronização não deve ser exposta');
  }
});

// ============================================================================================
// Rodada 4 de correções de segurança — testes de integração HTTP real
// ============================================================================================

// --- Item 1: Visão Executiva restrita a alçada global ---

test('[HTTP] colaborador/líder não executivo não acessa o dashboard executivo', async () => {
  const tokenColaborador = await loginAs(EMAILS.colaboradorJuridico);
  const asColaborador = await api('GET', '/api/dashboards/executive', { token: tokenColaborador });
  assert.equal(asColaborador.status, 403);

  const tokenLider = await loginAs(EMAILS.liderJuridico);
  const asLider = await api('GET', '/api/dashboards/executive', { token: tokenLider });
  assert.equal(asLider.status, 403, 'lider tem módulo central, mas não é alçada global — não basta para o executivo');

  // Também não deve aparecer listado em GET /api/dashboards para papel não-global
  const list = await api('GET', '/api/dashboards', { token: tokenLider });
  assert.equal(list.status, 200);
  assert.ok(!list.body.dashboards.some(d => d.id === 'executive'), 'dashboard executivo não deve nem ser listado para papel não-global');
});

test('[HTTP] dashboard executivo continua acessível à alçada global autorizada', async () => {
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const res = await api('GET', '/api/dashboards/executive', { token: tokenDiretoria });
  assert.equal(res.status, 200);
  assert.equal(res.body.dashboard.id, 'executive');

  const list = await api('GET', '/api/dashboards', { token: tokenDiretoria });
  assert.ok(list.body.dashboards.some(d => d.id === 'executive'), 'diretoria continua vendo o executivo na listagem');
});

// --- Item 2: mass assignment em sub-recursos de projeto ---

test('[HTTP] POST de sub-recurso de Projeto não aceita id/projectId/createdBy/createdAt forjados', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', `/api/projects/${PROJECT_ID}/actions`, {
    token,
    json: {
      id: 'id-forjado', projectId: 'outro-projeto-forjado', createdAt: '2000-01-01T00:00:00.000Z', createdBy: 'Invasor',
      title: 'Ação legítima de teste rodada 4'
    }
  });
  assert.equal(res.status, 201);
  assert.notEqual(res.body.id, 'id-forjado');
  assert.equal(res.body.projectId, PROJECT_ID, 'o resultado continua vinculado ao projeto da URL, não ao projectId forjado');
  assert.notEqual(res.body.createdBy, 'Invasor');
  assert.equal(res.body.createdBy, 'usr-teste-lider-juridico');
  assert.notEqual(res.body.createdAt, '2000-01-01T00:00:00.000Z');
  assert.equal(res.body.title, 'Ação legítima de teste rodada 4');
});

// --- Item 3: Comitês respeitam escopo ---

test('[HTTP] Comitê Jurídico não vaza para TI, e Comitê TI não vaza para Jurídico', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const tokenTi = await loginAs(EMAILS.liderTi);

  const committeeJuridico = await api('POST', '/api/committees', { token: tokenJuridico, json: { title: 'Comitê Jurídico de teste' } });
  assert.equal(committeeJuridico.status, 201);
  assert.equal(committeeJuridico.body.department, 'Jurídico');

  const committeeTi = await api('POST', '/api/committees', { token: tokenTi, json: { title: 'Comitê TI de teste' } });
  assert.equal(committeeTi.status, 201);
  assert.equal(committeeTi.body.department, 'TI');

  const listAsJuridico = await api('GET', '/api/committees', { token: tokenJuridico });
  assert.ok(listAsJuridico.body.some(c => c.id === committeeJuridico.body.id), 'Jurídico vê o próprio comitê');
  assert.ok(!listAsJuridico.body.some(c => c.id === committeeTi.body.id), 'Comitê TI não pode vazar para Jurídico');

  const listAsTi = await api('GET', '/api/committees', { token: tokenTi });
  assert.ok(listAsTi.body.some(c => c.id === committeeTi.body.id), 'TI vê o próprio comitê');
  assert.ok(!listAsTi.body.some(c => c.id === committeeJuridico.body.id), 'Comitê Jurídico não pode vazar para TI');

  // scopeType/companyId/speId não podem ser forjados por papel departamental também em /api/committees
  const forged = await api('POST', '/api/committees', { token: tokenJuridico, json: { title: 'Tentativa de forjar escopo', scopeType: 'global', companyId: 'empresa-forjada' } });
  assert.equal(forged.status, 201);
  assert.notEqual(forged.body.scopeType, 'global');
  assert.equal(forged.body.companyId, undefined);
  const listAsTiAfterForge = await api('GET', '/api/committees', { token: tokenTi });
  assert.ok(!listAsTiAfterForge.body.some(c => c.id === forged.body.id), 'tentativa de forjar scopeType:global não deve vazar o comitê do Jurídico para a TI');
});

// --- Item 4: agenda não aceita escopo global forjado ---

test('[HTTP] agenda não aceita scopeType/companyId/speId forjados por usuário departamental', async () => {
  const token = await loginAs(EMAILS.colaboradorJuridico);
  const created = await api('POST', '/api/agenda', { token, json: { title: 'Evento com escopo forjado', scopeType: 'global', companyId: 'empresa-forjada', speId: 'spe-forjada' } });
  assert.equal(created.status, 201);
  assert.notEqual(created.body.scopeType, 'global');
  assert.equal(created.body.companyId, undefined);
  assert.equal(created.body.speId, undefined);
  assert.equal(created.body.department, 'Jurídico');

  const tokenTi = await loginAs(EMAILS.liderTi);
  const listAsTi = await api('GET', '/api/agenda', { token: tokenTi });
  assert.ok(!listAsTi.body.some(item => item.id === created.body.id), 'tentativa de forjar scopeType:global não pode vazar o evento do Jurídico para a TI');
});

// --- Item 5: importação de orçamento respeita escopo ---

test('[HTTP] importação de orçamento bloqueia linha de outro departamento para usuário não-global', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const csvMisto = 'department,competence,budgeted,planned,committed,realized\nJurídico,2026-09,100,80,0,50\nTI,2026-09,200,150,0,100';
  const misto = await api('POST', '/api/budgets/import/commit', { token: tokenJuridico, json: { csv: csvMisto } });
  assert.equal(misto.status, 403, 'CSV com linha de outro departamento deve bloquear a operação inteira, nunca importar parcialmente');

  const csvProprio = 'department,competence,budgeted,planned,committed,realized\nJurídico,2026-09,100,80,0,50';
  const proprio = await api('POST', '/api/budgets/import/commit', { token: tokenJuridico, json: { csv: csvProprio } });
  assert.equal(proprio.status, 201, 'CSV só com o próprio departamento deve ser aceito normalmente');

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const comoDiretoria = await api('POST', '/api/budgets/import/commit', { token: tokenDiretoria, json: { csv: csvMisto } });
  assert.equal(comoDiretoria.status, 201, 'papel com alçada global continua podendo importar múltiplos departamentos');
});

// --- Itens 6, 8-11: Legal Deadline — validação semântica e herança de escopo ---

test('[HTTP] Legal Deadline rejeita origin em branco (POST e PATCH)', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const semOrigem = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: '   ', date: '2026-12-01' } });
  assert.equal(semOrigem.status, 422, 'origin só com espaços deve ser rejeitado, não apenas origin ausente');

  const valido = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem válida rodada 4', date: '2026-12-01' } });
  assert.equal(valido.status, 201);
  const patchVazio = await api('PATCH', `/api/entities/legalDeadlines/${valido.body.id}`, { token, json: { origin: '   ' } });
  assert.equal(patchVazio.status, 422, 'PATCH também rejeita origin só com espaços');
});

test('[HTTP] Legal Deadline rejeita data inválida — "banana", espaço, e "2026-99-99" (POST e PATCH)', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  for (const badDate of ['banana', ' ', '2026-99-99', '']) {
    const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste data inválida', date: badDate } });
    assert.equal(res.status, 422, `date="${badDate}" deveria ser rejeitado`);
  }

  const valido = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem para PATCH de data inválida', date: '2026-12-05' } });
  assert.equal(valido.status, 201);
  for (const badDate of ['banana', '2026-99-99']) {
    const patch = await api('PATCH', `/api/entities/legalDeadlines/${valido.body.id}`, { token, json: { date: badDate } });
    assert.equal(patch.status, 422, `PATCH com date="${badDate}" deveria ser rejeitado`);
  }
});

test('[HTTP] Legal Deadline herda o escopo (department/companyId/speId/scopeType) do processo relacionado, mesmo para diretoria', async () => {
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  // Diretoria tenta forjar department:'TI' e scopeType:'global' num prazo ligado a um processo do Jurídico
  const created = await api('POST', '/api/entities/legalDeadlines', {
    token: tokenDiretoria,
    json: { processId: 'proc-juridico-teste', origin: 'Teste herança de escopo', date: '2026-12-10', department: 'TI', scopeType: 'global', companyId: 'empresa-forjada' }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.department, 'Jurídico', 'department deve ser herdado do processo relacionado, nunca escolhido livremente — nem por diretoria');
  assert.equal(created.body.scopeType, undefined, 'processo de teste não tem scopeType — o prazo também não deve ter');
  assert.equal(created.body.companyId, undefined, 'processo de teste não tem companyId — o prazo também não deve ter, mesmo forjado por diretoria');

  // Ao trocar processId (diretoria tem escopo global, alcança processo de outro departamento), o
  // escopo herdado deve mudar de acordo com o NOVO processo relacionado.
  const patched = await api('PATCH', `/api/entities/legalDeadlines/${created.body.id}`, { token: tokenDiretoria, json: { processId: 'proc-ti-teste' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.department, 'TI', 'ao trocar processId, o escopo herdado deve refletir o novo processo relacionado');
});

// --- Item 12: papel desconhecido/sem módulo Projetos não opera sub-recursos ---

test('[HTTP] papel desconhecido sem módulo Projetos não consegue criar/alterar/arquivar/restaurar/decidir/configurar nada em Projetos, mesmo com department:"Jurídico"', async () => {
  const token = await loginAs(EMAILS.semAcesso); // role:'externo', department:'Jurídico' — ver comentário no seed
  assert.equal((await api('GET', '/api/projects', { token })).status, 403, 'nem sequer a listagem de projetos é permitida');
  assert.equal((await api('POST', `/api/projects/${PROJECT_ID}/actions`, { token, json: { title: 'Tentativa indevida' } })).status, 403);
  assert.equal((await api('PUT', `/api/projects/${PROJECT_ID}/target`, { token, json: { indicatorId: 'qualquer' } })).status, 403);
  assert.equal((await api('PUT', `/api/projects/${PROJECT_ID}/approval-rules`, { token, json: { levels: [] } })).status, 403);
  assert.equal((await api('PUT', `/api/projects/${PROJECT_ID}/recovery-settings`, { token, json: {} })).status, 403);

  // Semeia um item legítimo diretamente na store para testar PATCH/DELETE/restore/decisão sem
  // depender de um POST bem-sucedido (que já é negado acima).
  const store = readStore();
  const syntheticActionId = 'pac-sem-acesso-teste';
  store.projectActions.push({ id: syntheticActionId, projectId: PROJECT_ID, title: 'Ação sintética', status: 'Não iniciado', createdAt: new Date().toISOString(), createdBy: 'seed' });
  // Ação separada, já arquivada, exclusivamente para o teste de /restore — a rota de restore só
  // encontra itens com `deletedAt` presente; usar a mesma ação do teste de DELETE acima exigiria que o
  // DELETE tivesse sucesso primeiro (o que o próprio teste prova que NÃO deve acontecer).
  const syntheticArchivedActionId = 'pac-sem-acesso-teste-arquivada';
  store.projectActions.push({ id: syntheticArchivedActionId, projectId: PROJECT_ID, title: 'Ação sintética arquivada', status: 'Não iniciado', createdAt: new Date().toISOString(), createdBy: 'seed', deletedAt: new Date().toISOString(), deletedBy: 'seed' });
  const syntheticManagementItemId = 'pmi-sem-acesso-teste';
  store.projectManagementItems.push({ id: syntheticManagementItemId, projectId: PROJECT_ID, title: 'Pendência sintética', status: 'Pendente', createdAt: new Date().toISOString(), createdBy: 'seed' });
  writeStore(store);

  assert.equal((await api('PATCH', `/api/projects/${PROJECT_ID}/actions/${syntheticActionId}`, { token, json: { title: 'Alterado indevidamente' } })).status, 403);
  assert.equal((await api('DELETE', `/api/projects/${PROJECT_ID}/actions/${syntheticActionId}`, { token })).status, 403);
  assert.equal((await api('POST', `/api/projects/${PROJECT_ID}/actions/${syntheticArchivedActionId}/restore`, { token })).status, 403);
  assert.equal((await api('POST', `/api/projects/${PROJECT_ID}/management-items/${syntheticManagementItemId}/approve`, { token })).status, 403);
  assert.equal((await api('POST', `/api/projects/${PROJECT_ID}/management-items/${syntheticManagementItemId}/escalate`, { token })).status, 403, 'nem mesmo escalate (que não checava projectPermissions.approveAgreement) deve passar para papel sem módulo Projetos');
});
