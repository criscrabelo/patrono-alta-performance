#!/usr/bin/env node
// Sprint 2, Hardening H7 (docs/PRODUCTION_GATE.md, PG-20; docs/DECISIONS.md, PROD-H7-01): gera um
// arquivo local de incidente a partir do modelo de docs/incidents/INCIDENT_TEMPLATE.md — provider-
// neutro, nunca persiste em produção automaticamente, nunca cria um banco paralelo. Uso:
//   node scripts/create-incident.js --severity SEV-2 --category AVAILABILITY [--summary "texto"]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SEVERITIES = new Set(['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4']);
const CATEGORIES = new Set([
  'AUTH', 'ACCESS_CONTROL', 'DATA_EXPOSURE', 'DATA_INTEGRITY', 'DATA_LOSS', 'AVAILABILITY',
  'MALWARE_OR_COMPROMISE', 'SECRETS', 'BACKUP_RESTORE', 'INTEGRATION', 'CONFIGURATION',
  'LEGAL_OPERATIONAL', 'OTHER'
]);
// Correção de robustez (item 31 do escopo H7): summary é texto livre operacional, nunca um caminho —
// nunca interpolado em um path, só no conteúdo do markdown gerado. Ainda assim, removemos quebra de
// linha (impede que o "resumo" injete uma segunda linha/campo no arquivo gerado) e limitamos o tamanho.
const MAX_SUMMARY_LENGTH = 500;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
    args[key] = value;
    if (value) i += 1;
  }
  return args;
}

function sanitizeSummary(raw) {
  const value = String(raw || '').replace(/[\r\n]+/g, ' ').trim();
  return value.slice(0, MAX_SUMMARY_LENGTH) || '(resumo não fornecido)';
}

// Formato INC-YYYYMMDD-XXXXXXXX (docs/INCIDENT_RESPONSE.md, seção 10) — sufixo aleatório via
// crypto.randomBytes (nunca um contador incremental previsível). `attempt` é aceito só para manter a
// mesma assinatura de um `generateIdOverride` de teste (ver createIncident()) — o gerador real nunca
// precisa dele, pois cada chamada já é independentemente aleatória.
function generateIncidentId(now = new Date(), _attempt) {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `INC-${datePart}-${randomPart}`;
}

function renderIncidentMarkdown({ incidentId, severity, category, summary, detectedAt }) {
  return `# Incident Record — ${incidentId}

incidentId:                  ${incidentId}
detectedAt:                  ${detectedAt}
reportedAt:                  ${detectedAt}
severity:                    ${severity}
category:                    ${category}
status:                      DETECTED
summary:                     ${summary}

incidentCommander:            (preencher)
technicalLead:                (preencher)
securityPrivacyLead:          (preencher)
businessLegalLead:            (preencher)

affectedSystems:             (preencher)
affectedEnvironment:         (preencher)
detectionSource:             (preencher)

requestIds:                  (preencher)
backupIds:                   (preencher)
restoreIds:                  (preencher)

timeline:
  - timestamp: ${detectedAt}
    actorRole: (preencher)
    action: Incidente registrado via scripts/create-incident.js
    result: Registro criado
    reference: ${incidentId}

containmentActions:          (preencher)
recoveryActions:             (preencher)
evidenceReferences:          (preencher)
communications:              (preencher)

dataExposureSuspected:       false
dataExposureConfirmed:       false
legalAssessmentRequired:     false
legalHoldReviewRequired:     false

rootCause:                   (preencher)
resolvedAt:                  (preencher)
closedAt:                    (preencher)

---
Gerado a partir de docs/incidents/INCIDENT_TEMPLATE.md — ver docs/INCIDENT_RESPONSE.md para o processo
completo. Nunca preencher os campos acima com segredo, token, senha ou payload integral de requisição.
`;
}

// Diretório de saída FIXO (item 32 do escopo) — nunca aceita um caminho vindo do usuário, elimina
// qualquer possibilidade de path traversal por construção (não há input de path a validar).
//
// IMPORTANTE (semântica de evidência, correção pós-implementação — revisão técnica final, PR #18): este
// registro local de incidente é uma FERRAMENTA OPERACIONAL de criação de registro — um arquivo em
// `incidents/` (diretório local, ignorado pelo Git), nunca um armazenamento forense/durável de produção.
// Eventual persistência/armazenamento durável (backup do próprio registro, retenção, replicação) depende
// do ambiente/processo operacional em que este script roda — isso é explicitamente H8 (retenção/legal
// hold)/H11 (deploy/infraestrutura), nunca implementado aqui.
function incidentsDir(baseDir = path.join(__dirname, '..')) {
  return path.join(baseDir, 'incidents');
}

// Correção pós-implementação (revisão técnica final, PR #18, item 1): a checagem anterior
// (`fs.existsSync()` seguida de `fs.writeFileSync()`) tinha uma janela TOCTOU entre verificar e
// escrever — duas chamadas concorrentes podiam, em teoria, ambas passar pela checagem antes de
// qualquer uma escrever. Corrigido com criação EXCLUSIVA atômica (`flag: 'wx'` — o próprio kernel
// garante que a chamada falha com EEXIST se o arquivo já existir, sem essa janela). Se colidir (o que só
// pode acontecer por coincidência do sufixo aleatório de 4 bytes, nunca por um contador prevísivel), o
// arquivo existente NUNCA é tocado — geramos um novo `incidentId` e tentamos de novo, até
// `MAX_ID_ATTEMPTS`.
const MAX_ID_ATTEMPTS = 5;

function writeIncidentFileExclusive(filePath, content) {
  fs.writeFileSync(filePath, content, { mode: 0o600, flag: 'wx' });
}

function createIncident({ severity, category, summary, now = new Date(), baseDir, generateIdOverride } = {}) {
  if (!SEVERITIES.has(severity)) {
    throw new Error(`Severidade inválida: "${severity}". Valores aceitos: ${[...SEVERITIES].join(', ')}.`);
  }
  if (!CATEGORIES.has(category)) {
    throw new Error(`Categoria inválida: "${category}". Valores aceitos: ${[...CATEGORIES].join(', ')}.`);
  }
  const dir = incidentsDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });

  const detectedAt = now.toISOString();
  const idGenerator = generateIdOverride || generateIncidentId;

  for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt += 1) {
    const incidentId = idGenerator(now, attempt);
    const filePath = path.join(dir, `${incidentId}.md`);
    const content = renderIncidentMarkdown({ incidentId, severity, category, summary: sanitizeSummary(summary), detectedAt });
    try {
      writeIncidentFileExclusive(filePath, content);
      return { incidentId, filePath, attempts: attempt };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Colisão real: o arquivo existente nunca é tocado (a escrita exclusiva nem chegou a abrir o
      // arquivo para escrita) — apenas tentamos outro incidentId.
    }
  }
  throw new Error(`Não foi possível gerar um incidentId único após ${MAX_ID_ATTEMPTS} tentativas — todas colidiram com um registro já existente em ${dir}.`);
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { incidentId, filePath } = createIncident({ severity: args.severity, category: args.category, summary: args.summary });
    console.log(`Incidente registrado: ${incidentId}`);
    console.log(`Arquivo: ${filePath}`);
  } catch (error) {
    console.error(`Falha ao criar registro de incidente: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { createIncident, generateIncidentId, SEVERITIES, CATEGORIES, incidentsDir, sanitizeSummary, MAX_ID_ATTEMPTS };
