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
// crypto.randomBytes (nunca um contador incremental previsível).
function generateIncidentId(now = new Date()) {
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
function incidentsDir(baseDir = path.join(__dirname, '..')) {
  return path.join(baseDir, 'incidents');
}

function createIncident({ severity, category, summary, now = new Date(), baseDir } = {}) {
  if (!SEVERITIES.has(severity)) {
    throw new Error(`Severidade inválida: "${severity}". Valores aceitos: ${[...SEVERITIES].join(', ')}.`);
  }
  if (!CATEGORIES.has(category)) {
    throw new Error(`Categoria inválida: "${category}". Valores aceitos: ${[...CATEGORIES].join(', ')}.`);
  }
  const dir = incidentsDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });

  const incidentId = generateIncidentId(now);
  const filePath = path.join(dir, `${incidentId}.md`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Já existe um registro para ${incidentId} — nunca sobrescrito automaticamente.`);
  }

  const detectedAt = now.toISOString();
  const content = renderIncidentMarkdown({ incidentId, severity, category, summary: sanitizeSummary(summary), detectedAt });
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  return { incidentId, filePath };
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

module.exports = { createIncident, generateIncidentId, SEVERITIES, CATEGORIES, incidentsDir, sanitizeSummary };
