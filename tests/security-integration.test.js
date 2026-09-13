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
  diretoria: 'juridico@coevoconstrutora.com.br',
  // Rodada 5, item 3: administrador técnico — modules:['*']/actions:['*'] (gestão de sistema/
  // integrações), mas scopes:[] (não é alçada de negócio global; não pode ser superusuário de conteúdo).
  administrador: 'administrador.teste@coevo.local',
  // Sprint 2, Fase 4B — usuários dedicados aos testes de responsibleUserId/Minha Semana: um responsável
  // ativo comum e um usuário já INATIVO (deletedAt preenchido no seed) para os testes de "nova
  // atribuição a usuário inativo".
  responsavelAtivo: 'responsavel.ativo.teste@coevo.local',
  responsavelInativo: 'responsavel.inativo.teste@coevo.local'
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
    { id: 'usr-teste-sem-acesso', name: 'Sem Acesso Teste', email: EMAILS.semAcesso, role: 'externo', department: 'Jurídico', mfa: false },
    // Rodada 5, item 3 — administrador técnico, sem department (papel de sistema, não de negócio).
    { id: 'usr-teste-administrador', name: 'Administrador Técnico Teste', email: EMAILS.administrador, role: 'administrador', department: null, mfa: true },
    // Sprint 2, Fase 4B: responsável ativo comum (para atribuição/reatribuição de Legal Deadline e
    // para logar e ter sua própria Minha Semana testada).
    { id: 'usr-teste-responsavel-ativo', name: 'Responsável Ativo Teste', email: EMAILS.responsavelAtivo, role: 'colaborador', department: 'Jurídico', mfa: false },
    // Usuário JÁ inativo no seed (deletedAt preenchido) — reaproveita a mesma convenção de soft-delete
    // usada em toda a plataforma para representar "usuário não mais válido" (D4.2/D4.3/D4.11).
    { id: 'usr-teste-responsavel-inativo', name: 'Responsável Inativo Teste', email: EMAILS.responsavelInativo, role: 'colaborador', department: 'Jurídico', mfa: false, deletedAt: '2026-01-01T00:00:00.000Z', deletedBy: 'Teste' }
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
    json: { processId: 'proc-juridico-teste', origin: 'Intimação eletrônica (teste)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' }
  });
  assert.equal(created.status, 201);
  const deadlineId = created.body.id;
  assert.equal(created.body.department, 'Jurídico', 'registro criado por papel departamental herda o department do próprio usuário');

  // TI não deve nem ver este registro na coleção — desde a rodada 6 (item 1), o isolamento
  // Jurídico x TI é transversal: allowedInDepartment() nega TI no próprio gate de módulo do CRUD
  // genérico (403), não apenas por filtragem de scoped() (o que antes resultava em 200 com lista vazia).
  const listAsTi = await api('GET', '/api/entities/legalDeadlines', { token: tokenTi });
  assert.equal(listAsTi.status, 403, 'líder de TI é negado no próprio gate de módulo departamental para um tipo jurídico (rodada 6, item 1), não apenas filtrado');

  // ...nem alterar por ID direto — mesma negação transversal, agora também 403 (não mais 404 via scoped()).
  const patchAsTi = await api('PATCH', `/api/entities/legalDeadlines/${deadlineId}`, { token: tokenTi, json: { origin: 'Alterado indevidamente' } });
  assert.equal(patchAsTi.status, 403, 'PATCH por módulo departamental de outro departamento é negado no gate de módulo (rodada 6, item 1)');

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
      processId: 'proc-juridico-teste', origin: 'Intimação eletrônica (teste)', date: '2026-12-05', originType: 'JUDICIAL_PROCESSUAL'
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
    token, json: { processId: 'proc-juridico-teste', origin: 'Origem original (teste)', date: '2026-12-10', originType: 'JUDICIAL_PROCESSUAL' }
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

test('[HTTP] Legal Deadline sem origem/processId/date/originType é rejeitado com 422', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const semOrigem = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(semOrigem.status, 422);
  const semProcesso = await api('POST', '/api/entities/legalDeadlines', { token, json: { origin: 'Teste', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(semProcesso.status, 422);
  const semData = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(semData.status, 422);
  // Sprint 2, Fase 1 (D1.3 homologada): originType passa a ser obrigatório na mesma classe de
  // validação — ausência, null, string vazia ou valor fora do enum são todos rejeitados com 422.
  const semOriginType = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste', date: '2026-12-01' } });
  assert.equal(semOriginType.status, 422, 'originType ausente deve ser rejeitado');
});

test('[HTTP] Legal Deadline com processId inexistente é rejeitado com 422', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'processo-que-nao-existe', origin: 'Teste', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(res.status, 422);
});

test('[HTTP] Legal Deadline apontando para processo fora do escopo do usuário é rejeitado com 403, nunca criado', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-ti-teste', origin: 'Teste', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
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
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste scopeType', date: '2026-12-15', scopeType: 'global', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  assert.notEqual(created.body.scopeType, 'global', 'scopeType não pode ser definido por papel departamental na criação');

  const patch = await api('PATCH', `/api/entities/legalDeadlines/${created.body.id}`, { token, json: { scopeType: 'global' } });
  assert.equal(patch.status, 200);
  assert.notEqual(patch.body.scopeType, 'global', 'scopeType não pode ser definido por papel departamental via PATCH');

  // Prova que a tentativa de forjar scopeType:'global' realmente não teve efeito: TI continua sem
  // enxergar o registro do Jurídico — desde a rodada 6 (item 1), líder de TI é negado no próprio gate
  // de módulo departamental para um tipo jurídico (403), antes mesmo de chegar a scoped().
  const tokenTi = await loginAs(EMAILS.liderTi);
  const listAsTi = await api('GET', '/api/entities/legalDeadlines', { token: tokenTi });
  assert.equal(listAsTi.status, 403, 'líder de TI é negado no gate de módulo departamental, não apenas filtrado por scoped()');
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
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem válida', date: '2026-12-25', originType: 'JUDICIAL_PROCESSUAL' } });
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
  const semOrigem = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: '   ', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(semOrigem.status, 422, 'origin só com espaços deve ser rejeitado, não apenas origin ausente');

  const valido = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem válida rodada 4', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(valido.status, 201);
  const patchVazio = await api('PATCH', `/api/entities/legalDeadlines/${valido.body.id}`, { token, json: { origin: '   ' } });
  assert.equal(patchVazio.status, 422, 'PATCH também rejeita origin só com espaços');
});

test('[HTTP] Legal Deadline rejeita data inválida — "banana", espaço, e "2026-99-99" (POST e PATCH)', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  for (const badDate of ['banana', ' ', '2026-99-99', '']) {
    const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste data inválida', date: badDate, originType: 'JUDICIAL_PROCESSUAL' } });
    assert.equal(res.status, 422, `date="${badDate}" deveria ser rejeitado`);
  }

  const valido = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem para PATCH de data inválida', date: '2026-12-05', originType: 'JUDICIAL_PROCESSUAL' } });
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
    json: { processId: 'proc-juridico-teste', origin: 'Teste herança de escopo', date: '2026-12-10', department: 'TI', scopeType: 'global', companyId: 'empresa-forjada', originType: 'JUDICIAL_PROCESSUAL' }
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

// ============================================================================================
// Rodada 5 de correções de segurança — testes de integração HTTP real
// ============================================================================================

// --- Item 1: isolamento de módulo Jurídico x TI nas rotas de Monday (sem scoped() por registro) ---

test('[HTTP] líder de TI recebe 403 nas rotas de Monday (módulo Jurídico), mesmo tendo o módulo "juridico" em ROLES', async () => {
  const tokenTi = await loginAs(EMAILS.liderTi);
  assert.equal((await api('GET', '/api/monday/status', { token: tokenTi })).status, 403, 'líder de TI não pode operar rota jurídica de Monday');
  assert.equal((await api('GET', '/api/monday/schedule', { token: tokenTi })).status, 403);
  assert.equal((await api('POST', '/api/monday/test', { token: tokenTi })).status, 403);
  assert.equal((await api('POST', '/api/monday/sync', { token: tokenTi })).status, 403);
});

test('[HTTP] líder Jurídico continua acessando as rotas de Monday (fonte oficial do próprio módulo)', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  assert.equal((await api('GET', '/api/monday/status', { token: tokenJuridico })).status, 200);
  assert.equal((await api('GET', '/api/monday/schedule', { token: tokenJuridico })).status, 200);
});

test('[HTTP] líder Jurídico recebe 403 em rota TI equivalente (dashboard departamental de TI)', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const asJuridico = await api('GET', '/api/dashboards/ti', { token: tokenJuridico });
  assert.equal(asJuridico.status, 403, 'líder Jurídico não pode acessar o dashboard departamental de TI, mesmo tendo o módulo "ti" em ROLES');

  const tokenTi = await loginAs(EMAILS.liderTi);
  const asTi = await api('GET', '/api/dashboards/ti', { token: tokenTi });
  assert.equal(asTi.status, 200, 'líder de TI continua acessando o próprio dashboard departamental');
});

test('[HTTP] diretoria (alçada global) continua acessando rotas de Monday e dashboard de TI', async () => {
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  assert.equal((await api('GET', '/api/monday/status', { token: tokenDiretoria })).status, 200);
  assert.equal((await api('GET', '/api/monday/schedule', { token: tokenDiretoria })).status, 200);
  assert.equal((await api('GET', '/api/dashboards/ti', { token: tokenDiretoria })).status, 200);
});

// --- Item 2: dashboards corporativos (scope:'corporate') exigem alçada global por padrão ---

test('[HTTP] líder departamental não acessa dashboard corporativo "budget", e ele não aparece na listagem', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const res = await api('GET', '/api/dashboards/budget', { token: tokenJuridico });
  assert.equal(res.status, 403, 'dashboard corporativo (scope:"corporate") exige alçada global, mesmo com o módulo "orcamento" concedido ao líder');

  const list = await api('GET', '/api/dashboards', { token: tokenJuridico });
  assert.equal(list.status, 200);
  assert.ok(!list.body.dashboards.some(d => d.id === 'budget'), 'dashboard corporativo não deve nem ser listado para papel não-global');
});

test('[HTTP] diretoria (alçada global) continua acessando o dashboard corporativo "budget"', async () => {
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const res = await api('GET', '/api/dashboards/budget', { token: tokenDiretoria });
  assert.equal(res.status, 200);
  assert.equal(res.body.dashboard.id, 'budget');

  const list = await api('GET', '/api/dashboards', { token: tokenDiretoria });
  assert.ok(list.body.dashboards.some(d => d.id === 'budget'), 'diretoria continua vendo o dashboard corporativo na listagem');
});

test('[HTTP] dashboards departamentais (legal/ti) continuam funcionando normalmente para o departamento correspondente', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const legal = await api('GET', '/api/dashboards/legal', { token: tokenJuridico });
  assert.equal(legal.status, 200, 'dashboard departamental (scope:"department") não exige alçada global');

  const tokenTi = await loginAs(EMAILS.liderTi);
  const ti = await api('GET', '/api/dashboards/ti', { token: tokenTi });
  assert.equal(ti.status, 200);
});

// --- Item 3: administrador técnico não é superusuário de conteúdo ---

test('[HTTP] administrador técnico não acessa conteúdo jurídico automaticamente, apesar de ter modules:[\'*\']', async () => {
  const tokenAdministrador = await loginAs(EMAILS.administrador);
  const res = await api('GET', '/api/legal/processos', { token: tokenAdministrador });
  assert.equal(res.status, 200, 'administrador passa no gate de módulo (gestão técnica de integrações)');
  assert.deepEqual(res.body.records, [], 'mas nenhum registro departamental é retornado — administrador não tem alçada de conteúdo (scoped() nega por ausência de escopo global)');
});

test('[HTTP] diretoria (alçada global) continua acessando conteúdo jurídico normalmente', async () => {
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const res = await api('GET', '/api/legal/processos', { token: tokenDiretoria });
  assert.equal(res.status, 200);
  assert.ok(res.body.records.length > 0, 'diretoria continua vendo os processos do Jurídico normalmente');
});

// --- Item 4: internalizations.processId valida fonte (Monday) e escopo ---

test('[HTTP] internalization com processId de processo manual/não-Monday é rejeitada com 422', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', `/api/projects/${PROJECT_ID}/internalizations`, {
    token: tokenJuridico,
    json: { processId: 'proc-falso-nao-monday', title: 'Internalização de teste' }
  });
  assert.equal(res.status, 422, 'processo sem source:"monday" não é uma fonte autorizada do piloto');
});

test('[HTTP] internalization com processId fora do escopo do usuário é rejeitada com 403', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', `/api/projects/${PROJECT_ID}/internalizations`, {
    token: tokenJuridico,
    json: { processId: 'proc-ti-teste', title: 'Internalização de teste fora de escopo' }
  });
  assert.equal(res.status, 403, 'processo do Monday, mas de outro departamento, não pode ser relacionado por usuário sem escopo sobre ele');
});

test('[HTTP] internalization com processId válido (Monday, no escopo do usuário) continua funcionando', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', `/api/projects/${PROJECT_ID}/internalizations`, {
    token: tokenJuridico,
    json: { processId: 'proc-juridico-teste', title: 'Internalização legítima de teste' }
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.processId, 'proc-juridico-teste');
});

// --- Item 5: dashboard-preferences herda a autorização do dashboard ---

test('[HTTP] líder não configura preferência de dashboard executivo nem do corporativo "budget"', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  assert.equal((await api('GET', '/api/dashboard-preferences/executive', { token: tokenJuridico })).status, 403);
  assert.equal((await api('PUT', '/api/dashboard-preferences/executive', { token: tokenJuridico, json: { density: 'compact' } })).status, 403);
  assert.equal((await api('GET', '/api/dashboard-preferences/budget', { token: tokenJuridico })).status, 403);
  assert.equal((await api('PUT', '/api/dashboard-preferences/budget', { token: tokenJuridico, json: { density: 'compact' } })).status, 403);
});

test('[HTTP] diretoria consegue ler e gravar preferência de dashboard executivo e do corporativo "budget"', async () => {
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  assert.equal((await api('GET', '/api/dashboard-preferences/executive', { token: tokenDiretoria })).status, 200);
  const put = await api('PUT', '/api/dashboard-preferences/executive', { token: tokenDiretoria, json: { density: 'compact' } });
  assert.equal(put.status, 200);
  assert.equal(put.body.density, 'compact');
  assert.equal((await api('GET', '/api/dashboard-preferences/budget', { token: tokenDiretoria })).status, 200);
});

test('[HTTP] preferência de dashboard departamental permitido continua funcionando para o departamento correspondente', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const get = await api('GET', '/api/dashboard-preferences/legal', { token: tokenJuridico });
  assert.equal(get.status, 200);
  const put = await api('PUT', '/api/dashboard-preferences/legal', { token: tokenJuridico, json: { density: 'compact' } });
  assert.equal(put.status, 200);
  assert.equal(put.body.density, 'compact');

  const tokenTi = await loginAs(EMAILS.liderTi);
  assert.equal((await api('GET', '/api/dashboard-preferences/legal', { token: tokenTi })).status, 403, 'TI não pode configurar preferência do dashboard departamental do Jurídico');
});

// ============================================================================================
// Rodada 6 de correções de segurança — testes de integração HTTP real
// ============================================================================================

// --- Item 1: isolamento Jurídico x TI transversal ao CRUD genérico de entidades e /api/legal ---

test('[HTTP] líder de TI recebe 403 ao tentar criar um registro jurídico via motor genérico de entidades', async () => {
  const tokenTi = await loginAs(EMAILS.liderTi);
  const res = await api('POST', '/api/entities/documentReferences', { token: tokenTi, json: { title: 'Referência de teste' } });
  assert.equal(res.status, 403, 'líder de TI não pode criar conteúdo jurídico só porque `lider` também tem o módulo "juridico" em ROLES');
});

test('[HTTP] líder de TI recebe 403 em GET /api/legal/processos (não apenas uma listagem vazia)', async () => {
  const tokenTi = await loginAs(EMAILS.liderTi);
  const res = await api('GET', '/api/legal/processos', { token: tokenTi });
  assert.equal(res.status, 403, 'líder de TI é negado no próprio gate de módulo departamental, antes de scoped() filtrar qualquer registro');
});

test('[HTTP] líder Jurídico recebe 403 no módulo TI equivalente (dashboard departamental de TI) — não existe ainda tipo de entidade mapeado para "ti" em ENTITY_MODULE_MAP', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const res = await api('GET', '/api/dashboards/ti', { token: tokenJuridico });
  assert.equal(res.status, 403, 'líder Jurídico não pode acessar o equivalente departamental de TI, mesmo tendo o módulo "ti" em ROLES');
});

test('[HTTP] diretoria (alçada global) continua acessando /api/legal/processos e criando conteúdo jurídico normalmente', async () => {
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const legal = await api('GET', '/api/legal/processos', { token: tokenDiretoria });
  assert.equal(legal.status, 200);
  assert.ok(legal.body.records.length > 0);
  const created = await api('POST', '/api/entities/documentReferences', { token: tokenDiretoria, json: { title: 'Referência de teste diretoria' } });
  assert.equal(created.status, 201);
});

// --- Item 2: administrador técnico não pode acessar dashboards de conteúdo (departamentais) ---

test('[HTTP] administrador técnico recebe 403 em dashboards departamentais (legal/ti), e eles não aparecem na listagem', async () => {
  const tokenAdministrador = await loginAs(EMAILS.administrador);
  assert.equal((await api('GET', '/api/dashboards/legal', { token: tokenAdministrador })).status, 403, 'administrador não tem department — não pode acessar dashboard departamental Jurídico');
  assert.equal((await api('GET', '/api/dashboards/ti', { token: tokenAdministrador })).status, 403, 'idem para o dashboard departamental de TI');

  const list = await api('GET', '/api/dashboards', { token: tokenAdministrador });
  assert.equal(list.status, 200);
  assert.ok(!list.body.dashboards.some(d => d.id === 'legal'), 'dashboard departamental Jurídico não deve aparecer na listagem do administrador');
  assert.ok(!list.body.dashboards.some(d => d.id === 'ti'), 'dashboard departamental de TI não deve aparecer na listagem do administrador');
});

test('[HTTP] administrador técnico recebe 403 em dashboard-preferences de dashboard departamental (legal)', async () => {
  const tokenAdministrador = await loginAs(EMAILS.administrador);
  assert.equal((await api('GET', '/api/dashboard-preferences/legal', { token: tokenAdministrador })).status, 403);
  assert.equal((await api('PUT', '/api/dashboard-preferences/legal', { token: tokenAdministrador, json: { density: 'compact' } })).status, 403);
});

test('[HTTP] líder Jurídico, líder de TI e diretoria continuam acessando seus dashboards departamentais normalmente', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  assert.equal((await api('GET', '/api/dashboards/legal', { token: tokenJuridico })).status, 200);
  const tokenTi = await loginAs(EMAILS.liderTi);
  assert.equal((await api('GET', '/api/dashboards/ti', { token: tokenTi })).status, 200);
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  assert.equal((await api('GET', '/api/dashboards/legal', { token: tokenDiretoria })).status, 200);
  assert.equal((await api('GET', '/api/dashboards/ti', { token: tokenDiretoria })).status, 200);
});

// --- Item 3: administrador técnico não pode criar/alterar conteúdo de negócio ---

test('[HTTP] administrador técnico recebe 403 ao tentar criar conteúdo de negócio (agenda, comitês, entidade jurídica, sub-recurso de projeto)', async () => {
  const tokenAdministrador = await loginAs(EMAILS.administrador);
  assert.equal((await api('POST', '/api/agenda', { token: tokenAdministrador, json: { title: 'Evento de teste administrador' } })).status, 403, 'administrador não pode criar agenda — conteúdo de negócio, não função técnica');
  assert.equal((await api('POST', '/api/committees', { token: tokenAdministrador, json: { title: 'Comitê de teste administrador' } })).status, 403);
  assert.equal((await api('POST', '/api/entities/documentReferences', { token: tokenAdministrador, json: { title: 'Referência de teste administrador' } })).status, 403);
  // scoped(user,project) é avaliado ANTES do gate de módulo/conteúdo nas rotas de sub-recurso de
  // projeto (mesmo padrão de "erro de permissão nunca revela existência de registro restrito" já usado
  // em outras rotas) — como administrador não tem alçada global nem department, nunca está no escopo de
  // nenhum projeto, e a rota nega com 404 antes mesmo de chegar a allowedContent(). O resultado prático
  // é o mesmo pedido (administrador não consegue criar o registro), só o código HTTP muda.
  assert.equal((await api('POST', `/api/projects/${PROJECT_ID}/actions`, { token: tokenAdministrador, json: { title: 'Ação de teste administrador' } })).status, 404, 'administrador não pode criar conteúdo de projeto (negado por escopo antes do gate de conteúdo)');
});

test('[HTTP] administrador técnico continua podendo executar funções técnicas legítimas (auditoria, aprovação de cadastro)', async () => {
  const tokenAdministrador = await loginAs(EMAILS.administrador);
  assert.equal((await api('GET', '/api/audit', { token: tokenAdministrador })).status, 200, 'auditoria é função técnica de sistema, não conteúdo de negócio');
  assert.equal((await api('GET', '/api/auth/requests', { token: tokenAdministrador })).status, 200, 'aprovação de cadastro continua sendo função técnica de administrador');
});

// --- Item 4: PATCH de internalizations revalida processId (fonte Monday + escopo) ---

test('[HTTP] PATCH de internalization para processo manual/não-Monday é rejeitado com 422, sem alterar o registro', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', `/api/projects/${PROJECT_ID}/internalizations`, { token: tokenJuridico, json: { processId: 'proc-juridico-teste', title: 'Internalização válida rodada 6' } });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const patchManual = await api('PATCH', `/api/projects/${PROJECT_ID}/internalizations/${id}`, { token: tokenJuridico, json: { processId: 'proc-falso-nao-monday' } });
  assert.equal(patchManual.status, 422);

  const patchInexistente = await api('PATCH', `/api/projects/${PROJECT_ID}/internalizations/${id}`, { token: tokenJuridico, json: { processId: 'processo-que-nao-existe' } });
  assert.equal(patchInexistente.status, 422);

  const patchForaDeEscopo = await api('PATCH', `/api/projects/${PROJECT_ID}/internalizations/${id}`, { token: tokenJuridico, json: { processId: 'proc-ti-teste' } });
  assert.equal(patchForaDeEscopo.status, 403, 'processo do Monday mas de outro departamento não pode ser relacionado via PATCH');

  // Nenhuma das tentativas inválidas deve ter alterado o processId gravado.
  const listAfterInvalid = await api('GET', `/api/projects/${PROJECT_ID}`, { token: tokenJuridico });
  const stillValid = (listAfterInvalid.body.internalizations || listAfterInvalid.body.recoveryCases || []).find(item => item.id === id);
  if (stillValid) assert.equal(stillValid.processId, 'proc-juridico-teste', 'tentativas inválidas de PATCH não podem ter alterado o processId gravado');

  const patchValido = await api('PATCH', `/api/projects/${PROJECT_ID}/internalizations/${id}`, { token: tokenJuridico, json: { title: 'Internalização atualizada legitimamente' } });
  assert.equal(patchValido.status, 200, 'PATCH legítimo preservando o processId válido continua funcionando');
  assert.equal(patchValido.body.processId, 'proc-juridico-teste');
  assert.equal(patchValido.body.title, 'Internalização atualizada legitimamente');
});

// ============================================================================================
// Rodada 7 de correções de segurança — testes de integração HTTP real
// ============================================================================================

// --- Item 1: Compliance deny-by-default enquanto ADR-007 estiver pendente (nem administrador acessa) ---

test('[HTTP] administrador técnico recebe 403 em GET e POST /api/compliance', async () => {
  const tokenAdministrador = await loginAs(EMAILS.administrador);
  assert.equal((await api('GET', '/api/compliance', { token: tokenAdministrador })).status, 403, 'administrador não é autoridade de conteúdo de Compliance (política provisória até ADR-007)');
  assert.equal((await api('POST', '/api/compliance', { token: tokenAdministrador, json: { title: 'Entrada de teste administrador' } })).status, 403);
});

test('[HTTP] líder e colaborador departamentais recebem 403 em GET e POST /api/compliance', async () => {
  const tokenLider = await loginAs(EMAILS.liderJuridico);
  assert.equal((await api('GET', '/api/compliance', { token: tokenLider })).status, 403);
  assert.equal((await api('POST', '/api/compliance', { token: tokenLider, json: { title: 'Entrada de teste líder' } })).status, 403);

  const tokenColaborador = await loginAs(EMAILS.colaboradorJuridico);
  assert.equal((await api('GET', '/api/compliance', { token: tokenColaborador })).status, 403);
  assert.equal((await api('POST', '/api/compliance', { token: tokenColaborador, json: { title: 'Entrada de teste colaborador' } })).status, 403);
});

test('[HTTP] diretoria (alçada de negócio global) continua acessando GET e POST /api/compliance, sem mass assignment de id/responsible/createdAt', async () => {
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  assert.equal((await api('GET', '/api/compliance', { token: tokenDiretoria })).status, 200);
  const created = await api('POST', '/api/compliance', { token: tokenDiretoria, json: { id: 'id-forjado', responsible: 'Invasor', createdAt: '2000-01-01T00:00:00.000Z', title: 'Entrada legítima de diretoria' } });
  assert.equal(created.status, 201);
  assert.notEqual(created.body.id, 'id-forjado');
  assert.notEqual(created.body.responsible, 'Invasor');
  assert.notEqual(created.body.createdAt, '2000-01-01T00:00:00.000Z');
});

// --- Item 2: auditoria técnica não expõe before/after (conteúdo auditado) ao administrador ---

test('[HTTP] administrador técnico recebe 200 em GET /api/audit, mas sem before/after; diretoria recebe o evento completo', async () => {
  // Gera um evento de auditoria com before/after de conteúdo real (PATCH de Legal Deadline já audita).
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Origem para auditoria rodada 7', date: '2026-12-20', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  await api('PATCH', `/api/entities/legalDeadlines/${created.body.id}`, { token: tokenJuridico, json: { origin: 'Origem alterada para teste de auditoria' } });

  const tokenAdministrador = await loginAs(EMAILS.administrador);
  const asAdministrador = await api('GET', '/api/audit', { token: tokenAdministrador });
  assert.equal(asAdministrador.status, 200, 'auditoria é função técnica legítima do administrador');
  assert.ok(asAdministrador.body.length > 0);
  for (const event of asAdministrador.body) {
    assert.equal(event.before, undefined, 'administrador não pode ver o snapshot "before" do conteúdo auditado');
    assert.equal(event.after, undefined, 'administrador não pode ver o snapshot "after" do conteúdo auditado');
    assert.ok(event.action && event.entity && event.responsible && event.date, 'metadados técnicos continuam disponíveis para administrador');
  }

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const asDiretoria = await api('GET', '/api/audit', { token: tokenDiretoria });
  assert.equal(asDiretoria.status, 200);
  const patchEvent = asDiretoria.body.find(event => event.entityId === created.body.id && event.action === 'UPDATE');
  assert.ok(patchEvent, 'diretoria deve encontrar o evento de PATCH gerado acima');
  assert.ok(patchEvent.before, 'diretoria (alçada global) continua recebendo before do conteúdo auditado');
  assert.ok(patchEvent.after, 'diretoria (alçada global) continua recebendo after do conteúdo auditado');
});

test('[HTTP] usuário sem autorização de auditoria recebe 403 em GET /api/audit', async () => {
  const tokenLider = await loginAs(EMAILS.liderJuridico);
  assert.equal((await api('GET', '/api/audit', { token: tokenLider })).status, 403, 'líder não tem allowed(user,"*") — sem alçada de auditoria');
});

// ============================================================================================
// Sprint 2, Fase 1 — testes de integração HTTP real (D1 homologada: originType, status,
// reabertura, atraso derivado). Escopo estritamente limitado à Fase 1 — nenhuma correção de
// dashboard, Agenda/Atenção, Google Calendar ou cálculo automático de prazo nesta rodada.
// ============================================================================================

test('[HTTP] líder Jurídico cria Legal Deadline JUDICIAL_PROCESSUAL válido', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Intimação eletrônica Fase 1', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.originType, 'JUDICIAL_PROCESSUAL');
  assert.equal(res.body.status, 'ativo', 'status recebe o default server-side "ativo" quando não informado na criação');
});

test('[HTTP] líder Jurídico cria Legal Deadline INTERNAL_CONTROL válido', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Controle interno de acompanhamento', date: '2026-12-01', originType: 'INTERNAL_CONTROL' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.originType, 'INTERNAL_CONTROL');
});

test('[HTTP] POST sem originType é rejeitado com 422', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste', date: '2026-12-01' } });
  assert.equal(res.status, 422);
});

test('[HTTP] POST com originType fora do enum é rejeitado com 422', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste', date: '2026-12-01', originType: 'ALGO_INVALIDO' } });
  assert.equal(res.status, 422);
});

test('[HTTP] PATCH com originType fora do enum é rejeitado com 422, sem alterar o registro', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem válida Fase 1', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  const patch = await api('PATCH', `/api/entities/legalDeadlines/${created.body.id}`, { token, json: { originType: 'ALGO_INVALIDO' } });
  assert.equal(patch.status, 422);
  const list = await api('GET', '/api/entities/legalDeadlines', { token });
  const record = list.body.find(item => item.id === created.body.id);
  assert.equal(record.originType, 'JUDICIAL_PROCESSUAL', 'tentativa inválida de PATCH não pode ter alterado o originType gravado');
});

test('[HTTP] PATCH que tenta esvaziar originType é rejeitado com 422, sem alterar o registro', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem válida Fase 1b', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  const patch = await api('PATCH', `/api/entities/legalDeadlines/${created.body.id}`, { token, json: { originType: '' } });
  assert.equal(patch.status, 422);
  const list = await api('GET', '/api/entities/legalDeadlines', { token });
  const record = list.body.find(item => item.id === created.body.id);
  assert.equal(record.originType, 'JUDICIAL_PROCESSUAL', 'originType não pode ser esvaziado por PATCH');
});

test('[HTTP] POST com status fora do enum é rejeitado com 422', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'inexistente' } });
  assert.equal(res.status, 422);
});

test('[HTTP] POST com status "reaberto" é rejeitado com 422 — reabertura nunca é um status persistido', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'reaberto' } });
  assert.equal(res.status, 422);
});

test('[HTTP] PATCH com status fora do enum é rejeitado com 422, sem alterar o registro', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem válida Fase 1c', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  const patch = await api('PATCH', `/api/entities/legalDeadlines/${created.body.id}`, { token, json: { status: 'reaberto' } });
  assert.equal(patch.status, 422);
  const list = await api('GET', '/api/entities/legalDeadlines', { token });
  const record = list.body.find(item => item.id === created.body.id);
  assert.equal(record.status, 'ativo', 'status permanece "ativo" após tentativa inválida de PATCH');
});

test('[HTTP] PATCH para "suspenso" é aceito (200) e audita before/after; reabertura para "ativo" preserva o mesmo id, incrementa version e mantém o histórico', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Origem para reabertura', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.status, 'ativo');

  const suspended = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token: tokenJuridico, json: { status: 'suspenso', reason: 'Suspenso por acordo entre as partes' } });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.body.status, 'suspenso');
  assert.equal(suspended.body.id, id, 'suspensão preserva o mesmo id — nunca cria um registro novo');
  assert.equal(suspended.body.version, 2, 'version incrementa a cada alteração');

  // Diretoria (alçada global) consegue ver o evento de auditoria completo, incluindo before/after,
  // confirmando que o motivo (reason) e o ciclo anterior ficam preservados no histórico.
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const auditList = await api('GET', '/api/audit', { token: tokenDiretoria });
  const suspendEvent = auditList.body.find(event => event.entityId === id && event.after?.status === 'suspenso');
  assert.ok(suspendEvent, 'evento de auditoria da suspensão deve existir');
  assert.equal(suspendEvent.before.status, 'ativo', 'before preserva o status anterior à suspensão');
  assert.equal(suspendEvent.reason, 'Suspenso por acordo entre as partes', 'motivo da alteração é preservado no histórico');

  // Reabertura: retorna para "ativo", mantém o mesmo id, version incrementa novamente, e o ciclo
  // suspenso anterior continua recuperável no histórico de auditoria (nunca um status "reaberto").
  const reopened = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token: tokenJuridico, json: { status: 'ativo', reason: 'Reaberto após revogação do acordo' } });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.status, 'ativo');
  assert.equal(reopened.body.id, id, 'reabertura preserva o mesmo id — não é um registro novo');
  assert.equal(reopened.body.version, 3, 'version incrementa também na reabertura');

  const auditAfterReopen = await api('GET', '/api/audit', { token: tokenDiretoria });
  const reopenEvent = auditAfterReopen.body.find(event => event.entityId === id && event.reason === 'Reaberto após revogação do acordo');
  assert.ok(reopenEvent, 'evento de reabertura deve existir no histórico');
  assert.equal(reopenEvent.before.status, 'suspenso', 'histórico preserva que o ciclo anterior foi "suspenso" — nada desaparece');
  assert.equal(reopenEvent.after.status, 'ativo');
});

test('[HTTP] líder de TI recebe 403 ao tentar criar Legal Deadline', async () => {
  const token = await loginAs(EMAILS.liderTi);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-ti-teste', origin: 'Teste TI', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(res.status, 403, 'líder de TI não pode criar Legal Deadline — isolamento departamental preservado (allowedInDepartment/allowedContent)');
});

test('[HTTP] administrador técnico recebe 403 (ou 404) ao tentar criar Legal Deadline — não é superusuário de conteúdo', async () => {
  const token = await loginAs(EMAILS.administrador);
  const res = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Teste administrador', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.ok([403, 404].includes(res.status), `esperado 403 ou 404, recebido ${res.status}`);
});

test('[HTTP] acesso a Legal Deadline por ID fora do escopo do usuário é negado sem revelar existência/conteúdo', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Origem restrita ao Jurídico', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);

  const tokenTi = await loginAs(EMAILS.liderTi);
  const patchAsTi = await api('PATCH', `/api/entities/legalDeadlines/${created.body.id}`, { token: tokenTi, json: { status: 'cumprido' } });
  assert.equal(patchAsTi.status, 403, 'líder de TI é negado no gate de módulo departamental, nunca revela o conteúdo do registro');
});

test('[HTTP] Legal Deadline continua rejeitando processo manual/não-Monday e processo inexistente, mesmo com originType/status válidos', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const manual = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-falso-nao-monday', origin: 'Teste', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', status: 'ativo' } });
  assert.equal(manual.status, 422, 'processo sem source:"monday" continua rejeitado');
  const inexistente = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'processo-que-nao-existe', origin: 'Teste', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(inexistente.status, 422, 'processo inexistente continua rejeitado');
});

test('[HTTP] mass assignment continua bloqueado em Legal Deadline mesmo com originType/status no corpo da requisição', async () => {
  const token = await loginAs(EMAILS.colaboradorJuridico);
  const res = await api('POST', '/api/entities/legalDeadlines', {
    token,
    json: {
      id: 'id-forjado-fase1', version: 999, createdBy: 'Invasor', department: 'TI',
      processId: 'proc-juridico-teste', origin: 'Teste mass assignment Fase 1', date: '2026-12-01',
      originType: 'JUDICIAL_PROCESSUAL', status: 'ativo'
    }
  });
  assert.equal(res.status, 201);
  assert.notEqual(res.body.id, 'id-forjado-fase1');
  assert.equal(res.body.version, 1);
  assert.notEqual(res.body.createdBy, 'Invasor');
  assert.equal(res.body.department, 'Jurídico', 'department continua herdado do processo/usuário, nunca do corpo da requisição');
});

test('[HTTP] um processo pode ter múltiplos Legal Deadlines (originType/status distintos) coexistindo', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const first = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo para contestação', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const second = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Controle interno de acompanhamento', date: '2026-12-15', originType: 'INTERNAL_CONTROL' } });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body.id, second.body.id, 'cada Legal Deadline é um registro próprio, nunca um único campo de data no processo');

  const list = await api('GET', '/api/entities/legalDeadlines', { token });
  assert.ok(list.body.some(item => item.id === first.body.id));
  assert.ok(list.body.some(item => item.id === second.body.id));
});

test('[HTTP] novo fato gerador (nova intimação) cria novo Legal Deadline, sem alterar o anterior', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const original = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Intimação original', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(original.status, 201);

  const novaIntimacao = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Nova intimação (fato gerador distinto)', date: '2027-01-15', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(novaIntimacao.status, 201);
  assert.notEqual(novaIntimacao.body.id, original.body.id, 'novo fato gerador cria um Legal Deadline novo, com id próprio');

  const list = await api('GET', '/api/entities/legalDeadlines', { token });
  const stillOriginal = list.body.find(item => item.id === original.body.id);
  assert.equal(stillOriginal.origin, 'Intimação original', 'o registro original permanece inalterado após o novo fato gerador');
  assert.equal(stillOriginal.date, '2026-12-01');
});

// --- Correção pós-revisão do PR #4: reabertura exige `reason` explícito; `reason` fica restrito a
// legalDeadlines; body(req) tratado de forma null-safe. Nenhum dos 132 testes anteriores foi removido.

test('[HTTP] reabertura de "suspenso" para "ativo" sem reason é rejeitada com 422 e não altera o registro', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem reabertura sem motivo', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const suspended = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'suspenso', reason: 'Suspenso para o teste' } });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.body.version, 2);

  const reopenSemReason = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'ativo' } });
  assert.equal(reopenSemReason.status, 422, 'reabertura sem reason deve ser rejeitada com 422');
  assert.ok(reopenSemReason.body.error, 'mensagem de erro clara deve ser retornada');

  const list = await api('GET', '/api/entities/legalDeadlines', { token });
  const record = list.body.find(item => item.id === id);
  assert.equal(record.status, 'suspenso', 'tentativa rejeitada sem reason não altera o status — permanece "suspenso"');
  assert.equal(record.version, 2, 'tentativa rejeitada sem reason não incrementa version');
});

test('[HTTP] reabertura de "cancelado" para "ativo" sem reason é rejeitada com 422', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem cancelado sem motivo', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const cancelled = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'cancelado', reason: 'Cancelado para o teste' } });
  assert.equal(cancelled.status, 200);

  const reopenSemReason = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'ativo' } });
  assert.equal(reopenSemReason.status, 422, 'reabertura de "cancelado" sem reason também é rejeitada');

  const list = await api('GET', '/api/entities/legalDeadlines', { token });
  const record = list.body.find(item => item.id === id);
  assert.equal(record.status, 'cancelado', 'status permanece "cancelado" após tentativa rejeitada');
});

test('[HTTP] reabertura de "cumprido" para "ativo" sem reason é rejeitada com 422', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem cumprido sem motivo', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const cumprido = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'cumprido', reason: 'Cumprido para o teste' } });
  assert.equal(cumprido.status, 200);

  const reopenSemReason = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'ativo' } });
  assert.equal(reopenSemReason.status, 422, 'reabertura de "cumprido" sem reason também é rejeitada');
});

test('[HTTP] reabertura com reason não vazio é aceita (200), mantém o mesmo id e incrementa version', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem reabertura com motivo', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const id = created.body.id;
  await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'suspenso', reason: 'Suspensão para o teste' } });

  const reopened = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'ativo', reason: 'Motivo explícito de reabertura' } });
  assert.equal(reopened.status, 200, 'reabertura com reason válido é aceita');
  assert.equal(reopened.body.id, id, 'reabertura mantém o mesmo id');
  assert.equal(reopened.body.version, 3, 'reabertura incrementa version');
  assert.equal(reopened.body.status, 'ativo');

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const auditList = await api('GET', '/api/audit', { token: tokenDiretoria });
  const reopenEvent = auditList.body.find(event => event.entityId === id && event.after?.status === 'ativo' && event.before?.status === 'suspenso');
  assert.ok(reopenEvent, 'evento de auditoria da reabertura deve existir');
  assert.equal(reopenEvent.reason, 'Motivo explícito de reabertura', 'reason do audit é exatamente o texto informado pelo usuário');
});

test('[HTTP] reason de rejeição textual apenas com espaços em branco é tratado como ausente (422)', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem reason em branco', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const id = created.body.id;
  await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'suspenso', reason: 'Suspensão para o teste' } });

  const reopenComEspacos = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'ativo', reason: '   ' } });
  assert.equal(reopenComEspacos.status, 422, 'reason contendo apenas espaços em branco não é aceito como motivo válido');
});

test('[HTTP] reason não é persistido como campo de negócio do registro Legal Deadline', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem sem persistir reason', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const id = created.body.id;

  const patched = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'suspenso', reason: 'Este texto não deve virar campo do registro' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.reason, undefined, 'reason não aparece na resposta do PATCH como campo do registro');

  const list = await api('GET', '/api/entities/legalDeadlines', { token });
  const record = list.body.find(item => item.id === id);
  assert.equal(record.reason, undefined, 'reason não é persistido como campo comum do Legal Deadline — alimenta apenas a auditoria');
});

test('[HTTP] PATCH de Legal Deadline com body JSON null não derruba o servidor e responde de forma controlada', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Origem body null', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const patchComBodyNull = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: null });
  assert.notEqual(patchComBodyNull.status, 500, 'body JSON null não pode derrubar o servidor com 500');
  assert.ok([200, 422].includes(patchComBodyNull.status), `esperado 200 ou 422 para body null, recebido ${patchComBodyNull.status}`);
  assert.ok(patchComBodyNull.body && typeof patchComBodyNull.body === 'object', 'resposta deve ser um corpo JSON estruturado, nunca um crash sem corpo');

  const list = await api('GET', '/api/entities/legalDeadlines', { token });
  const record = list.body.find(item => item.id === id);
  assert.equal(record.status, 'ativo', 'registro permanece consistente após PATCH com body null');
});

test('[HTTP] entidade genérica não-legalDeadlines não sofre extração/remoção de reason nesta Fase 1', async () => {
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const created = await api('POST', '/api/entities/documentReferences', { token: tokenDiretoria, json: { title: 'Referência não-Legal-Deadline' } });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const patched = await api('PATCH', `/api/entities/documentReferences/${id}`, { token: tokenDiretoria, json: { title: 'Referência atualizada', reason: 'Este reason não deve ganhar tratamento especial' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.title, 'Referência atualizada');
  // Comportamento idêntico ao anterior ao PR #4: `reason` não está em PROTECTED_ENTITY_FIELDS, então
  // para entidades genéricas ele é persistido como um campo comum do registro (igual a qualquer outro
  // campo não reconhecido) — exatamente como acontecia antes desta Fase 1. O tratamento especial
  // (extrair, apagar do registro, alimentar audit()) é exclusivo de legalDeadlines.
  assert.equal(patched.body.reason, 'Este reason não deve ganhar tratamento especial', 'reason continua sendo persistido como campo comum para entidades genéricas, igual ao comportamento anterior ao PR #4');

  const auditList = await api('GET', '/api/audit', { token: tokenDiretoria });
  const updateEvent = auditList.body.find(event => event.entityId === id && event.entity === 'documentReferences' && event.after?.title === 'Referência atualizada');
  assert.ok(updateEvent, 'evento de auditoria de documentReferences deve existir');
  assert.equal(updateEvent.reason, 'Operação solicitada pelo usuário', 'auditoria de entidade genérica usa o default de audit(), sem o tratamento especial de reason da Fase 1 (restrito a legalDeadlines)');
});

// ============================================================================================
// Sprint 2, Fase 2 — testes HTTP (views/consumo canônico de Legal Deadline: dashboard, listagem/
// filtro, detalhe/histórico). Nenhum teste da Fase 1 foi removido — os 140 anteriores continuam.
// ============================================================================================

test('[HTTP] regressão obrigatória da Fase 2: processo com DATA/CITAÇÃO mas sem nenhum Legal Deadline não aparece como prazo no dashboard jurídico', async () => {
  // Semeia diretamente um processo Monday com colunas de data brutas (DATA/CITAÇÃO/PROTOCOLO), mas
  // sem nenhum Legal Deadline correspondente — exatamente o cenário que a D1 proíbe de virar "prazo".
  const store = readStore();
  store.records.processos.push({
    id: 'proc-juridico-data-bruta-sem-prazo', source: 'monday', externalId: 'ext-data-bruta', module: 'processos',
    department: 'Jurídico', title: 'Processo com DATA/CITAÇÃO mas sem Legal Deadline', deletedAt: null,
    columnsByTitle: { DATA: '2026-09-01', 'CITAÇÃO/PROTOCOLO': '2026-09-02' }
  });
  writeStore(store);

  const token = await loginAs(EMAILS.liderJuridico);
  const dashboard = await api('GET', '/api/dashboards/legal', { token });
  assert.equal(dashboard.status, 200);
  const deadlinesWidget = dashboard.body.widgets['legal-deadlines'];
  const flatten = JSON.stringify(deadlinesWidget.data || null);
  assert.ok(!flatten.includes('2026-09-01') && !flatten.includes('2026-09-02'), 'DATA/CITAÇÃO do processo nunca podem aparecer como prazo no widget, mesmo sem nenhum Legal Deadline cadastrado');
});

test('[HTTP] GET /api/dashboards/legal calcula "Prazos vencidos"/"Prazos críticos" exclusivamente a partir de legalDeadlines', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo vencido do dashboard', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);

  const dashboard = await api('GET', '/api/dashboards/legal', { token });
  assert.equal(dashboard.status, 200);
  const risk = dashboard.body.widgets['legal-risk'].data;
  const vencidos = risk.find(row => row.label === 'Prazos vencidos');
  assert.ok(vencidos && vencidos.value >= 1, 'o prazo vencido criado neste teste deve ser contado em "Prazos vencidos"');
  const deadlinesWidget = dashboard.body.widgets['legal-deadlines'];
  assert.equal(deadlinesWidget.state, 'ready');
  assert.ok(deadlinesWidget.data.some(row => row.title === 'Prazo vencido do dashboard'), 'o prazo aparece no widget "Próximos prazos" vindo de legalDeadlines');
});

test('[HTTP] líder de TI não vê os dashboards/prazos jurídicos', async () => {
  const tokenTi = await loginAs(EMAILS.liderTi);
  const dashboard = await api('GET', '/api/dashboards/legal', { token: tokenTi });
  assert.equal(dashboard.status, 403, 'líder de TI não acessa o dashboard jurídico — isolamento departamental preservado');
});

test('[HTTP] administrador técnico não recebe conteúdo jurídico no dashboard/listagem/detalhe de Legal Deadline', async () => {
  const tokenAdministrador = await loginAs(EMAILS.administrador);
  assert.equal((await api('GET', '/api/dashboards/legal', { token: tokenAdministrador })).status, 403, 'administrador não tem department — dashboard departamental Jurídico nega no gate de dashboardAuthorized()');

  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Prazo para teste de administrador', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);

  const listAsAdmin = await api('GET', '/api/entities/legalDeadlines', { token: tokenAdministrador });
  assert.equal(listAsAdmin.status, 200, 'administrador passa no gate de módulo (gestão técnica), mas...');
  assert.equal(listAsAdmin.body.length, 0, '...nenhum Legal Deadline é retornado — scoped() nega por ausência de escopo global/departamental');

  const detailAsAdmin = await api('GET', `/api/entities/legalDeadlines/${created.body.id}/detail`, { token: tokenAdministrador });
  assert.equal(detailAsAdmin.status, 404, 'detalhe de Legal Deadline nega por escopo, sem revelar existência do registro ao administrador técnico');
});

test('[HTTP] diretoria acessa dashboard, listagem e detalhe de Legal Deadline conforme alçada global', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Prazo visível à diretoria', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  assert.equal((await api('GET', '/api/dashboards/legal', { token: tokenDiretoria })).status, 200);
  const list = await api('GET', '/api/entities/legalDeadlines', { token: tokenDiretoria });
  assert.equal(list.status, 200);
  assert.ok(list.body.some(item => item.id === created.body.id), 'diretoria (alçada global) enxerga o Legal Deadline do Jurídico normalmente');

  const detail = await api('GET', `/api/entities/legalDeadlines/${created.body.id}/detail`, { token: tokenDiretoria });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.id, created.body.id);
});

test('[HTTP] listagem paginada de Legal Deadline: filtro por processId funciona', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Filtro processId', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const list = await api('GET', `/api/entities/legalDeadlines?paginated=1&processId=proc-juridico-teste`, { token });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.records));
  assert.ok(list.body.records.every(row => row.processId === 'proc-juridico-teste'));
  assert.ok('pagination' in list.body);
});

test('[HTTP] listagem paginada de Legal Deadline: filtro por originType funciona', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Filtro originType interno', date: '2026-12-01', originType: 'INTERNAL_CONTROL' } });
  const list = await api('GET', `/api/entities/legalDeadlines?paginated=1&originType=INTERNAL_CONTROL`, { token });
  assert.equal(list.status, 200);
  assert.ok(list.body.records.length >= 1);
  assert.ok(list.body.records.every(row => row.originType === 'INTERNAL_CONTROL'));
});

test('[HTTP] listagem paginada de Legal Deadline: filtro por status funciona', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Filtro status', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  await api('PATCH', `/api/entities/legalDeadlines/${created.body.id}`, { token, json: { status: 'cumprido' } });
  const list = await api('GET', `/api/entities/legalDeadlines?paginated=1&status=cumprido`, { token });
  assert.equal(list.status, 200);
  assert.ok(list.body.records.some(row => row.id === created.body.id));
  assert.ok(list.body.records.every(row => row.status === 'cumprido'));
});

test('[HTTP] listagem paginada de Legal Deadline: filtro por overdue funciona e suspenso/cumprido/cancelado nunca entram em overdue=true', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const vencido = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Overdue vencido', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const suspensoVencido = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Overdue suspenso (não deve contar)', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  await api('PATCH', `/api/entities/legalDeadlines/${suspensoVencido.body.id}`, { token, json: { status: 'suspenso' } });

  const overdueList = await api('GET', `/api/entities/legalDeadlines?paginated=1&overdue=true`, { token });
  assert.equal(overdueList.status, 200);
  assert.ok(overdueList.body.records.some(row => row.id === vencido.body.id), 'prazo ativo com data passada aparece em overdue=true');
  assert.ok(!overdueList.body.records.some(row => row.id === suspensoVencido.body.id), 'prazo suspenso com data passada NUNCA aparece em overdue=true');
  assert.ok(overdueList.body.records.every(row => row.overdue === true));

  const notOverdueList = await api('GET', `/api/entities/legalDeadlines?paginated=1&overdue=false`, { token });
  assert.ok(notOverdueList.body.records.some(row => row.id === suspensoVencido.body.id), 'prazo suspenso aparece em overdue=false (nunca é atraso, independentemente da data)');
  assert.ok(notOverdueList.body.records.every(row => row.overdue === false));
});

test('[HTTP] listagem paginada de Legal Deadline: filtros combinados (processId + status + originType) funcionam', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Combinado', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const list = await api('GET', `/api/entities/legalDeadlines?paginated=1&processId=proc-juridico-teste&status=ativo&originType=JUDICIAL_PROCESSUAL`, { token });
  assert.equal(list.status, 200);
  assert.ok(list.body.records.every(row => row.processId === 'proc-juridico-teste' && row.status === 'ativo' && row.originType === 'JUDICIAL_PROCESSUAL'));
});

test('[HTTP] detalhe de Legal Deadline retorna processo relacionado, atraso derivado e histórico; histórico respeita permissão (sem before/after para quem não tem alçada global)', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Prazo para detalhe', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  const id = created.body.id;
  await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token: tokenJuridico, json: { status: 'suspenso', reason: 'Suspensão para o teste de detalhe' } });

  const detailAsJuridico = await api('GET', `/api/entities/legalDeadlines/${id}/detail`, { token: tokenJuridico });
  assert.equal(detailAsJuridico.status, 200);
  assert.equal(detailAsJuridico.body.id, id);
  assert.equal(detailAsJuridico.body.process.id, 'proc-juridico-teste', 'detalhe inclui o processo relacionado');
  assert.equal(detailAsJuridico.body.overdue, false, 'status suspenso nunca é atraso, mesmo com data passada');
  assert.ok(Array.isArray(detailAsJuridico.body.history) && detailAsJuridico.body.history.length >= 2, 'histórico inclui os eventos de criação e da suspensão');
  assert.ok(detailAsJuridico.body.history.every(event => !('before' in event) && !('after' in event)), 'líder Jurídico (sem alçada global) não recebe before/after no histórico — mesma regra de sanitizeAuditEventForUser()');
  assert.ok(detailAsJuridico.body.history.some(event => event.reason === 'Suspensão para o teste de detalhe'), 'o motivo da alteração continua visível no histórico, mesmo sem before/after');

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const detailAsDiretoria = await api('GET', `/api/entities/legalDeadlines/${id}/detail`, { token: tokenDiretoria });
  assert.equal(detailAsDiretoria.status, 200);
  assert.ok(detailAsDiretoria.body.history.some(event => event.after?.status === 'suspenso'), 'diretoria (alçada global) recebe before/after completo no histórico');
});

test('[HTTP] detalhe de Legal Deadline por ID fora do escopo é negado, sem revelar existência/conteúdo', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Prazo restrito ao Jurídico', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);

  // Mesma negação transversal já usada em GET/PATCH /api/entities/legalDeadlines (allowedInDepartment
  // nega TI no próprio gate de módulo departamental, antes mesmo de chegar a scoped() — 403, não 404).
  const tokenTi = await loginAs(EMAILS.liderTi);
  const detailAsTi = await api('GET', `/api/entities/legalDeadlines/${created.body.id}/detail`, { token: tokenTi });
  assert.equal(detailAsTi.status, 403, 'líder de TI é negado no gate de módulo departamental para o detalhe de Legal Deadline do Jurídico');
});

test('[HTTP] detalhe de Legal Deadline inexistente retorna 404', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const detail = await api('GET', '/api/entities/legalDeadlines/id-que-nao-existe/detail', { token });
  assert.equal(detail.status, 404);
});

test('[HTTP] processo com zero Legal Deadlines não aparece como tendo prazo na listagem/dashboard', async () => {
  const store = readStore();
  store.records.processos.push({ id: 'proc-juridico-sem-prazo-nenhum', source: 'monday', externalId: 'ext-sem-prazo', module: 'processos', department: 'Jurídico', title: 'Processo sem nenhum Legal Deadline', deletedAt: null });
  writeStore(store);

  const token = await loginAs(EMAILS.liderJuridico);
  const list = await api('GET', `/api/entities/legalDeadlines?paginated=1&processId=proc-juridico-sem-prazo-nenhum`, { token });
  assert.equal(list.status, 200);
  assert.equal(list.body.count, 0, 'processo sem nenhum Legal Deadline cadastrado não aparece na listagem filtrada por processId');
});

// ============================================================================================
// P1 corrigido (revisão do PR #5): contagens agregadas do dashboard "legal" (active-processes,
// "A classificar", legal-quality, legal-attention) não passavam por scoped() — só os registros
// individuais de Legal Deadline tinham essa defesa em profundidade. Testes abaixo usam uma comparação
// antes/depois (baseline) por usuário, para não depender da contagem absoluta de processos já
// semeados por outros testes no mesmo arquivo (store compartilhada entre testes deste arquivo).
// ============================================================================================

test('[HTTP] dashboard "legal": active-processes/legal-attention respeitam scoped() por companyId — usuário de outra empresa não vê a contagem aumentar; diretoria vê o consolidado', async () => {
  const store = readStore();
  store.users.push(
    { id: 'usr-teste-empresa-a', name: 'Líder Empresa A Teste', email: 'lider.empresa.a.teste@coevo.local', role: 'lider', department: 'Jurídico', companyId: 'empresa-a-teste', mfa: false },
    { id: 'usr-teste-empresa-b', name: 'Líder Empresa B Teste', email: 'lider.empresa.b.teste@coevo.local', role: 'lider', department: 'Jurídico', companyId: 'empresa-b-teste', mfa: false }
  );
  writeStore(store);

  const tokenA = await loginAs('lider.empresa.a.teste@coevo.local');
  const tokenB = await loginAs('lider.empresa.b.teste@coevo.local');
  const tokenDiretoria = await loginAs(EMAILS.diretoria);

  const attentionValue = payload => payload.widgets['legal-attention'].data.find(row => row.target === 'notificacoes').value;
  const beforeA = await api('GET', '/api/dashboards/legal', { token: tokenA });
  const beforeB = await api('GET', '/api/dashboards/legal', { token: tokenB });
  const beforeDiretoria = await api('GET', '/api/dashboards/legal', { token: tokenDiretoria });
  assert.equal(beforeA.status, 200);
  assert.equal(beforeB.status, 200);
  const activeBeforeA = beforeA.body.widgets['active-processes'].data.value;
  const activeBeforeB = beforeB.body.widgets['active-processes'].data.value;
  const activeBeforeDiretoria = beforeDiretoria.body.widgets['active-processes'].data.value;
  const attentionBeforeA = attentionValue(beforeA.body);
  const attentionBeforeB = attentionValue(beforeB.body);

  const store2 = readStore();
  store2.records.processos.push({ id: 'proc-empresa-a-scoped-teste', source: 'monday', department: 'Jurídico', companyId: 'empresa-a-teste', title: 'Processo Empresa A (dashboard scoped)', deletedAt: null });
  store2.records.notificacoes = store2.records.notificacoes || [];
  store2.records.notificacoes.push({ id: 'not-empresa-a-scoped-teste', department: 'Jurídico', companyId: 'empresa-a-teste', deletedAt: null });
  writeStore(store2);

  const afterA = await api('GET', '/api/dashboards/legal', { token: tokenA });
  const afterB = await api('GET', '/api/dashboards/legal', { token: tokenB });
  const afterDiretoria = await api('GET', '/api/dashboards/legal', { token: tokenDiretoria });

  assert.equal(afterA.body.widgets['active-processes'].data.value, activeBeforeA + 1, 'active-processes da empresa A aumenta em 1 com o novo processo da própria empresa');
  assert.equal(attentionValue(afterA.body), attentionBeforeA + 1, 'legal-attention da empresa A aumenta em 1 com a nova notificação da própria empresa');

  assert.equal(afterB.body.widgets['active-processes'].data.value, activeBeforeB, 'active-processes da empresa B permanece igual — não vê o processo da empresa A');
  assert.equal(attentionValue(afterB.body), attentionBeforeB, 'legal-attention da empresa B permanece igual — não vê a notificação da empresa A');

  assert.equal(afterDiretoria.body.widgets['active-processes'].data.value, activeBeforeDiretoria + 1, 'diretoria (alçada global) vê o consolidado, incluindo o novo processo da empresa A — sem tratamento especial manual, apenas scoped() retornando true');
});

test('[HTTP] dashboard "legal": deny-by-default também por speId — usuário de uma SPE não vê a contagem aumentar com processo de outra SPE', async () => {
  const store = readStore();
  store.users.push({ id: 'usr-teste-spe-x', name: 'Líder SPE X Teste', email: 'lider.spe.x.teste@coevo.local', role: 'lider', department: 'Jurídico', speId: 'spe-x-teste', mfa: false });
  writeStore(store);

  const tokenSpeX = await loginAs('lider.spe.x.teste@coevo.local');
  const before = await api('GET', '/api/dashboards/legal', { token: tokenSpeX });
  assert.equal(before.status, 200);
  const activeBefore = before.body.widgets['active-processes'].data.value;

  const store2 = readStore();
  store2.records.processos.push({ id: 'proc-spe-y-scoped-teste', source: 'monday', department: 'Jurídico', speId: 'spe-y-teste', title: 'Processo SPE Y (fora do escopo)', deletedAt: null });
  writeStore(store2);

  const after = await api('GET', '/api/dashboards/legal', { token: tokenSpeX });
  assert.equal(after.body.widgets['active-processes'].data.value, activeBefore, 'usuário da SPE X não vê a contagem aumentar com um processo de outra SPE (SPE Y)');
});

// ============================================================================================
// Sprint 2, Fase 3 — testes HTTP (Agenda/Atenção mínima, Legal Deadline como fonte canônica).
// Nenhum teste anterior foi removido — os 168 anteriores continuam.
// ============================================================================================

test('[HTTP] GET /api/agenda-items: líder Jurídico vê itens autorizados (Legal Deadline + evento manual de agenda)', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo para Agenda', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  const evento = await api('POST', '/api/agenda', { token, json: { title: 'Reunião de Agenda Fase 3', date: '2026-12-05' } });
  assert.equal(evento.status, 201);

  const res = await api('GET', '/api/agenda-items', { token });
  assert.equal(res.status, 200);
  assert.ok(res.body.items.some(item => item.entityType === 'legalDeadline' && item.entityId === created.body.id), 'Legal Deadline aparece na Agenda');
  assert.ok(res.body.items.some(item => item.entityType === 'agendaEvent' && item.entityId === evento.body.id), 'evento manual de agenda também aparece, como fonte independente');
});

test('[HTTP] GET /api/agenda-items: líder de TI não vê agenda jurídica (nenhum item legalDeadline)', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Prazo restrito ao Jurídico (Fase 3)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });

  const tokenTi = await loginAs(EMAILS.liderTi);
  const res = await api('GET', '/api/agenda-items', { token: tokenTi });
  assert.equal(res.status, 200);
  assert.ok(!res.body.items.some(item => item.entityType === 'legalDeadline'), 'TI nunca vê item de Legal Deadline na Agenda combinada');
});

test('[HTTP] GET /api/agenda-items e /api/attention: administrador técnico não vê conteúdo jurídico', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Prazo para teste de administrador (Fase 3)', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });

  const tokenAdministrador = await loginAs(EMAILS.administrador);
  const agendaItems = await api('GET', '/api/agenda-items', { token: tokenAdministrador });
  assert.equal(agendaItems.status, 200, 'administrador passa no gate de módulo (gestão técnica), mas...');
  assert.ok(!agendaItems.body.items.some(item => item.entityType === 'legalDeadline'), '...nenhum item de Legal Deadline aparece — scoped() nega por ausência de escopo global/departamental');

  const attention = await api('GET', '/api/attention', { token: tokenAdministrador });
  assert.equal(attention.status, 200);
  assert.deepEqual(attention.body.items, []);
  assert.deepEqual(attention.body.summary, { overdue: 0, upcoming: 0, requiresReview: 0 });
});

test('[HTTP] GET /api/agenda-items: diretoria vê o consolidado conforme alçada global', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Prazo visível à diretoria (Fase 3)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const res = await api('GET', '/api/agenda-items', { token: tokenDiretoria });
  assert.equal(res.status, 200);
  assert.ok(res.body.items.some(item => item.entityType === 'legalDeadline' && item.entityId === created.body.id), 'diretoria (alçada global) vê o Legal Deadline do Jurídico normalmente');
});

test('[HTTP] GET /api/agenda-items e /api/attention: companyId fora de escopo não aparece', async () => {
  const store = readStore();
  store.users.push(
    { id: 'usr-teste-fase3-empresa-a', name: 'Líder Fase3 Empresa A', email: 'lider.fase3.empresa.a@coevo.local', role: 'lider', department: 'Jurídico', companyId: 'fase3-empresa-a', mfa: false }
  );
  store.records.processos.push({ id: 'proc-fase3-empresa-b', source: 'monday', department: 'Jurídico', companyId: 'fase3-empresa-b', title: 'Processo Fase 3 Empresa B', deletedAt: null });
  writeStore(store);

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenDiretoria, json: { processId: 'proc-fase3-empresa-b', origin: 'Prazo empresa B (Fase 3)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', companyId: 'fase3-empresa-b', department: 'Jurídico' } });
  assert.equal(created.status, 201);

  const tokenEmpresaA = await loginAs('lider.fase3.empresa.a@coevo.local');
  const agendaItems = await api('GET', '/api/agenda-items', { token: tokenEmpresaA });
  assert.ok(!agendaItems.body.items.some(item => item.entityId === created.body.id), 'usuário da empresa A não vê Legal Deadline da empresa B na Agenda');
  const attention = await api('GET', '/api/attention', { token: tokenEmpresaA });
  assert.ok(!attention.body.items.some(item => item.entityId === created.body.id), 'nem em Atenção');
});

test('[HTTP] GET /api/agenda-items e /api/attention: speId fora de escopo não aparece', async () => {
  const store = readStore();
  store.users.push({ id: 'usr-teste-fase3-spe-x', name: 'Líder Fase3 SPE X', email: 'lider.fase3.spe.x@coevo.local', role: 'lider', department: 'Jurídico', speId: 'fase3-spe-x', mfa: false });
  store.records.processos.push({ id: 'proc-fase3-spe-y', source: 'monday', department: 'Jurídico', speId: 'fase3-spe-y', title: 'Processo Fase 3 SPE Y', deletedAt: null });
  writeStore(store);

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenDiretoria, json: { processId: 'proc-fase3-spe-y', origin: 'Prazo SPE Y (Fase 3)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', speId: 'fase3-spe-y', department: 'Jurídico' } });
  assert.equal(created.status, 201);

  const tokenSpeX = await loginAs('lider.fase3.spe.x@coevo.local');
  const agendaItems = await api('GET', '/api/agenda-items', { token: tokenSpeX });
  assert.ok(!agendaItems.body.items.some(item => item.entityId === created.body.id), 'usuário da SPE X não vê Legal Deadline da SPE Y na Agenda');
  const attention = await api('GET', '/api/attention', { token: tokenSpeX });
  assert.ok(!attention.body.items.some(item => item.entityId === created.body.id));
});

test('[HTTP] GET /api/attention: contagem de summary não vaza item fora de escopo (comparação antes/depois por usuário)', async () => {
  const store = readStore();
  store.users.push({ id: 'usr-teste-fase3-attention-a', name: 'Líder Fase3 Attention A', email: 'lider.fase3.attention.a@coevo.local', role: 'lider', department: 'Jurídico', companyId: 'fase3-attention-a', mfa: false });
  writeStore(store);

  const tokenA = await loginAs('lider.fase3.attention.a@coevo.local');
  const before = await api('GET', '/api/attention', { token: tokenA });
  assert.equal(before.status, 200);
  const overdueBefore = before.body.summary.overdue;

  // Cria um Legal Deadline vencido em OUTRA empresa (diretoria tem alçada global para criar/relacionar).
  const store2 = readStore();
  store2.records.processos.push({ id: 'proc-fase3-attention-b', source: 'monday', department: 'Jurídico', companyId: 'fase3-attention-b', title: 'Processo Fase 3 Attention B', deletedAt: null });
  writeStore(store2);
  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  await api('POST', '/api/entities/legalDeadlines', { token: tokenDiretoria, json: { processId: 'proc-fase3-attention-b', origin: 'Vencido empresa B (Fase 3)', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL', companyId: 'fase3-attention-b', department: 'Jurídico' } });

  const after = await api('GET', '/api/attention', { token: tokenA });
  assert.equal(after.body.summary.overdue, overdueBefore, 'summary.overdue do usuário da empresa A não aumenta com o prazo vencido de outra empresa');
});

test('[HTTP] item de Legal Deadline na Agenda referencia o detalhe correto (target aponta para o mesmo registro)', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo com target (Fase 3)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const agendaItems = await api('GET', '/api/agenda-items', { token });
  const item = agendaItems.body.items.find(i => i.entityId === created.body.id);
  assert.ok(item, 'item deve existir na Agenda');
  assert.equal(item.target, `/api/entities/legalDeadlines/${created.body.id}/detail`);

  const detail = await api('GET', item.target, { token });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.id, created.body.id, 'o target da Agenda leva exatamente ao mesmo Legal Deadline, via o endpoint de detalhe já existente');
});

test('[HTTP] processo relacionado fora de escopo bloqueia o item de Agenda/Atenção mesmo com o prazo no escopo do usuário', async () => {
  // Cenário de defesa em profundidade (item 13 do plano): um Legal Deadline com department/companyId
  // "corretos" no próprio registro, mas cujo processo relacionado foi movido/arquivado para fora do
  // escopo do usuário, nunca deve aparecer — nem na Agenda, nem em Atenção.
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Prazo com processo depois arquivado (Fase 3)', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);

  const store = readStore();
  const process = store.records.processos.find(p => p.id === 'proc-juridico-teste');
  process.deletedAt = new Date().toISOString();
  writeStore(store);

  try {
    const agendaItems = await api('GET', '/api/agenda-items', { token: tokenJuridico });
    assert.ok(!agendaItems.body.items.some(item => item.entityId === created.body.id), 'processo relacionado arquivado bloqueia o item mesmo com o prazo tecnicamente no escopo do usuário');
    const attention = await api('GET', '/api/attention', { token: tokenJuridico });
    assert.ok(!attention.body.items.some(item => item.entityId === created.body.id));
  } finally {
    const restore = readStore();
    const restoredProcess = restore.records.processos.find(p => p.id === 'proc-juridico-teste');
    restoredProcess.deletedAt = null;
    writeStore(restore);
  }
});

test('[HTTP] processo sem Legal Deadline não gera prazo na Agenda/Atenção', async () => {
  const store = readStore();
  store.records.processos.push({ id: 'proc-fase3-sem-prazo', source: 'monday', department: 'Jurídico', title: 'Processo Fase 3 sem prazo', deletedAt: null });
  writeStore(store);

  const token = await loginAs(EMAILS.liderJuridico);
  const agendaItems = await api('GET', '/api/agenda-items', { token });
  assert.ok(!agendaItems.body.items.some(item => item.processId === 'proc-fase3-sem-prazo'), 'processo sem nenhum Legal Deadline não aparece como prazo na Agenda');
});

test('[HTTP] regressão obrigatória: DATA/CITAÇÃO do processo Monday nunca aparecem como prazo na Agenda/Atenção', async () => {
  const store = readStore();
  store.records.processos.push({
    id: 'proc-fase3-data-bruta', source: 'monday', department: 'Jurídico', title: 'Processo Fase 3 com DATA/CITAÇÃO',
    columnsByTitle: { DATA: '2026-09-01', 'CITAÇÃO/PROTOCOLO': '2026-09-02' }, deletedAt: null
  });
  writeStore(store);

  const token = await loginAs(EMAILS.liderJuridico);
  const agendaItems = await api('GET', '/api/agenda-items', { token });
  const attention = await api('GET', '/api/attention', { token });
  const flatten = JSON.stringify(agendaItems.body) + JSON.stringify(attention.body);
  assert.ok(!flatten.includes('2026-09-01') && !flatten.includes('2026-09-02'), 'DATA/CITAÇÃO do processo nunca aparecem como prazo, mesmo sem nenhum Legal Deadline cadastrado');
});

test('[HTTP] INTERNAL_CONTROL nunca recebe label/campo de prazo processual na Agenda', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Controle interno (Fase 3)', date: '2026-12-01', originType: 'INTERNAL_CONTROL' } });
  assert.equal(created.status, 201);

  const agendaItems = await api('GET', '/api/agenda-items', { token });
  const item = agendaItems.body.items.find(i => i.entityId === created.body.id);
  assert.ok(item);
  assert.equal(item.originType, 'INTERNAL_CONTROL', 'originType é preservado tal como está — a camada de apresentação decide o rótulo, nunca a API o converte');
});

test('[HTTP] requires_review não é tratado como confirmado — registro legado sem originType/status aparece sinalizado, nunca como Legal Deadline válido', async () => {
  const store = readStore();
  store.records.legalDeadlines.push({ id: 'ld-fase3-legado', processId: 'proc-juridico-teste', origin: 'Registro legado pré-D1 (Fase 3)', date: '2020-01-01', department: 'Jurídico', version: 1, createdAt: new Date().toISOString(), createdBy: 'seed' });
  writeStore(store);

  const token = await loginAs(EMAILS.liderJuridico);
  const agendaItems = await api('GET', '/api/agenda-items', { token });
  const item = agendaItems.body.items.find(i => i.entityId === 'ld-fase3-legado');
  assert.ok(item, 'registro legado ainda aparece na Agenda (não é ocultado silenciosamente)');
  assert.equal(item.dataIntegrity, 'requires_review');
  assert.equal(item.originType, undefined, 'nenhum originType foi inferido');

  const attention = await api('GET', '/api/attention', { token });
  const attentionItem = attention.body.items.find(i => i.entityId === 'ld-fase3-legado');
  assert.ok(attentionItem, 'registro legado aparece em Atenção');
  assert.equal(attentionItem.category, 'REQUIRES_REVIEW', 'nunca tratado como vencido/próximo/confirmado — apenas sinalizado para revisão');
});

test('[HTTP] GET /api/attention: suspended/completed/cancelled nunca aparecem como OVERDUE, mesmo com data passada', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const suspenso = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Suspenso vencido (Fase 3)', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  await api('PATCH', `/api/entities/legalDeadlines/${suspenso.body.id}`, { token, json: { status: 'suspenso' } });
  const cumprido = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Cumprido vencido (Fase 3)', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  await api('PATCH', `/api/entities/legalDeadlines/${cumprido.body.id}`, { token, json: { status: 'cumprido' } });
  const cancelado = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Cancelado vencido (Fase 3)', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  await api('PATCH', `/api/entities/legalDeadlines/${cancelado.body.id}`, { token, json: { status: 'cancelado' } });

  const attention = await api('GET', '/api/attention', { token });
  for (const id of [suspenso.body.id, cumprido.body.id, cancelado.body.id]) {
    const item = attention.body.items.find(i => i.entityId === id);
    assert.ok(!item, `Legal Deadline ${id} (suspenso/cumprido/cancelado) nunca aparece em Atenção como vencido`);
  }
});

test('[HTTP] GET /api/agenda-items e /api/attention não criam nem alteram nada (idempotentes)', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const before = readStore();
  const legalCountBefore = before.records.legalDeadlines.length;
  const agendaCountBefore = (before.agenda || []).length;

  await api('GET', '/api/agenda-items', { token });
  await api('GET', '/api/attention', { token });
  await api('GET', '/api/agenda-items', { token });

  const after = readStore();
  assert.equal(after.records.legalDeadlines.length, legalCountBefore, 'GET não cria nenhum Legal Deadline');
  assert.equal((after.agenda || []).length, agendaCountBefore, 'GET não cria nenhum evento de agenda');
});

// --- Testes de regressão obrigatórios (itens 27, 28 e 29 do plano da Fase 3) ---

test('[HTTP] não duplicidade: chamadas repetidas de Agenda/Atenção/detalhe nunca criam um segundo Legal Deadline', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo único (não duplicidade)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  const id = created.body.id;

  await api('GET', '/api/agenda-items', { token });
  await api('GET', '/api/attention', { token });
  await api('GET', `/api/entities/legalDeadlines/${id}/detail`, { token });
  await api('GET', '/api/agenda-items', { token });

  const store = readStore();
  const matching = store.records.legalDeadlines.filter(item => item.origin === 'Prazo único (não duplicidade)');
  assert.equal(matching.length, 1, 'continua existindo apenas 1 Legal Deadline persistido — nenhuma view criou um novo registro de prazo');
});

test('[HTTP] Agenda é view, não source of truth: alteração da date no Legal Deadline reflete na Agenda sem criar segundo item', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo com data alterada (Fase 3)', date: '2026-09-20', originType: 'JUDICIAL_PROCESSUAL' } });
  const id = created.body.id;

  const before = await api('GET', '/api/agenda-items', { token });
  const itemBefore = before.body.items.find(i => i.entityId === id);
  assert.equal(itemBefore.date, '2026-09-20');

  const patched = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { date: '2026-09-25' } });
  assert.equal(patched.status, 200);

  const after = await api('GET', '/api/agenda-items', { token });
  const itemsAfter = after.body.items.filter(i => i.entityId === id);
  assert.equal(itemsAfter.length, 1, 'nenhum segundo item foi persistido pela alteração');
  assert.equal(itemsAfter[0].date, '2026-09-25', 'a Agenda reflete o novo estado a partir da entidade canônica');

  const store = readStore();
  assert.equal(store.records.legalDeadlines.filter(item => item.id === id).length, 1);
});

test('[HTTP] reabertura: suspenso não aparece como overdue; após reabertura com reason, Agenda/Atenção passam a refletir overdue no mesmo id', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo para reabertura (Fase 3)', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const id = created.body.id;

  const suspended = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'suspenso', reason: 'Suspensão para o teste de Fase 3' } });
  assert.equal(suspended.status, 200);

  const attentionSuspenso = await api('GET', '/api/attention', { token });
  assert.ok(!attentionSuspenso.body.items.some(i => i.entityId === id), 'suspenso não aparece em Atenção como vencido, mesmo com data passada');

  const reopened = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { status: 'ativo', reason: 'Reabertura para o teste de Fase 3' } });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.id, id, 'reabertura preserva o mesmo id');

  const attentionReaberto = await api('GET', '/api/attention', { token });
  const item = attentionReaberto.body.items.find(i => i.entityId === id);
  assert.ok(item, 'após a reabertura, o mesmo Legal Deadline volta a aparecer em Atenção');
  assert.equal(item.category, 'OVERDUE', 'como a data já passou, a reabertura reflete overdue imediatamente — sem lógica duplicada');

  const agendaItems = await api('GET', '/api/agenda-items', { token });
  const agendaItem = agendaItems.body.items.find(i => i.entityId === id);
  assert.equal(agendaItem.overdue, true);
});

// ============================================================================================
// Sprint 2, Fase 4B — testes HTTP (responsibleUserId, Minha Semana, D4.15, Google Calendar)
// ============================================================================================

test('[HTTP] POST /api/entities/legalDeadlines com responsibleUserId válido é aceito e persiste o campo', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const responsavel = await loginAs(EMAILS.responsavelAtivo);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo com responsável (Fase 4B)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', responsibleUserId: 'usr-teste-responsavel-ativo' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.responsibleUserId, 'usr-teste-responsavel-ativo');
  void responsavel;
});

test('[HTTP] POST /api/entities/legalDeadlines sem responsibleUserId continua válido (campo opcional)', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo sem responsável (Fase 4B)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.responsibleUserId, undefined);
});

test('[HTTP] POST /api/entities/legalDeadlines com responsibleUserId inexistente é rejeitado com 422, sem persistir nada', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const before = readStore().records.legalDeadlines.length;
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo com responsável inexistente (Fase 4B)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', responsibleUserId: 'usr-nao-existe' } });
  assert.equal(created.status, 422);
  assert.equal(readStore().records.legalDeadlines.length, before, 'nada foi persistido quando responsibleUserId é inválido');
});

test('[HTTP] POST /api/entities/legalDeadlines: campos textuais responsible/responsibleName/ownerName nunca substituem responsibleUserId', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo com nome textual (Fase 4B)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', responsible: 'Fulano de Tal', responsibleName: 'Fulano', ownerName: 'Fulano' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.responsibleUserId, undefined, 'nenhum campo textual é aceito como substituto de responsibleUserId');
});

test('[HTTP] PATCH de responsável: reatribuição para outro usuário ativo é aceita, incrementa version e gera auditoria before/after', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo para reatribuição (Fase 4B)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const id = created.body.id;

  const patched = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { responsibleUserId: 'usr-teste-responsavel-ativo' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.responsibleUserId, 'usr-teste-responsavel-ativo');
  assert.equal(patched.body.version, created.body.version + 1);

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const detail = await api('GET', `/api/entities/legalDeadlines/${id}/detail`, { token: tokenDiretoria });
  assert.equal(detail.status, 200);
  const updateEvent = detail.body.history.find(event => event.action === 'UPDATE');
  assert.ok(updateEvent, 'a reatribuição de responsável gera um evento de auditoria UPDATE');
  assert.equal(updateEvent.before.responsibleUserId, undefined, 'auditoria preserva o estado ANTES da atribuição');
  assert.equal(updateEvent.after.responsibleUserId, 'usr-teste-responsavel-ativo', 'auditoria preserva o estado DEPOIS da atribuição');
});

test('[HTTP] PATCH de responsável: atribuição a usuário INATIVO é rejeitada com 422, sem alterar o registro', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo para tentativa de responsável inativo (Fase 4B)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const id = created.body.id;

  const patched = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { responsibleUserId: 'usr-teste-responsavel-inativo' } });
  assert.equal(patched.status, 422);

  const after = await api('GET', `/api/entities/legalDeadlines`, { token });
  const item = after.body.find(i => i.id === id);
  assert.equal(item.responsibleUserId, undefined, 'a tentativa rejeitada não altera o registro');
  assert.equal(item.version, created.body.version, 'version não é incrementada em uma atribuição rejeitada');
});

test('[HTTP] PATCH de responsável: remover responsável (responsibleUserId nulo) não é suportado nesta fase — 422, sem invenção de "desatribuir"', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo para tentativa de remoção de responsável (Fase 4B)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', responsibleUserId: 'usr-teste-responsavel-ativo' } });
  const id = created.body.id;

  const patched = await api('PATCH', `/api/entities/legalDeadlines/${id}`, { token, json: { responsibleUserId: null } });
  assert.equal(patched.status, 422);

  const after = await api('GET', '/api/entities/legalDeadlines', { token });
  const item = after.body.find(i => i.id === id);
  assert.equal(item.responsibleUserId, 'usr-teste-responsavel-ativo', 'responsibleUserId permanece intacto após a tentativa rejeitada de remoção');
});

test('[HTTP] D4.11: responsável que se torna inativo depois não é apagado do Legal Deadline; view sinaliza responsibleInactive', async () => {
  const store = readStore();
  store.users.push({ id: 'usr-teste-fica-inativo', name: 'Fica Inativo Teste', email: 'fica.inativo.teste@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false });
  writeStore(store);

  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo D4.11 (Fase 4B)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL', responsibleUserId: 'usr-teste-fica-inativo' } });
  const id = created.body.id;

  const storeNow = readStore();
  storeNow.users.find(u => u.id === 'usr-teste-fica-inativo').deletedAt = new Date().toISOString();
  writeStore(storeNow);

  const detail = await api('GET', `/api/entities/legalDeadlines/${id}/detail`, { token });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.responsibleUserId, 'usr-teste-fica-inativo', 'responsibleUserId nunca é apagado quando o usuário se torna inativo');
  assert.equal(detail.body.responsibleInactive, true, 'view sinaliza "responsável inativo"');
  assert.equal(detail.body.status, 'ativo', 'status do Legal Deadline não é alterado pela inatividade do responsável');
});

test('[HTTP] GET /api/my-week: Legal Deadline do usuário logado dentro da semana civil corrente aparece; de outro usuário não aparece', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const civilWeek = require('../server').civilWeekWindow();
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Minha Semana — meu prazo (Fase 4B)', date: civilWeek.start, originType: 'JUDICIAL_PROCESSUAL', responsibleUserId: 'usr-teste-responsavel-ativo' } });
  assert.equal(created.status, 201);
  const createdOutro = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Minha Semana — de outro usuário (Fase 4B)', date: civilWeek.start, originType: 'JUDICIAL_PROCESSUAL', responsibleUserId: 'usr-teste-lider-juridico' } });
  assert.equal(createdOutro.status, 201);

  const tokenResponsavel = await loginAs(EMAILS.responsavelAtivo);
  const myWeek = await api('GET', '/api/my-week', { token: tokenResponsavel });
  assert.equal(myWeek.status, 200);
  assert.ok(myWeek.body.items.some(i => i.entityId === created.body.id), 'aparece o Legal Deadline do próprio usuário logado, dentro da semana civil corrente');
  assert.ok(!myWeek.body.items.some(i => i.entityId === createdOutro.body.id), 'nunca aparece o Legal Deadline atribuído a outro usuário');
  assert.equal(myWeek.body.window.start, civilWeek.start);
  assert.equal(myWeek.body.window.end, civilWeek.end);
});

test('[HTTP] GET /api/my-week: companyId fora de escopo bloqueia o item mesmo sendo o responsável (defesa em profundidade)', async () => {
  const store = readStore();
  store.records.processos.push({ id: 'proc-fase4b-empresa-b', source: 'monday', department: 'Jurídico', companyId: 'fase4b-empresa-b', scopeType: 'company', title: 'Processo Fase 4B Empresa B', deletedAt: null });
  store.users.push({ id: 'usr-teste-fase4b-empresa-a', name: 'Responsável Fase4B Empresa A', email: 'responsavel.fase4b.empresa.a@coevo.local', role: 'colaborador', department: 'Jurídico', companyId: 'fase4b-empresa-a', scopeType: 'company', mfa: false });
  writeStore(store);

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const civilWeek = require('../server').civilWeekWindow();
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenDiretoria, json: { processId: 'proc-fase4b-empresa-b', origin: 'Minha Semana — empresa B (Fase 4B)', date: civilWeek.start, originType: 'JUDICIAL_PROCESSUAL', responsibleUserId: 'usr-teste-fase4b-empresa-a', companyId: 'fase4b-empresa-b', scopeType: 'company' } });
  assert.equal(created.status, 201);

  const tokenEmpresaA = await loginAs('responsavel.fase4b.empresa.a@coevo.local');
  const myWeek = await api('GET', '/api/my-week', { token: tokenEmpresaA });
  assert.equal(myWeek.status, 200);
  assert.ok(!myWeek.body.items.some(i => i.entityId === created.body.id), 'responsibleUserId não amplia autorização — scoped() por companyId continua bloqueando');
});

test('[HTTP] GET /api/my-week: speId fora de escopo bloqueia o item mesmo sendo o responsável', async () => {
  const store = readStore();
  store.records.processos.push({ id: 'proc-fase4b-spe-y', source: 'monday', department: 'Jurídico', speId: 'fase4b-spe-y', scopeType: 'spe', title: 'Processo Fase 4B SPE Y', deletedAt: null });
  store.users.push({ id: 'usr-teste-fase4b-spe-x', name: 'Responsável Fase4B SPE X', email: 'responsavel.fase4b.spe.x@coevo.local', role: 'colaborador', department: 'Jurídico', speId: 'fase4b-spe-x', scopeType: 'spe', mfa: false });
  writeStore(store);

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const civilWeek = require('../server').civilWeekWindow();
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenDiretoria, json: { processId: 'proc-fase4b-spe-y', origin: 'Minha Semana — SPE Y (Fase 4B)', date: civilWeek.start, originType: 'JUDICIAL_PROCESSUAL', responsibleUserId: 'usr-teste-fase4b-spe-x', speId: 'fase4b-spe-y', scopeType: 'spe' } });
  assert.equal(created.status, 201);

  const tokenSpeX = await loginAs('responsavel.fase4b.spe.x@coevo.local');
  const myWeek = await api('GET', '/api/my-week', { token: tokenSpeX });
  assert.equal(myWeek.status, 200);
  assert.ok(!myWeek.body.items.some(i => i.entityId === created.body.id));
});

test('[HTTP] GET /api/my-week: líder de TI não recebe conteúdo jurídico de outro usuário, mesmo autenticado', async () => {
  const tokenTi = await loginAs(EMAILS.liderTi);
  const myWeek = await api('GET', '/api/my-week', { token: tokenTi });
  assert.equal(myWeek.status, 200);
  assert.deepEqual(myWeek.body.items.filter(i => i.entityType === 'legalDeadline'), [], 'TI nunca recebe Legal Deadline em Minha Semana, mesmo que exista algum atribuído por engano a outro id');
});

test('[HTTP] GET /api/my-week: administrador técnico não ganha conteúdo jurídico por ter módulos de gestão de sistema', async () => {
  const tokenAdministrador = await loginAs(EMAILS.administrador);
  const myWeek = await api('GET', '/api/my-week', { token: tokenAdministrador });
  assert.equal(myWeek.status, 200);
  assert.deepEqual(myWeek.body.items.filter(i => i.entityType === 'legalDeadline'), []);
});

test('[HTTP] GET /api/my-week: diretoria só vê em Minha Semana os Legal Deadlines atribuídos à própria diretoria, não o consolidado de todos os usuários', async () => {
  const tokenJuridico = await loginAs(EMAILS.liderJuridico);
  const civilWeek = require('../server').civilWeekWindow();
  const created = await api('POST', '/api/entities/legalDeadlines', { token: tokenJuridico, json: { processId: 'proc-juridico-teste', origin: 'Minha Semana — não é da diretoria (Fase 4B)', date: civilWeek.start, originType: 'JUDICIAL_PROCESSUAL', responsibleUserId: 'usr-teste-responsavel-ativo' } });
  assert.equal(created.status, 201);

  const tokenDiretoria = await loginAs(EMAILS.diretoria);
  const myWeek = await api('GET', '/api/my-week', { token: tokenDiretoria });
  assert.equal(myWeek.status, 200);
  assert.ok(!myWeek.body.items.some(i => i.entityId === created.body.id), 'Minha Semana é pessoal por identidade/atribuição — alçada global de negócio não torna a diretoria "responsável" por todos os prazos');
});

test('[HTTP] GET /api/my-week não cria nem altera nenhum registro (é uma view pura, chamadas repetidas são idempotentes)', async () => {
  const before = JSON.stringify(readStore());
  const token = await loginAs(EMAILS.responsavelAtivo);
  await api('GET', '/api/my-week', { token });
  await api('GET', '/api/my-week', { token });
  const after = JSON.stringify(readStore());
  assert.equal(after, before, 'GET /api/my-week nunca persiste nada (nenhuma coleção myWeek/weeklyItems/weekSnapshot é criada nem qualquer registro existente é alterado)');
});

test('[HTTP] D4.15: GET /api/agenda-items por padrão só mostra ativo/vencido; cumprido/cancelado/suspenso ficam de fora, mas continuam acessíveis via listagem/detalhe/includeInactive', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const ativo = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'D4.15 ativo', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const paraCumprir = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'D4.15 cumprido', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const paraCancelar = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'D4.15 cancelado', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const paraSuspender = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'D4.15 suspenso', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  await api('PATCH', `/api/entities/legalDeadlines/${paraCumprir.body.id}`, { token, json: { status: 'cumprido' } });
  await api('PATCH', `/api/entities/legalDeadlines/${paraCancelar.body.id}`, { token, json: { status: 'cancelado' } });
  await api('PATCH', `/api/entities/legalDeadlines/${paraSuspender.body.id}`, { token, json: { status: 'suspenso' } });

  const defaultAgenda = await api('GET', '/api/agenda-items', { token });
  const idsDefault = defaultAgenda.body.items.map(i => i.entityId);
  assert.ok(idsDefault.includes(ativo.body.id), 'ativo/vencido continua aparecendo por padrão');
  assert.ok(!idsDefault.includes(paraCumprir.body.id), 'cumprido não aparece por padrão (D4.15)');
  assert.ok(!idsDefault.includes(paraCancelar.body.id), 'cancelado não aparece por padrão (D4.15)');
  assert.ok(!idsDefault.includes(paraSuspender.body.id), 'suspenso não aparece por padrão (D4.15)');

  const includeInactive = await api('GET', '/api/agenda-items?includeInactive=1', { token });
  const idsIncluding = includeInactive.body.items.map(i => i.entityId);
  for (const id of [ativo.body.id, paraCumprir.body.id, paraCancelar.body.id, paraSuspender.body.id]) {
    assert.ok(idsIncluding.includes(id), `?includeInactive=1 continua devolvendo ${id}, sem criar uma API paralela`);
  }

  // Os mesmos itens fechados continuam acessíveis pela listagem/filtro/detalhe já existentes de Legal
  // Deadline — nenhum registro foi apagado nem teve status alterado por esta view.
  const listagemCumprido = await api('GET', '/api/entities/legalDeadlines?paginated=1&status=cumprido', { token });
  assert.ok(listagemCumprido.body.records.some(r => r.id === paraCumprir.body.id));
  const detalheSuspenso = await api('GET', `/api/entities/legalDeadlines/${paraSuspender.body.id}/detail`, { token });
  assert.equal(detalheSuspenso.status, 200);
  assert.equal(detalheSuspenso.body.status, 'suspenso');

  const store = readStore();
  for (const id of [ativo.body.id, paraCumprir.body.id, paraCancelar.body.id, paraSuspender.body.id]) {
    assert.ok(store.records.legalDeadlines.some(item => item.id === id && !item.deletedAt), `nenhum registro (${id}) foi fisicamente apagado`);
  }
});

test('[HTTP] D4.5/D4.6/D4.4: Agenda/Atenção/detalhe expõem originTypeLabel/statusLabel/confirmationLabel; requires_review nunca mostra "Confirmado pelo Jurídico"', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const valido = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'D4.5/D4.6 válido', date: '2026-12-01', originType: 'INTERNAL_CONTROL' } });
  assert.equal(valido.status, 201);

  const agendaItems = await api('GET', '/api/agenda-items', { token });
  const agendaItem = agendaItems.body.items.find(i => i.entityId === valido.body.id);
  assert.equal(agendaItem.originTypeLabel, 'Controle interno');
  assert.equal(agendaItem.statusLabel, 'Ativo');
  assert.equal(agendaItem.confirmationLabel, 'Confirmado pelo Jurídico');

  const detail = await api('GET', `/api/entities/legalDeadlines/${valido.body.id}/detail`, { token });
  assert.equal(detail.body.originTypeLabel, 'Controle interno');
  assert.equal(detail.body.confirmationLabel, 'Confirmado pelo Jurídico');

  const legado = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'D4.4 requires_review', date: '2020-01-01', originType: 'JUDICIAL_PROCESSUAL' } });
  const storeForce = readStore();
  const legadoItem = storeForce.records.legalDeadlines.find(i => i.id === legado.body.id);
  delete legadoItem.originType;
  writeStore(storeForce);

  const attention = await api('GET', '/api/attention', { token });
  const attentionItem = attention.body.items.find(i => i.entityId === legado.body.id);
  assert.equal(attentionItem.category, 'REQUIRES_REVIEW');
  assert.equal(attentionItem.categoryLabel, 'Requer revisão');
  assert.equal(attentionItem.confirmationLabel, null, 'requires_review nunca é tratado como "Confirmado pelo Jurídico"');
});

test('[HTTP] GET /api/calendar/status e /api/calendar/events: adapter somente leitura, nunca expõe token/segredo, nenhuma escrita', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const status = await api('GET', '/api/calendar/status', { token });
  assert.equal(status.status, 200);
  assert.equal(typeof status.body.configured, 'boolean');
  assert.equal(status.body.connected, false);
  assert.ok(['not_configured', 'unavailable'].includes(status.body.status));
  const serialized = JSON.stringify(status.body).toLowerCase();
  assert.ok(!serialized.includes('token') && !serialized.includes('secret') && !serialized.includes('client_secret'), 'resposta de status nunca inclui token/segredo');

  const events = await api('GET', '/api/calendar/events', { token });
  assert.equal(events.status, 200);
  assert.deepEqual(events.body.events, [], 'sem credenciais reais de OAuth configuradas neste ambiente, a leitura fica bloqueada por design (adapter), nunca simulada/inventada');
  const serializedEvents = JSON.stringify(events.body).toLowerCase();
  assert.ok(!serializedEvents.includes('token') && !serializedEvents.includes('secret'));
});

test('[HTTP] Google Calendar: falha/indisponibilidade da integração nunca afeta Legal Deadline nem esconde a Agenda canônica', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const created = await api('POST', '/api/entities/legalDeadlines', { token, json: { processId: 'proc-juridico-teste', origin: 'Prazo independente do Calendar (Fase 4B)', date: '2026-12-01', originType: 'JUDICIAL_PROCESSUAL' } });
  assert.equal(created.status, 201);

  await api('GET', '/api/calendar/events', { token });
  await api('GET', '/api/calendar/status', { token });

  const agendaItems = await api('GET', '/api/agenda-items', { token });
  assert.ok(agendaItems.body.items.some(i => i.entityId === created.body.id), 'Legal Deadline continua visível na Agenda independentemente do estado da integração de Calendar');
  const detail = await api('GET', `/api/entities/legalDeadlines/${created.body.id}/detail`, { token });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.status, 'ativo', 'status não é alterado por indisponibilidade do Calendar');
});

test('[HTTP] Google Calendar: leitura repetida nunca cria Legal Deadline/Task/evento de Agenda novo (sem espelhamento/duplicação)', async () => {
  const token = await loginAs(EMAILS.liderJuridico);
  const beforeLegal = readStore().records.legalDeadlines.length;
  const beforeAgenda = readStore().agenda.length;

  await api('GET', '/api/calendar/events', { token });
  await api('GET', '/api/calendar/events', { token });
  await api('GET', '/api/calendar/status', { token });

  const store = readStore();
  assert.equal(store.records.legalDeadlines.length, beforeLegal, 'leitura do Calendar nunca cria Legal Deadline');
  assert.equal(store.agenda.length, beforeAgenda, 'leitura do Calendar nunca cria evento de Agenda');
  assert.ok(!Object.keys(store).some(key => /calendarevent|calendarsnapshot|mirroredcalendar/i.test(key)), 'nenhuma coleção canônica paralela de eventos de Calendar foi criada');
});

test('[HTTP] GET /api/my-week combina Legal Deadline com a leitura (vazia, adapter) do Google Calendar, sem misturar as duas fontes', async () => {
  const token = await loginAs(EMAILS.responsavelAtivo);
  const myWeek = await api('GET', '/api/my-week', { token });
  assert.equal(myWeek.status, 200);
  assert.ok('calendar' in myWeek.body, 'resposta de Minha Semana expõe o estado da integração de Calendar (configured/connected/status)');
  assert.ok(!myWeek.body.items.some(i => i.entityType === 'calendarEvent'), 'sem integração real configurada neste ambiente, nenhum evento de Calendar é sintetizado/inventado na resposta');
});
