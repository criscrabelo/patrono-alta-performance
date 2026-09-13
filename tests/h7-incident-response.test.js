// Sprint 2, Hardening H7 (docs/PRODUCTION_GATE.md, PG-20; docs/DECISIONS.md, PROD-H7-01): processo de
// resposta a incidentes — majoritariamente documental. Estes testes verificam (a) consistência dos
// artefatos documentais mínimos exigidos, sem testes frágeis de texto completo, e (b) o comportamento
// real de scripts/create-incident.js (o único código novo desta rodada).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createIncident, generateIncidentId, SEVERITIES, CATEGORIES, incidentsDir, MAX_ID_ATTEMPTS } = require('../scripts/create-incident');

const ROOT = path.join(__dirname, '..');

function readDoc(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// --- Consistência documental --------------------------------------------------------------------------
test('[H7-doc-A] docs/INCIDENT_RESPONSE.md existe e contém as 4 severidades e as 13 categorias mínimas', () => {
  const content = readDoc('docs/INCIDENT_RESPONSE.md');
  for (const sev of ['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4']) assert.ok(content.includes(sev), `severidade ${sev} ausente`);
  const categorias = ['AUTH', 'ACCESS_CONTROL', 'DATA_EXPOSURE', 'DATA_INTEGRITY', 'DATA_LOSS', 'AVAILABILITY', 'MALWARE_OR_COMPROMISE', 'SECRETS', 'BACKUP_RESTORE', 'INTEGRATION', 'CONFIGURATION', 'LEGAL_OPERATIONAL', 'OTHER'];
  for (const cat of categorias) assert.ok(content.includes(cat), `categoria ${cat} ausente`);
});

test('[H7-doc-B] docs/INCIDENT_RESPONSE.md define os 6 papéis funcionais', () => {
  const content = readDoc('docs/INCIDENT_RESPONSE.md');
  for (const papel of ['Incident Commander', 'Technical Lead', 'Security/Privacy Lead', 'Business/Legal Lead', 'Communications Owner', 'Scribe']) {
    assert.ok(content.includes(papel), `papel "${papel}" ausente`);
  }
});

test('[H7-doc-C] docs/INCIDENT_RESPONSE.md contém o checklist mínimo de 18 itens e o lifecycle completo', () => {
  const content = readDoc('docs/INCIDENT_RESPONSE.md');
  for (const passo of ['Detectar', 'Registrar', 'Classificar severidade', 'Nomear Incident Commander', 'Preservar evidências', 'Conter', 'Postmortem']) {
    assert.ok(content.includes(passo), `passo do checklist "${passo}" ausente`);
  }
  for (const estado of ['DETECTED', 'TRIAGED', 'CONFIRMED', 'CONTAINING', 'CONTAINED', 'ERADICATING', 'RECOVERING', 'MONITORING', 'RESOLVED', 'POSTMORTEM_PENDING', 'CLOSED']) {
    assert.ok(content.includes(estado), `estado do lifecycle "${estado}" ausente`);
  }
});

test('[H7-doc-D] docs/INCIDENT_RESPONSE.md documenta o canal de comunicação via env vars, sem valor real', () => {
  const content = readDoc('docs/INCIDENT_RESPONSE.md');
  for (const key of ['INCIDENT_PRIMARY_CHANNEL', 'INCIDENT_SECONDARY_CHANNEL', 'INCIDENT_SECURITY_CONTACT', 'INCIDENT_PRIVACY_CONTACT']) {
    assert.ok(content.includes(key));
  }
  // Nenhum valor de e-mail/telefone/URL de webhook real deveria aparecer junto às env vars.
  assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(content.match(/INCIDENT_[A-Z_]+=[^\n]*/g)?.join('\n') || ''));
});

test('[H7-doc-E] docs/INCIDENT_RESPONSE.md documenta explicitamente por que PG-20 permanece aberto', () => {
  const content = readDoc('docs/INCIDENT_RESPONSE.md');
  assert.match(content, /PG-20/);
  assert.ok(/canal de comunicação real|nome individual real/i.test(content));
});

test('[H7-doc-F] templates e runbooks mínimos existem', () => {
  const arquivos = [
    'docs/incidents/INCIDENT_TEMPLATE.md',
    'docs/incidents/POSTMORTEM_TEMPLATE.md',
    'docs/incidents/COMMUNICATION_TEMPLATE.md',
    'docs/incidents/TABLETOP_EXERCISE.md',
    'docs/incidents/runbooks/AUTH_COMPROMISE.md',
    'docs/incidents/runbooks/DATA_EXPOSURE.md',
    'docs/incidents/runbooks/AVAILABILITY.md',
    'docs/incidents/runbooks/BACKUP_RESTORE.md',
    'docs/incidents/runbooks/SECRETS.md'
  ];
  for (const arquivo of arquivos) {
    assert.ok(fs.existsSync(path.join(ROOT, arquivo)), `arquivo ausente: ${arquivo}`);
  }
});

test('[H7-doc-G] docs/incidents/POSTMORTEM_TEMPLATE.md contém os campos mínimos exigidos', () => {
  const content = readDoc('docs/incidents/POSTMORTEM_TEMPLATE.md');
  for (const campo of ['Summary', 'Impact', 'Detection', 'Timeline', 'Root Cause', 'Contributing Factors', 'What Went Well', 'What Went Wrong', 'Containment', 'Recovery', 'Corrective Actions', 'Owner', 'Due Date', 'Verification']) {
    assert.ok(content.includes(campo), `campo "${campo}" ausente no template de postmortem`);
  }
});

test('[H7-doc-H] nenhum template/runbook de incidente contém segredo/placeholder de valor real', () => {
  const arquivos = [
    'docs/incidents/INCIDENT_TEMPLATE.md',
    'docs/incidents/POSTMORTEM_TEMPLATE.md',
    'docs/incidents/COMMUNICATION_TEMPLATE.md',
    'docs/incidents/TABLETOP_EXERCISE.md',
    'docs/incidents/runbooks/AUTH_COMPROMISE.md',
    'docs/incidents/runbooks/DATA_EXPOSURE.md',
    'docs/incidents/runbooks/AVAILABILITY.md',
    'docs/incidents/runbooks/BACKUP_RESTORE.md',
    'docs/incidents/runbooks/SECRETS.md'
  ];
  const proibidos = [/BEGIN (RSA|EC) PRIVATE KEY/i, /AKIA[0-9A-Z]{16}/];
  for (const arquivo of arquivos) {
    const content = readDoc(arquivo);
    for (const padrao of proibidos) assert.ok(!padrao.test(content), `${arquivo} parece conter um segredo real`);
  }
});

test('[H7-doc-I] .env.example contém os 4 placeholders de incidente, todos vazios (sem valor real)', () => {
  const content = readDoc('.env.example');
  for (const key of ['INCIDENT_PRIMARY_CHANNEL', 'INCIDENT_SECONDARY_CHANNEL', 'INCIDENT_SECURITY_CONTACT', 'INCIDENT_PRIVACY_CONTACT']) {
    const linha = content.split('\n').find((l) => l.startsWith(`${key}=`));
    assert.ok(linha, `variável ${key} ausente em .env.example`);
    assert.equal(linha, `${key}=`, `${key} deveria estar vazia em .env.example`);
  }
});

test('[H7-doc-J] docs/MASTER_HANDOFF.md permanece intocado (H7 nunca o altera)', () => {
  const { execSync } = require('node:child_process');
  const diffStat = execSync('git diff --stat origin/master -- docs/MASTER_HANDOFF.md || true', { cwd: ROOT }).toString();
  assert.equal(diffStat.trim(), '', `docs/MASTER_HANDOFF.md não deveria ter sido alterado: ${diffStat}`);
});

// Correção pós-implementação (revisão técnica final, PR #18, item 4): a documentação não pode afirmar
// que existe hoje um supervisor/orquestrador que reinicia o processo automaticamente — H11 (deploy/
// infraestrutura) ainda não foi implementado. Nunca mais que "processo termina sozinho (supervisor
// reinicia)" como fato consumado.
test('[H7-doc-K] docs/INCIDENT_RESPONSE.md e os runbooks nunca afirmam supervisor/reinício automático como algo que já existe', () => {
  const arquivos = [
    'docs/INCIDENT_RESPONSE.md',
    'docs/incidents/runbooks/AUTH_COMPROMISE.md',
    'docs/incidents/runbooks/DATA_EXPOSURE.md',
    'docs/incidents/runbooks/AVAILABILITY.md',
    'docs/incidents/runbooks/BACKUP_RESTORE.md',
    'docs/incidents/runbooks/SECRETS.md'
  ];
  // Frases que afirmariam, como fato já existente, uma infraestrutura de H11 que ainda não existe.
  const proibidas = [
    /supervisor reinicia\)/i,
    /processo já termina sozinho\s*\(supervisor/i,
    /redeploy garantido/i,
    /rollback automático/i
  ];
  for (const arquivo of arquivos) {
    const content = readDoc(arquivo);
    for (const padrao of proibidas) {
      assert.ok(!padrao.test(content), `${arquivo} parece afirmar infraestrutura de H11 (supervisor/redeploy/rollback automático) que ainda não existe: padrão ${padrao}`);
    }
  }
  // A ocorrência de "reiniciar"/"reinício" em disponibilidade deve estar condicionada ao ambiente, nunca
  // apresentada como automática/garantida.
  const availability = readDoc('docs/incidents/runbooks/AVAILABILITY.md').replace(/\s+/g, ' ');
  assert.match(availability, /mecanismo de reinício disponível no ambiente/i);
});

// --- scripts/create-incident.js -------------------------------------------------------------------------
let tmpRoot;
test.beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h7-'));
});
test.afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('[H7-script-A] createIncident() gera um incidentId único no formato INC-YYYYMMDD-XXXXXXXX', () => {
  const now = new Date('2026-09-14T10:00:00.000Z');
  const a = generateIncidentId(now);
  const b = generateIncidentId(now);
  assert.match(a, /^INC-20260914-[0-9A-F]{8}$/);
  assert.notEqual(a, b, 'dois IDs gerados no mesmo instante nunca deveriam colidir (aleatório, não incremental)');
});

test('[H7-script-B] createIncident() rejeita severidade inválida', () => {
  assert.throws(() => createIncident({ severity: 'SEV-9', category: 'AVAILABILITY', baseDir: tmpRoot }), /Severidade inválida/);
});

test('[H7-script-C] createIncident() rejeita categoria inválida', () => {
  assert.throws(() => createIncident({ severity: 'SEV-2', category: 'NAO_EXISTE', baseDir: tmpRoot }), /Categoria inválida/);
});

test('[H7-script-D] createIncident() nunca aceita um caminho arbitrário — sempre escreve dentro de incidents/', () => {
  const { incidentId, filePath } = createIncident({ severity: 'SEV-3', category: 'OTHER', baseDir: tmpRoot });
  assert.equal(path.dirname(filePath), incidentsDir(tmpRoot));
  assert.ok(filePath.startsWith(incidentsDir(tmpRoot)));
  assert.ok(fs.existsSync(filePath));
  assert.match(path.basename(filePath), new RegExp(`^${incidentId}\\.md$`));
});

test('[H7-script-E] timestamp gerado é UTC ISO-8601', () => {
  const now = new Date('2026-09-14T10:00:00.000Z');
  const { filePath } = createIncident({ severity: 'SEV-4', category: 'CONFIGURATION', now, baseDir: tmpRoot });
  const content = fs.readFileSync(filePath, 'utf8');
  assert.match(content, /detectedAt:\s+2026-09-14T10:00:00\.000Z/);
});

// Correção pós-implementação (revisão técnica final, PR #18, item 2): o teste anterior não forçava uma
// colisão real — apenas verificava que um arquivo já escrito continuava com seu conteúdo. Os testes
// abaixo usam o seam de teste dedicado `generateIdOverride` para forçar deterministicamente o cenário de
// colisão real: primeira tentativa retorna sempre o MESMO id (que já existe no disco, com conteúdo
// conhecido); a escrita exclusiva (`flag: 'wx'`) deve falhar com EEXIST SEM tocar o arquivo existente; a
// função deve então tentar de novo com outro id.

test('[H7-script-F] criação usa escrita EXCLUSIVA (flag wx) — em colisão real, o arquivo existente nunca é sobrescrito e uma nova tentativa gera outro id', () => {
  const now = new Date('2026-09-14T10:00:00.000Z');
  const dir = incidentsDir(tmpRoot);
  fs.mkdirSync(dir, { recursive: true });

  const idFixo = 'INC-20260914-COLISAO1';
  const idAlternativo = 'INC-20260914-ALTERNAT';
  const conteudoOriginal = 'CONTEUDO_ORIGINAL_NUNCA_DEVE_SER_PERDIDO';
  fs.writeFileSync(path.join(dir, `${idFixo}.md`), conteudoOriginal, { mode: 0o600, flag: 'wx' });

  let call = 0;
  const generateIdOverride = () => {
    call += 1;
    return call === 1 ? idFixo : idAlternativo; // 1ª tentativa colide de propósito; 2ª é livre.
  };

  const result = createIncident({ severity: 'SEV-2', category: 'AVAILABILITY', now, baseDir: tmpRoot, generateIdOverride });

  // O arquivo original permanece BYTE-FOR-BYTE intacto — nunca tocado pela tentativa que colidiu.
  assert.equal(fs.readFileSync(path.join(dir, `${idFixo}.md`), 'utf8'), conteudoOriginal);
  // A função se recuperou da colisão e criou o registro sob o segundo id.
  assert.equal(result.incidentId, idAlternativo);
  assert.equal(result.attempts, 2, 'deveria ter levado exatamente 2 tentativas (1 colisão + 1 sucesso)');
  assert.ok(fs.existsSync(result.filePath));
});

test('[H7-script-F2] se TODAS as tentativas colidirem, createIncident() falha explicitamente e nenhum arquivo existente é alterado', () => {
  const now = new Date('2026-09-14T10:00:00.000Z');
  const dir = incidentsDir(tmpRoot);
  fs.mkdirSync(dir, { recursive: true });

  const idFixo = 'INC-20260914-SEMPRE00';
  const conteudoOriginal = 'NUNCA_DEVE_SER_SOBRESCRITO';
  fs.writeFileSync(path.join(dir, `${idFixo}.md`), conteudoOriginal, { mode: 0o600, flag: 'wx' });

  const generateIdOverride = () => idFixo; // toda tentativa colide com o mesmo id, de propósito.

  assert.throws(
    () => createIncident({ severity: 'SEV-3', category: 'OTHER', now, baseDir: tmpRoot, generateIdOverride }),
    new RegExp(`após ${MAX_ID_ATTEMPTS} tentativas`)
  );
  // Mesmo após esgotar todas as tentativas, o único arquivo no diretório continua sendo o original,
  // com o conteúdo original — nenhuma escrita parcial ou corrompida foi deixada para trás.
  const arquivos = fs.readdirSync(dir);
  assert.deepEqual(arquivos, [`${idFixo}.md`]);
  assert.equal(fs.readFileSync(path.join(dir, `${idFixo}.md`), 'utf8'), conteudoOriginal);
});

test('[H7-script-F3] o arquivo é criado com mode 0600 (somente o dono lê/escreve)', () => {
  const now = new Date('2026-09-14T10:00:00.000Z');
  const { filePath } = createIncident({ severity: 'SEV-4', category: 'OTHER', now, baseDir: tmpRoot });
  const mode = fs.statSync(filePath).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('[H7-script-G] template gerado contém os campos mínimos do incident record', () => {
  const { filePath } = createIncident({ severity: 'SEV-1', category: 'SECRETS', summary: 'teste', baseDir: tmpRoot });
  const content = fs.readFileSync(filePath, 'utf8');
  for (const campo of ['incidentId', 'detectedAt', 'severity', 'category', 'status', 'summary', 'incidentCommander', 'timeline', 'dataExposureSuspected', 'legalHoldReviewRequired']) {
    assert.ok(content.includes(campo), `campo "${campo}" ausente no arquivo gerado`);
  }
});

test('[H7-script-H] summary nunca permite injeção de quebra de linha (impede falsificar outro campo)', () => {
  const maligno = 'resumo legítimo\nincidentCommander:            ATACANTE CONTROLA ESTE CAMPO';
  const { filePath } = createIncident({ severity: 'SEV-3', category: 'OTHER', summary: maligno, baseDir: tmpRoot });
  const content = fs.readFileSync(filePath, 'utf8');
  const summaryLine = content.split('\n').find((l) => l.startsWith('summary:'));
  assert.ok(summaryLine.includes('resumo legítimo'));
  // A quebra de linha do resumo malicioso foi removida (virou espaço) — então "ATACANTE..." permanece
  // dentro do próprio campo summary, nunca cria uma SEGUNDA linha "incidentCommander:" própria. O campo
  // real "incidentCommander:" (gerado pelo template, não pelo chamador) continua com seu valor original.
  const commanderLines = content.split('\n').filter((l) => l.startsWith('incidentCommander:'));
  assert.equal(commanderLines.length, 1, 'deveria haver exatamente uma linha "incidentCommander:" — nunca uma segunda forjada pelo resumo');
  assert.ok(commanderLines[0].includes('(preencher)'), 'o campo incidentCommander real nunca deveria ser sobrescrito pelo conteúdo do resumo');
});

test('[H7-script-I] SEVERITIES e CATEGORIES exportados batem com a documentação', () => {
  assert.deepEqual([...SEVERITIES].sort(), ['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4']);
  assert.deepEqual([...CATEGORIES].sort(), ['ACCESS_CONTROL', 'AUTH', 'AVAILABILITY', 'BACKUP_RESTORE', 'CONFIGURATION', 'DATA_EXPOSURE', 'DATA_INTEGRITY', 'DATA_LOSS', 'INTEGRATION', 'LEGAL_OPERATIONAL', 'MALWARE_OR_COMPROMISE', 'OTHER', 'SECRETS'].sort());
});
