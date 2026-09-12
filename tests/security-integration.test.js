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

let server;
let baseUrl;

const EMAILS = {
  liderJuridico: 'lider.juridico.teste@coevo.local',
  colaboradorJuridico: 'colaborador.juridico.teste@coevo.local',
  liderTi: 'lider.ti.teste@coevo.local',
  semAcesso: 'sem.acesso.teste@coevo.local'
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
    { id: 'usr-teste-sem-acesso', name: 'Sem Acesso Teste', email: EMAILS.semAcesso, role: 'externo', department: null, mfa: false }
  );
  if (!store.records) store.records = {};
  store.records.processos = [
    { id: 'proc-juridico-teste', source: 'monday', externalId: 'ext-1', module: 'processos', department: 'Jurídico', title: 'Processo Jurídico de Teste', deletedAt: null },
    // Registro sintético para testar a checagem de escopo do processId relacionado — na prática todo
    // board Monday sincronizado hoje é do Jurídico (normalizeMondayItem), mas a validação de
    // integridade relacional de Legal Deadline precisa negar corretamente mesmo que uma fonte futura
    // introduza processos de outro departamento.
    { id: 'proc-ti-teste', source: 'monday', externalId: 'ext-2', module: 'processos', department: 'TI', title: 'Processo TI de Teste (sintético, apenas para o teste)', deletedAt: null }
  ];
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
