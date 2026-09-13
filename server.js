const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { generatePresentation } = require('./presentation-export');
const { WIDGET_TYPES, getDashboardDefinition, visibleDashboards, dashboardRequiresGlobalScope } = require('./dashboard-model');
const { dashboardPayload } = require('./dashboard-service');
const { PROJECT_ID, ensureProjectStore, projectSummary, projectDetail, projectPermissions, newId } = require('./project-service');
const storage = require('./storage');
const { StoreConflictError } = require('./storage/errors');
const authCrypto = require('./auth/crypto');

const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
// COEVO_DATA_DIR: override reversível e local, usado apenas pela suíte de testes de integração
// (tests/security-integration.test.js) para isolar a store de teste da store real do repositório.
// Em produção/homologação normal a variável não é definida e o caminho padrão é usado.
const DATA_DIR = process.env.COEVO_DATA_DIR ? path.resolve(process.env.COEVO_DATA_DIR) : path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 3007);
const BACKUP_KEY = process.env.COEVO_BACKUP_KEY;
// Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): sessões deixam de
// viver em `sessions = new Map()` (memória do processo, perdida a cada restart, não compartilhada entre
// instâncias) e passam a ser linhas em `auth_sessions` (migrations/005_h2_auth_sessions.sql),
// persistidas pela MESMA ponte relacional de storage/index.js. `SESSION_TTL_MS` preserva a semântica de
// `COEVO_SESSION_MS` já existente (expiração absoluta, default 1h) — sem idle timeout nesta rodada
// (simplificação deliberada, ver docs/SECURITY.md).
const SESSION_TTL_MS = Number(process.env.COEVO_SESSION_MS || 3600000);
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const MONDAY_BOARDS = {
  processos: { id: process.env.MONDAY_BOARD_PROCESSOS || '5959705266', name: 'Processos Judiciais' },
  notificacoes: { id: process.env.MONDAY_BOARD_NOTIFICACOES || '5630368737', name: 'Notificações Clientes' },
  distratos: { id: process.env.MONDAY_BOARD_DISTRATOS || '18404493605', name: 'Distratos e Retomadas' },
  honorarios: { id: process.env.MONDAY_BOARD_HONORARIOS || '7231876117', name: 'Honorários Extrajudiciais' },
  unidades: { id: process.env.MONDAY_BOARD_UNIDADES || '18410779605', name: 'Controle de Entrega' },
  compraVenda: { id: process.env.MONDAY_BOARD_COMPRA_VENDA || '5821473011', name: 'Contratos para Clientes / Compra e Venda' },
  ...(process.env.MONDAY_BOARD_TRANSFERENCIA_INTERMEDIARIA ? { transferenciaIntermediaria: { id: process.env.MONDAY_BOARD_TRANSFERENCIA_INTERMEDIARIA, name: 'Transferência intermediária' } } : {})
};
const MONDAY_SYNC_TIMES = (process.env.MONDAY_SYNC_TIMES || '08:00,13:00,18:00').split(',').map(x=>x.trim()).filter(Boolean);
// P0 corrigido (rodada 2): allowlist explícita e fechada dos módulos aceitos por GET /api/legal/:module.
// Antes, :module ia direto para collection(store, moduleName), o que tanto lia quanto podia CRIAR
// incidentalmente qualquer coleção arbitrária de store.records — inclusive uma não pertencente ao
// Jurídico — apenas por o usuário trocar o segmento da URL. Deny-by-default: nada fora desta lista é
// lido, e a coleção nunca é tocada quando o módulo não está na allowlist.
const LEGAL_MODULES = new Set([...Object.keys(MONDAY_BOARDS), 'honorariosJudiciais']);
const PROJECT_RESOURCE_MAP={actions:['projectActions','pac'],milestones:['projectMilestones','pms'],risks:['projectRisks','prk'],internalizations:['recoveryCases','rca'],negotiations:['recoveryNegotiations','rng'],'legal-treatments':['legalNegotiationHistory','lth'],'management-items':['projectManagementItems','pmi']};
// Fase 0 / Sprint 1 — Data Core: mapeia cada tipo de entidade genérica (/api/entities/:type)
// para o módulo de RBAC correspondente. Tipo ausente deste mapa é negado por padrão (deny-by-default),
// em vez de depender da coincidência frágil entre nome de coleção e nome de módulo (MASTER_HANDOFF §26/§11).
const ENTITY_MODULE_MAP = Object.assign(Object.create(null), {
  processos: 'juridico', notificacoes: 'juridico', distratos: 'juridico', honorarios: 'juridico',
  honorariosJudiciais: 'juridico', unidades: 'juridico', compraVenda: 'juridico', transferenciaIntermediaria: 'juridico',
  // Esqueleto das entidades do piloto jurídico (Handoff §6/§26 — Sprint 1: preparar arquitetura, sem
  // fonte/cálculo automático de prazo; fonte por tipo de processo/board é decisão pendente antes do Sprint 2).
  // 'legalProcesses' fica reservado para quando o Legal Process tiver um ID Patrono canônico próprio,
  // independente do registro Monday (ver docs/DATA_MODEL.md, gap). Até lá, Legal Deadline valida seu
  // processo relacionado contra 'processos' (registro do piloto de fato), nunca contra 'legalProcesses'
  // — ver docs/DECISIONS.md, seção de conflitos, para o registro dessa decisão.
  legalDeadlines: 'juridico', legalProcesses: 'juridico', responsibilities: 'juridico',
  documentReferences: 'juridico', externalIdentities: 'juridico'
});
// Object.create(null) evita que uma chave como '__proto__' resolva para o protótipo do objeto em vez
// de `undefined` — leitura de tipo arbitrário na URL nunca deve devolver um valor verdadeiro por acidente.
function entityModule(type) { return (typeof type === 'string' && ENTITY_MODULE_MAP[type]) || null; }
// P0 corrigido (rodada 3, item 4): Monday é System of Record operacional/transitório do MVP para os
// boards em LEGAL_MODULES (mesmo conjunto usado como allowlist de /api/legal/:module). O motor
// genérico de entidades NUNCA pode criar, alterar, arquivar ou restaurar um registro desses tipos —
// isso permitiria fabricar um "processo" local falso (sem vir do Monday) e depois relacioná-lo a um
// Legal Deadline, contornando a fonte oficial. Só GET (leitura) permanece liberado para esses tipos.
function rejectIfMondaySourced(type) { return LEGAL_MODULES.has(type) ? { error: 'Este tipo de registro é mantido pelo Monday (fonte oficial do piloto) e não pode ser criado, alterado, arquivado ou restaurado pela API genérica da Patrono.' } : null; }
// Valida as invariantes de Legal Deadline sobre o estado final (após aplicar o input sanitizado) —
// usado tanto na criação quanto no PATCH (item 3 da rodada 3): processId/origin/date não podem ficar
// vazios, e o processo relacionado precisa existir, pertencer à fonte autorizada (Monday) e estar no
// escopo do usuário. Retorna {status,error} em caso de falha, ou null quando válido.
// P0 corrigido (rodada 4, item 6): valida se `value` é uma data civil real no formato YYYY-MM-DD —
// não apenas um valor truthy. Rejeita "banana", " ", "2026-99-99" (mês inválido) e datas que não
// existem no calendário (ex.: 31 de fevereiro), comparando os componentes de volta após construir o
// objeto Date (que "rola" datas inválidas para o mês seguinte em vez de rejeitá-las).
function isValidCivilDate(value) {
  if (typeof value !== 'string') return false;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
// Sprint 2, Fase 1 (D1 homologada — docs/DECISIONS.md, seção 1.1): originType distingue prazo
// jurídico/processual de prazo interno de controle — nunca inferido, sempre informado por quem
// registra. Enum fechado; nenhuma categoria adicional foi homologada.
const LEGAL_DEADLINE_ORIGIN_TYPES = Object.freeze(['JUDICIAL_PROCESSUAL', 'INTERNAL_CONTROL']);
// Enum fechado de status homologado (mesma seção). "reaberto"/"vencido"/"atrasado"/"em_atraso" nunca
// são valores persistidos — reabertura é o retorno a 'ativo' (ver PATCH de /api/entities/legalDeadlines),
// e atraso é condição derivada (ver isLegalDeadlineOverdue(), abaixo).
const LEGAL_DEADLINE_STATUSES = Object.freeze(['ativo', 'suspenso', 'cumprido', 'cancelado']);
// Sprint 2, Fase 4B (revisão pós-PR #8, P1.1): elegibilidade de responsável extraída como função pura e
// nomeada — reaproveitada por validateLegalDeadline() e testável isoladamente. Ser responsável exige o
// MESMO acesso que ler o próprio registro exigiria: `allowedContent()` (não `allowedInDepartment()`
// isolado, que tem bypass técnico para administrador) cobre "technical admin != content superuser" e
// "TI não pode ser responsável por prazo jurídico sem permissão real de conteúdo"; `scoped()` sobre o
// candidato (já com department/companyId/speId herdados do processo) e sobre o próprio processo
// relacionado cobre companyId/speId/department — mesma defesa em profundidade de
// `scopedLegalDeadlineRows()`. Diretoria (alçada global) passa em `scoped()` normalmente, sem regra
// especial: `hasGlobalScope()` já a libera dentro de `scoped()`.
function canBeResponsibleForLegalDeadline(responsibleUser, legalDeadlineCandidate, relatedProcess) {
  return allowedContent(responsibleUser, 'juridico', 'read') && scoped(responsibleUser, legalDeadlineCandidate) && scoped(responsibleUser, relatedProcess);
}
function validateLegalDeadline(candidate, user, store, previousResponsibleUserId = null) {
  const missing = ['processId','origin','date','originType'].filter(field => !candidate[field]);
  if (missing.length) return { status: 422, error: `Prazo jurídico sem origem identificada bloqueia a operação. Campos obrigatórios ausentes: ${missing.join(', ')}` };
  // Sprint 2, Fase 4B (D4.2/D4.3, homologadas): responsibleUserId é opcional; quando informado, deve
  // referenciar um usuário existente (checagem de existência aqui; atividade/acesso são checados mais
  // abaixo, depois que o processo relacionado e a herança de escopo já foram resolvidos).
  if (candidate.responsibleUserId !== undefined && candidate.responsibleUserId !== null) {
    const responsibleExists = (store.users || []).some(u => u.id === candidate.responsibleUserId);
    if (!responsibleExists) return { status: 422, error: 'O campo responsibleUserId deve referenciar um usuário existente' };
  }
  // P0 corrigido (rodada 4, item 6): origin e date antes só passavam por um teste de "truthy" — uma
  // string só de espaços, ou uma data como "banana"/"2026-99-99", passavam sem checagem semântica.
  const trimmedOrigin = typeof candidate.origin === 'string' ? candidate.origin.trim() : '';
  if (!trimmedOrigin) return { status: 422, error: 'O campo origin deve ser um texto não vazio (após remover espaços em branco)' };
  if (!isValidCivilDate(candidate.date)) return { status: 422, error: 'O campo date deve ser uma data civil válida no formato YYYY-MM-DD (ex.: 2026-12-01)' };
  // Sprint 2, Fase 1: originType/status são enums fechados — nenhum valor fora da lista é aceito, seja
  // na criação ou no PATCH (candidate aqui já é o estado CANDIDATO — item atual + input sanitizado —
  // então uma tentativa de esvaziar/invalidar originType/status via PATCH é rejeitada antes de gravar).
  if (!LEGAL_DEADLINE_ORIGIN_TYPES.includes(candidate.originType)) return { status: 422, error: `O campo originType deve ser um dos valores: ${LEGAL_DEADLINE_ORIGIN_TYPES.join(', ')}` };
  if (!LEGAL_DEADLINE_STATUSES.includes(candidate.status)) return { status: 422, error: `O campo status deve ser um dos valores: ${LEGAL_DEADLINE_STATUSES.join(', ')}` };
  const relatedProcess = collection(store,'processos').find(p => p.id === candidate.processId && !p.deletedAt);
  if (!relatedProcess || relatedProcess.source !== 'monday') return { status: 422, error: 'Processo relacionado não encontrado ou não pertence à fonte autorizada do piloto (Monday)' };
  if (!scoped(user, relatedProcess)) return { status: 403, error: 'Sem permissão para relacionar este processo' };
  // P0 corrigido (rodada 4, item 7): Legal Deadline é subordinado ao Legal Process — herda os campos
  // de escopo do processo relacionado, sobrescrevendo qualquer valor que o próprio cliente (inclusive
  // diretoria/administrador) tenha enviado. Alçada global permite operar registros de vários escopos;
  // não permite criar uma relação estruturalmente inconsistente entre processo e prazo.
  candidate.department = relatedProcess.department ?? null;
  candidate.companyId = relatedProcess.companyId;
  candidate.speId = relatedProcess.speId;
  candidate.scopeType = relatedProcess.scopeType;
  // Sprint 2, Fase 4B (revisão pós-PR #8, P1.1/P1.2): uma NOVA atribuição de responsável (diferente do
  // responsável anterior a este PATCH/POST) exige: (1) usuário não inativo — reaproveita a convenção de
  // soft-delete (`deletedAt`) já usada em toda a plataforma (agenda/projetos/entidades genéricas) para
  // "registro não mais válido"; nenhum segundo campo de "usuário ativo" foi inventado; e (2) usuário
  // elegível para conteúdo jurídico E com acesso ao processo/Legal Deadline pelo MESMO RBAC + scoped()
  // já vigente — não basta existir/estar ativo, a atribuição não pode criar um "responsável" que não
  // poderia sequer ler o próprio registro. `allowedContent()` (não `allowedInDepartment()` isolado) é
  // usado porque nega administrador técnico corretamente (technical admin != content superuser); `scoped()`
  // é checado tanto sobre o candidato final (com escopo já herdado do processo) quanto sobre o próprio
  // processo relacionado, mesma defesa em profundidade de `scopedLegalDeadlineRows()`. Uma atribuição já
  // existente que depois deixa de satisfazer este critério (ex.: o processo muda de escopo) NÃO é
  // revalidada — apenas a NOVA atribuição é bloqueada (D4.11 — histórico/atribuição antiga preservados).
  if (candidate.responsibleUserId !== undefined && candidate.responsibleUserId !== null && candidate.responsibleUserId !== previousResponsibleUserId) {
    const responsible = (store.users || []).find(u => u.id === candidate.responsibleUserId);
    if (responsible.deletedAt) return { status: 422, error: 'Não é possível atribuir um Legal Deadline a um usuário inativo' };
    if (!canBeResponsibleForLegalDeadline(responsible, candidate, relatedProcess)) return { status: 403, error: 'O usuário indicado como responsável não tem permissão para acessar este Legal Deadline ou o processo relacionado' };
  }
  return null;
}
// Sprint 2, Fase 1 (D1 homologada, docs/DECISIONS.md seção 1.1): data civil "hoje" no fuso do piloto
// (America/Sao_Paulo) — mesmo padrão já usado por scheduleDueNow()/scheduledMondayTick() — para não
// deslocar o dia por comparação ingênua em UTC.
function todayCivilDate() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
// Atraso ("vencido"/"em atraso") é uma condição DERIVADA de status+date, nunca um valor persistido —
// função pura e centralizada, para não duplicar essa lógica em cada view que listar prazos (Fase 2).
// Comparação de strings YYYY-MM-DD é determinística (zero-padded, ordem lexicográfica == ordem
// cronológica), sem depender de conversão para Date/UTC. `date === today` NÃO é atraso — o prazo só
// vence após o fim da data civil informada.
function isLegalDeadlineOverdue(deadline, today = todayCivilDate()) {
  if (!deadline || deadline.status !== 'ativo' || !isValidCivilDate(deadline.date)) return false;
  return deadline.date < today;
}
// Sprint 2, Fase 2: janela civil "daqui a N dias" para separar prazo "crítico/próximo" de prazo
// "vencido" nas views — mesmo padrão de fuso de todayCivilDate(), não uma segunda regra de atraso
// (isLegalDeadlineOverdue() continua sendo a única fonte da condição "vencido").
function civilDateAfterDays(days) { return new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
// Sprint 2, Fase 4B (D4.15 homologada): cumprido/cancelado/suspenso não aparecem por padrão na Agenda
// operacional — só ativo e vencido (derivado). Nunca remove o registro nem muda seu status; os mesmos
// itens continuam acessíveis via detalhe/histórico/filtro explícito de Legal Deadline.
function isOperationallyVisible(status) { return status !== 'cumprido' && status !== 'cancelado' && status !== 'suspenso'; }
// Sprint 2, Fase 4B (D4.10 homologada): "Minha Semana" é a semana civil CORRENTE, segunda a domingo,
// fuso America/Sao_Paulo — nunca "próximos 7 dias corridos". Calculado a partir de todayCivilDate()
// (mesmo padrão de fuso já usado em todo o Sprint 2), sem depender de aritmética ingênua em UTC.
function civilWeekWindow(today = todayCivilDate()) {
  const [y, m, d] = today.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  const dow = base.getDay();
  const diffToMonday = (dow + 6) % 7;
  const monday = new Date(base); monday.setDate(base.getDate() - diffToMonday);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const fmt = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  return { start: fmt(monday), end: fmt(sunday) };
}
// Sprint 2, Fase 4B (D4.11 homologada): responsibleUserId nunca é apagado/alterado quando o usuário
// responsável se torna inativo depois — a view apenas sinaliza a inconsistência ("Responsável
// inativo"), reaproveitando a mesma convenção de soft-delete (`deletedAt`) já usada em toda a
// plataforma como representação de "registro/usuário não mais válido" (nenhum campo novo inventado).
function responsibleInfo(store, item) {
  const responsibleUserId = item.responsibleUserId ?? null;
  if (!responsibleUserId) return { responsibleUserId: null, responsibleInactive: false };
  const responsible = (store.users || []).find(u => u.id === responsibleUserId);
  return { responsibleUserId, responsibleInactive: Boolean(responsible && responsible.deletedAt) };
}
// Sprint 2, Fase 4B (Opção B homologada, D4.1, docs/DECISIONS.md): adapter somente leitura do Google
// Calendar. Nenhum método de escrita da API do Calendar (criar/atualizar/remover evento) existe neste
// arquivo — Calendar nunca é fonte de prazo jurídico, nunca é espelhado a partir de Legal Deadline, nunca é
// alterado pelo Patrono. Sem credenciais reais de OAuth do Google neste ambiente
// (GOOGLE_CALENDAR_CLIENT_ID/SECRET), a ativação real permanece bloqueada por design — reportado como
// blocker técnico (não uma implementação insegura/improvisada só para "fechar" a integração).
// Compromissos do Calendar pertencem à identidade do usuário CONECTADO — nunca uma agenda corporativa
// global (alçada global de negócio não dá acesso ao Calendar pessoal de outro usuário).
function googleCalendarStatus(user) {
  const configured = Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET);
  return { configured, connected: false, status: configured ? 'unavailable' : 'not_configured' };
}
function googleCalendarEvents(user) {
  return { ...googleCalendarStatus(user), events: [] };
}
// Sprint 2, Fase 4B (revisão pós-PR #8, P1.3): a janela de "Minha Semana" (D4.10) precisa valer também
// para os eventos do Google Calendar, não só para Legal Deadline — sem isso, quando a leitura real for
// ativada, um evento fora da semana civil corrente poderia aparecer em Minha Semana. Extraída como
// função pura (testável isoladamente do HTTP/adapter, que hoje sempre devolve `events: []`). A data
// civil do evento é os 10 primeiros caracteres de `event.date` (YYYY-MM-DD, mesmo quando o valor for um
// datetime completo); a hora externa em si continua preservada nos campos `start`/`end`, nunca
// convertida para data civil (Legal Deadline continua com `date` civil puro, sem virar timestamp).
function filterCalendarEventsByWindow(events, window) {
  return (events || []).filter(event => { const civilDate = String(event.date || '').slice(0, 10); return civilDate >= window.start && civilDate <= window.end; });
}
// Registros legados anteriores à homologação da D1 podem existir sem originType/status persistidos
// (docs/DATA_MODEL.md, "Registros legados anteriores à D1"). Nunca inferimos esses campos — a view
// apenas sinaliza a inconsistência para revisão manual do Jurídico, sem inventar um status novo.
function legalDeadlineIntegrityFlag(deadline) { return (!deadline || !deadline.originType || !deadline.status) ? 'requires_review' : 'ok'; }
// Sprint 2, Fase 4B (D4.5/D4.6 homologadas): rótulos de apresentação em português — nunca alteram o
// enum técnico persistido (originType/status continuam JUDICIAL_PROCESSUAL/ativo/etc.), apenas
// adicionam um campo derivado para quem consome a view. Nenhum rótulo fora desta tabela é inventado.
const ORIGIN_TYPE_LABELS = Object.freeze({ JUDICIAL_PROCESSUAL: 'Prazo processual', INTERNAL_CONTROL: 'Controle interno' });
const STATUS_LABELS = Object.freeze({ ativo: 'Ativo', suspenso: 'Suspenso', cumprido: 'Cumprido', cancelado: 'Cancelado' });
const CATEGORY_LABELS = Object.freeze({ OVERDUE: 'Vencido', UPCOMING: 'Próximo', REQUIRES_REVIEW: 'Requer revisão' });
function legalDeadlineLabels(item) {
  return { originTypeLabel: ORIGIN_TYPE_LABELS[item.originType] ?? null, statusLabel: STATUS_LABELS[item.status] ?? null };
}
// Sprint 2, Fase 4B (D4.4 homologada): "Confirmado pelo Jurídico" só é exibido para um Legal Deadline
// que não seja requires_review (nunca para registro legado sem originType/status). Todo registro na
// coleção já foi necessariamente criado por um usuário autorizado no módulo jurídico (allowedContent()
// nega a criação a qualquer outro papel) — não há necessidade de checar novamente aqui quem criou.
// Nunca usa "Comprovado documentalmente"/"Documento validado"/"Evidência confirmada"/"Fonte oficial
// comprovada" (D1.4/D4.4 — essas dependem de `evidenceReference`, fora de escopo desta fase).
function legalDeadlineConfirmationLabel(dataIntegrity) { return dataIntegrity === 'requires_review' ? null : 'Confirmado pelo Jurídico'; }
// Filtro/paginação de Legal Deadline (Sprint 2, Fase 2, item 9) — mesmo padrão de filterProcesses()/
// filterHonorariums() (values() multi-seleção, pageSize em [25,50,100], page/totalPages). `rows` já
// deve chegar filtrado por scoped()/relação com processo acessível (feito no chamador, GET /api/
// entities/:type) — esta função só filtra/pagina, nunca refaz a checagem de autorização.
function filterLegalDeadlines(rows, url) {
  const values = name => url.searchParams.getAll(name).map(value => value.trim()).filter(Boolean);
  const selected = { originType: values('originType'), status: values('status') };
  const processId = String(url.searchParams.get('processId') || '').trim();
  const overdueParam = url.searchParams.get('overdue');
  const dateFrom = String(url.searchParams.get('dateFrom') || '').trim();
  const dateTo = String(url.searchParams.get('dateTo') || '').trim();
  const filtered = rows.filter(row =>
    (!processId || row.processId === processId) &&
    (!selected.originType.length || selected.originType.includes(row.originType)) &&
    (!selected.status.length || selected.status.includes(row.status)) &&
    (overdueParam !== 'true' || isLegalDeadlineOverdue(row)) &&
    (overdueParam !== 'false' || !isLegalDeadlineOverdue(row)) &&
    (!isValidCivilDate(dateFrom) || row.date >= dateFrom) &&
    (!isValidCivilDate(dateTo) || row.date <= dateTo)
  );
  filtered.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const pageSize = [25, 50, 100].includes(Number(url.searchParams.get('pageSize'))) ? Number(url.searchParams.get('pageSize')) : 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(url.searchParams.get('page')) || 1));
  const start = (page - 1) * pageSize;
  return {
    records: filtered.slice(start, start + pageSize).map(row => ({ ...row, overdue: isLegalDeadlineOverdue(row), dataIntegrity: legalDeadlineIntegrityFlag(row) })),
    count: filtered.length,
    totalAvailable: rows.length,
    pagination: { page, pageSize, totalPages }
  };
}
// Sprint 2, Fase 3: helper único de "Legal Deadline visível a este usuário" — reaproveitado pela
// listagem/detalhe (Fase 2) e pelas novas views de Agenda/Atenção (Fase 3), para nunca duplicar a
// defesa em profundidade (scoped() sobre o prazo E sobre o processo relacionado — item 13 do plano).
// Retorna {item, relatedProcess} para cada Legal Deadline autorizado; nada é persistido aqui.
function scopedLegalDeadlineRows(store, user) {
  const processos = collection(store, 'processos');
  return collection(store, 'legalDeadlines')
    .filter(item => !item.deletedAt && scoped(user, item))
    .map(item => {
      const relatedProcess = processos.find(p => p.id === item.processId && !p.deletedAt);
      return relatedProcess && scoped(user, relatedProcess) ? { item, relatedProcess } : null;
    })
    .filter(Boolean);
}
// Agenda mínima (Fase 3, item 5): ViewModel de apresentação — nunca persiste cópia de date/status/
// origin/originType. `target` aponta para o detalhe canônico já existente (Fase 2); nenhuma edição de
// Legal Deadline acontece por esta via.
// `includeInactive` (Sprint 2, Fase 4B, D4.15 homologada): por padrão, cumprido/cancelado/suspenso
// ficam fora da Agenda operacional — reaproveita o parâmetro explícito já usado em outras rotas do
// Sprint 2 em vez de criar uma API paralela; os mesmos registros continuam disponíveis via
// detalhe/histórico/filtro de Legal Deadline (?status=...) independentemente deste parâmetro.
function legalDeadlineAgendaItems(store, user, { includeInactive = false } = {}) {
  return scopedLegalDeadlineRows(store, user)
    .filter(({ item }) => includeInactive || isOperationallyVisible(item.status))
    .map(({ item, relatedProcess }) => ({
      entityType: 'legalDeadline',
      entityId: item.id,
      date: item.date,
      processId: item.processId,
      process: { id: relatedProcess.id, title: relatedProcess.title || null },
      origin: item.origin,
      originType: item.originType,
      status: item.status,
      overdue: isLegalDeadlineOverdue(item),
      dataIntegrity: legalDeadlineIntegrityFlag(item),
      department: item.department ?? null,
      ...responsibleInfo(store, item),
      ...legalDeadlineLabels(item),
      confirmationLabel: legalDeadlineConfirmationLabel(legalDeadlineIntegrityFlag(item)),
      target: `/api/entities/legalDeadlines/${item.id}/detail`
    }));
}
// Sprint 2, Fase 4B (D4.10 homologada): "Minha Semana" é VIEW — nunca persiste `myWeek`/`weeklyItems`/
// `weekSnapshot`. Só entram Legal Deadlines cujo responsibleUserId é o usuário logado, dentro da semana
// civil corrente (segunda a domingo, America/Sao_Paulo), reaproveitando scopedLegalDeadlineRows() —
// mesma defesa em profundidade (scoped() sobre o prazo E sobre o processo relacionado). responsibleUserId
// NUNCA amplia autorização: um usuário só vê aqui o que já poderia ver por escopo normal.
function myWeekLegalDeadlineItems(store, user) {
  const window = civilWeekWindow();
  return scopedLegalDeadlineRows(store, user)
    .filter(({ item }) => item.responsibleUserId === user.id)
    .filter(({ item }) => isOperationallyVisible(item.status))
    .filter(({ item }) => isValidCivilDate(item.date) && item.date >= window.start && item.date <= window.end)
    .map(({ item, relatedProcess }) => ({
      entityType: 'legalDeadline',
      entityId: item.id,
      date: item.date,
      source: 'legalDeadline',
      processId: item.processId,
      process: { id: relatedProcess.id, title: relatedProcess.title || null },
      origin: item.origin,
      originType: item.originType,
      status: item.status,
      overdue: isLegalDeadlineOverdue(item),
      dataIntegrity: legalDeadlineIntegrityFlag(item),
      responsibleUserId: item.responsibleUserId,
      ...legalDeadlineLabels(item),
      confirmationLabel: legalDeadlineConfirmationLabel(legalDeadlineIntegrityFlag(item)),
      target: `/api/entities/legalDeadlines/${item.id}/detail`
    }));
}
// `store.agenda` é entidade PRÉ-EXISTENTE de compromissos manuais (título/prioridade/responsável),
// independente de Legal Deadline (module 'agenda', já com GET/POST próprios em /api/agenda) — a Fase 3
// não a substitui nem a redefine, apenas a inclui como mais uma fonte na view combinada de Agenda.
function agendaEventItems(store, user) {
  return (store.agenda || []).filter(event => !event.deletedAt && scoped(user, event)).map(event => ({
    entityType: 'agendaEvent',
    entityId: event.id,
    date: event.date || null,
    title: event.title ?? null,
    department: event.department ?? null,
    priority: event.priority ?? null,
    status: event.status ?? null,
    owner: event.owner ?? null,
    classification: event.classification ?? null
  }));
}
// Ordenação determinística por data civil (item 21 do plano): date → entityType → entityId, sem
// conversão para Date/UTC — mesma comparação lexicográfica de string já usada em todo o Sprint 2.
function sortAgendaItems(items) {
  return [...items].sort((a, b) => {
    const dateA = String(a.date || ''), dateB = String(b.date || '');
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    if (a.entityType !== b.entityType) return String(a.entityType).localeCompare(String(b.entityType));
    return String(a.entityId).localeCompare(String(b.entityId));
  });
}
// Atenção mínima (Fase 3, item 6): categorias de VIEW (nunca persistidas, nunca um novo status de
// Legal Deadline) — OVERDUE/UPCOMING via isLegalDeadlineOverdue()/civilDateAfterDays() já existentes
// (nenhuma regra de atraso recalculada aqui); REQUIRES_REVIEW via legalDeadlineIntegrityFlag() (Fase 2).
// Um registro legado sem originType/status nunca chega a status==='ativo' de forma confiável, então
// nunca também vira OVERDUE/UPCOMING — apenas REQUIRES_REVIEW.
function legalDeadlineAttentionItems(store, user) {
  const soonLimit = civilDateAfterDays(30);
  return scopedLegalDeadlineRows(store, user).map(({ item, relatedProcess }) => {
    const dataIntegrity = legalDeadlineIntegrityFlag(item);
    const overdue = isLegalDeadlineOverdue(item);
    const upcoming = item.status === 'ativo' && !overdue && isValidCivilDate(item.date) && item.date <= soonLimit;
    const category = dataIntegrity === 'requires_review' ? 'REQUIRES_REVIEW' : overdue ? 'OVERDUE' : upcoming ? 'UPCOMING' : null;
    if (!category) return null;
    return {
      entityType: 'legalDeadline', entityId: item.id, category, categoryLabel: CATEGORY_LABELS[category] ?? null,
      processId: item.processId, process: { id: relatedProcess.id, title: relatedProcess.title || null },
      date: item.date, origin: item.origin, originType: item.originType, status: item.status,
      ...responsibleInfo(store, item),
      ...legalDeadlineLabels(item),
      confirmationLabel: legalDeadlineConfirmationLabel(dataIntegrity),
      target: `/api/entities/legalDeadlines/${item.id}/detail`
    };
  }).filter(Boolean);
}
// P0 corrigido (rodada 6, item 4): a validação de processId de internalization (existe + source
// 'monday' + escopo do usuário) foi introduzida na rodada 5 apenas no POST. O PATCH de sub-recurso de
// projeto é genérico e não revalidava nada — uma internalização criada corretamente podia ser alterada
// depois para um processId manual/fora de escopo/inexistente, sem nenhuma checagem, quebrando a
// integridade relacional (mesma classe de falha já corrigida para Legal Deadline nas rodadas 3/4).
// Extraída para uma função única, reaproveitada em POST e PATCH. `processId` continua não sendo
// obrigatório (regra de negócio pré-existente, não alterada aqui) — só valida quando informado.
function validateInternalizationProcess(processId, user, store) {
  const relatedProcess = collection(store,'processos').find(item => item.id === processId && !item.deletedAt);
  if (!relatedProcess || relatedProcess.source !== 'monday') return { status: 422, error: 'Processo relacionado não encontrado ou não pertence à fonte autorizada do piloto (Monday)' };
  if (!scoped(user, relatedProcess)) return { status: 403, error: 'Sem permissão para relacionar este processo' };
  return null;
}
// P0 corrigido (rodada 2): campos controlados pelo servidor (identidade do registro, versionamento,
// metadados de auditoria e metadados de origem/sincronização) nunca podem vir do cliente — antes,
// `{...input}` permitia que o corpo da requisição sobrescrevesse `id`, `version`, `createdBy`,
// `updatedAt`, dados de exclusão lógica ou a origem/externalId de um registro sincronizado.
const PROTECTED_ENTITY_FIELDS = ['id','version','createdAt','createdBy','updatedAt','updatedBy','deletedAt','deletedBy','source','externalId','boardId','boardName','syncedAt'];
// Sprint 2, Fase 4B (revisão pós-PR #8, P2): nomes textuais de responsável nunca são um substituto
// válido de `responsibleUserId` (só o `user.id` canônico é aceito — ver validateLegalDeadline()) — em
// vez de apenas ignorá-los na validação, são removidos do input antes de persistir, para não criar
// campos paralelos de responsabilidade sem significado (`responsible`/`responsibleName`/`ownerName`
// ficariam gravados no registro sem nenhuma validação/auditoria própria).
const LEGAL_DEADLINE_TEXTUAL_RESPONSIBLE_FIELDS = ['responsible', 'responsibleName', 'ownerName'];
// Papel com `scopes:['*']` (hoje diretoria/administrador) tem alçada global — é o único que pode
// escolher escopo (department/scopeType/companyId/speId) de um registro que está criando/gerindo.
function hasGlobalScope(user) { return (ROLES[user.role]?.scopes || []).includes('*'); }
// Departamentos visíveis a um usuário: alçada global vê todos; os demais só o próprio departamento.
function visibleDepartments(store, user) { return hasGlobalScope(user) ? (store.departments || []) : (store.departments || []).filter(d => d.name === user.department); }
// Remove os campos protegidos do input do cliente. `department`, `scopeType`, `companyId` e `speId`
// só são preservados quando o papel do usuário tem escopo global (`scopes:['*']`) — P0 corrigido
// (rodada 3): antes, um papel com escopo departamental podia enviar `scopeType:'global'` no corpo da
// requisição e transformar o próprio registro em globalmente visível (scoped() libera qualquer
// registro com scopeType:'global'), ou definir/alterar companyId/speId sem ter alçada correspondente.
function sanitizeEntityInput(input, user) {
  const clean = { ...(input && typeof input === 'object' ? input : {}) };
  for (const field of PROTECTED_ENTITY_FIELDS) delete clean[field];
  if (!hasGlobalScope(user)) { delete clean.department; delete clean.scopeType; delete clean.companyId; delete clean.speId; }
  return clean;
}
// P0 corrigido (rodada 4, item 2): sub-recursos de projeto (actions/milestones/risks/internalizations/
// negotiations/legal-treatments/management-items) construíam o objeto com `...input` DEPOIS dos campos
// de servidor no POST (`{id:..., ...input}`), permitindo que o cliente sobrescrevesse `id`, `projectId`,
// `createdAt`, `createdBy` — mesma classe de falha já corrigida em `/api/entities` (rodada 2) e em
// agenda/committees/compliance (rodada 3). Mesmo padrão: remove os campos protegidos do input e
// reatribui depois do spread.
const PROTECTED_PROJECT_ITEM_FIELDS = ['id','projectId','createdAt','createdBy','deletedAt','deletedBy'];
function sanitizeProjectItemInput(input, user) {
  const clean = { ...(input && typeof input === 'object' ? input : {}) };
  for (const field of PROTECTED_PROJECT_ITEM_FIELDS) delete clean[field];
  if (!hasGlobalScope(user)) { delete clean.departmentId; delete clean.scopeType; delete clean.companyId; delete clean.speId; }
  return clean;
}
// P0 corrigido (rodada 5, item 3): MASTER_HANDOFF §11 — "Administrador técnico ≠ superusuário de
// conteúdo". `administrador` mantém `modules:['*']`/`actions:['*']` para as funções técnicas que já
// eram (e continuam sendo) legítimas: `allowed(user,'*',ação)` é o gate usado por rotas de sistema
// (auditoria, aprovação de cadastro, backup) e por allowedInDepartment() para módulos operacionais de
// integração (ver abaixo) — gerenciar sistema/usuários/integrações/segurança/configuração é exatamente
// o papel de um administrador técnico. O que mudou é `scopes: []` (antes `['*']`): scoped() e
// hasGlobalScope() deixam de tratar administrador como alçada global de CONTEÚDO — sem isso,
// administrador herdava acesso irrestrito a registros de qualquer departamento/empresa/SPE só por ter
// o papel técnico, o que o MASTER_HANDOFF proíbe explicitamente. `diretoria` continua sendo a única
// alçada de negócio verdadeiramente global (`scopes:['*']`).
const ROLES = {
  diretoria: { modules: ['*'], scopes: ['*'], actions: ['read','create','update','archive','restore','approve','export'] },
  administrador: { modules: ['*'], scopes: [], actions: ['*'] },
  lider: { modules: ['central','estrategia','projetos','agenda','comites','orcamento','juridico','ti'], scopes: ['department'], actions: ['read','create','update','archive','export'] },
  colaborador: { modules: ['central','projetos','agenda','juridico','ti'], scopes: ['department'], actions: ['read','create','update'] }
};
// Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): os usuários seed não
// carregam mais um segredo global (o login não usa mais COEVO_DEMO_PASSWORD/COEVO_MFA_CODE — ver
// login/mfa abaixo). Fora de produção, para manter o ambiente de desenvolvimento/homologação utilizável
// sem exigir um passo manual de "definir senha", cada usuário seed recebe uma senha temporária
// individual (hash próprio, `temporaryPassword:true` — força troca no primeiro acesso, item 6 do
// escopo) e, para papéis que exigem MFA (`requireMfa()`), um segredo TOTP individual já confirmado
// (`DEV_SEED_TOTP_SECRET`, exclusivamente para desenvolvimento/teste). Em produção
// (`NODE_ENV=production`), NENHUMA credencial é atribuída automaticamente — os usuários seed nascem sem
// senha/MFA utilizáveis, exigindo o fluxo de reset de senha administrado antes do primeiro acesso.
// "Nunca aplicar automaticamente em produção real" (item 27 do escopo).
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
// COEVO_SEED_PASSWORD tem prioridade; na ausência, cai para COEVO_DEMO_PASSWORD (retirado de seu papel
// de senha global comparada no login — ver rota de login abaixo — e reaproveitado como a MESMA fonte
// usada pelo backfill de desenvolvimento/teste em migrateLegacyStore(), para que usuários seed e
// usuários legados de teste compartilhem uma única senha de conveniência fora de produção).
const DEV_SEED_PASSWORD = process.env.COEVO_SEED_PASSWORD || process.env.COEVO_DEMO_PASSWORD || 'Coevo!Seed#2026Dev';
const DEV_SEED_TOTP_SECRET = process.env.COEVO_SEED_TOTP_SECRET || 'JBSWY3DPEHPK3PXP';
function seedAuthFields(role) {
  if (IS_PRODUCTION) return { passwordHash: null, temporaryPassword: true, credentialsVersion: 1, mfaEnabled: false, mfaMethod: null, mfaSecretEncrypted: null };
  // Fora de produção, o usuário seed já nasce com senha E (quando o papel exige) MFA já confirmados —
  // `temporaryPassword:false` propositalmente (mesma lógica de backfillDevAuthFields() abaixo): é uma
  // credencial de desenvolvimento/homologação pronta para uso imediato, não um primeiro acesso real que
  // precise passar pelo fluxo de troca obrigatória.
  const base = { passwordHash: authCrypto.hashPassword(DEV_SEED_PASSWORD), temporaryPassword: false, credentialsVersion: 1 };
  if (!requireMfa({ role })) return { ...base, mfaEnabled: false, mfaMethod: null, mfaSecretEncrypted: null };
  // `encryptSecret()` lança se MFA_ENCRYPTION_KEY estiver ausente/curta (fail-fast correto para uma
  // tentativa real de enrolamento de MFA). Isto é só o seed de conveniência fora de produção, executado
  // incondicionalmente na carga do módulo (não atrás de nenhuma rota) — nunca pode derrubar o processo
  // inteiro (e, com ele, qualquer script/teste que só precise requerer `server.js`) por essa chave ainda
  // não estar configurada neste ambiente. Sem a chave, o usuário seed simplesmente nasce sem MFA
  // pré-configurado (continua exigindo o fluxo normal de enrolamento no primeiro login) — nunca grava o
  // segredo sem cifrar como alternativa.
  try {
    return { ...base, mfaEnabled: true, mfaMethod: 'totp', mfaSecretEncrypted: authCrypto.encryptSecret(DEV_SEED_TOTP_SECRET), mfaEnrolledAt: new Date().toISOString() };
  } catch {
    return { ...base, mfaEnabled: false, mfaMethod: null, mfaSecretEncrypted: null };
  }
}
const seed = {
  users: [
    { id: 'usr-diretoria', name: 'Cristiane Carneiro Rabelo', email: 'juridico@coevoconstrutora.com.br', role: 'diretoria', department: null, mfa: true, loginIdentifier: 'usr-diretoria', ...seedAuthFields('diretoria') },
    { id: 'usr-juridico', name: 'Líder Jurídico', email: 'juridico@coevoconstrutora.com.br', role: 'lider', department: 'Jurídico', mfa: true, loginIdentifier: 'usr-juridico', ...seedAuthFields('lider') },
    { id: 'usr-ti', name: 'Líder de Tecnologia', email: 'ti@coevo.local', role: 'lider', department: 'TI', mfa: true, loginIdentifier: 'usr-ti', ...seedAuthFields('lider') }
  ],
  departments: [
    { id: 'dep-juridico', name: 'Jurídico', color: '#20B5C7', source: 'Orcamento_JURIDICO_2026.xlsx · Painel/Planejado/Realizado', budget: { budgeted: 324730.42, planned: 209173.48, committed: 0, realized: 145499.77, forecast: 324730.42 } },
    { id: 'dep-ti', name: 'TI', color: '#356B72', source: 'Cadastro de homologação do núcleo COEVO', budget: { budgeted: 720000, planned: 680000, committed: 146000, realized: 384000, forecast: 698000 } }
  ],
  financials: [],
  agenda: [
    { id: 'evt-1', title: 'Comitê Executivo mensal', department: 'Jurídico', date: '2026-08-12', priority: 'Alta', status: 'Agendado', owner: 'Líder Jurídico', classification: 'Confidencial' },
    { id: 'evt-2', title: 'Revisão do roadmap de TI', department: 'TI', date: '2026-08-14', priority: 'Média', status: 'Agendado', owner: 'Líder de Tecnologia', classification: 'Interno' }
  ],
  committees: [], audit: [], compliance: [], registrationRequests: [], mondayRuns: []
};
function financeRecord(department) { const b=department.budget||{},number=value=>value===null||value===undefined||value===''?null:Number(value); const budget=number(b.budgeted); const planned=number(b.planned); const committed=number(b.committed); const actual=number(b.realized); const forecast=number(b.forecast); return { departmentId:department.id, departmentName:department.name, budget:Number.isFinite(budget)?budget:null, planned:Number.isFinite(planned)?planned:null, committed:Number.isFinite(committed)?committed:null, actual:Number.isFinite(actual)?actual:null, balance:Number.isFinite(budget)&&Number.isFinite(committed)&&Number.isFinite(actual)?budget-committed-actual:null, forecast:Number.isFinite(forecast)?forecast:null, executionPercentage:Number.isFinite(budget)&&budget>0&&Number.isFinite(actual)?actual/budget:null, source:department.source||'Origem não informada' }; }
function departmentFinancials(store) { const saved=Array.isArray(store.financials)?store.financials:[]; return (store.departments||[]).map(department=>{const existing=saved.find(item=>item.departmentId===department.id);const base=existing?{...financeRecord(department),...existing}:financeRecord(department);base.departmentId=department.id;base.departmentName=department.name;base.balance=Number.isFinite(base.budget)&&Number.isFinite(base.committed)&&Number.isFinite(base.actual)?base.budget-base.committed-base.actual:null;base.executionPercentage=Number.isFinite(base.budget)&&base.budget>0&&Number.isFinite(base.actual)?base.actual/base.budget:null;return base}); }
// Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, PG-01/PG-02/PG-03; docs/DECISIONS.md, PROD-H1-01):
// a persistência real (arquivo JSON local ou PostgreSQL) vive inteiramente em `storage/` — este módulo
// nunca mais toca `fs`/`pg` diretamente. `storage.configure()` decide o backend UMA vez, no boot do
// processo, a partir de DATABASE_URL/NODE_ENV (ver chamada logo abaixo). `readStore()`/`writeStore()`
// continuam com a MESMA assinatura usada por ~24 pontos deste arquivo — só passaram a ser `async`.
storage.configure({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
  dataDir: DATA_DIR,
  seed,
  ssl: process.env.DATABASE_SSL === 'true'
});
// Normalização que antes vivia dentro do antigo `ensureStore()` (renomear fonte legada "Patrono" →
// "COEVO", backfill de `financials`/`dashboardPreferences`, e as coleções de projeto via
// `ensureProjectStore()`) — independente do backend de persistência ativo, roda a cada leitura e só
// grava de volta quando algo de fato mudou.
function migrateLegacyStore(store) {
  let changed = false;
  for (const department of store.departments || []) {
    if (!department.source) { department.source = seed.departments.find(item => item.id === department.id)?.source || 'Origem não informada'; changed = true; }
    else if (department.source.includes('Patrono')) { department.source = department.source.replace(/Patrono/g, 'COEVO'); changed = true; }
  }
  if (!Array.isArray(store.financials) || store.financials.length !== (store.departments || []).length) { store.financials = departmentFinancials(store); changed = true; }
  else for (const finance of store.financials) { if (typeof finance.source === 'string' && finance.source.includes('Patrono')) { finance.source = finance.source.replace(/Patrono/g, 'COEVO'); changed = true; } }
  if (!Array.isArray(store.dashboardPreferences)) { store.dashboardPreferences = []; changed = true; }
  if (ensureProjectStore(store)) changed = true;
  if (backfillDevAuthFields(store)) changed = true;
  return changed;
}
// Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): shim de
// desenvolvimento/teste — NUNCA roda em produção (`IS_PRODUCTION`). Sem isto, todo usuário criado antes
// de H2 (ou criado ad hoc por `tests/security-integration.test.js`, que constrói ~2300 linhas de
// objetos de usuário inline sem os campos de H2) perderia a capacidade de logar, já que
// `POST /api/auth/login` agora exige `passwordHash`. Atribui uma senha padrão de desenvolvimento (nunca
// aplicada a um `passwordHash` já existente) e, para papéis que `requireMfa()` exige, um segredo TOTP
// fixo de desenvolvimento já confirmado — ambos com `temporaryPassword:false`/`mfaEnabled:true` para não
// disparar o gate de "conclua a configuração da conta" em massa sobre dados legados/de teste que nunca
// passaram por um fluxo real de primeiro acesso.
function backfillDevAuthFields(store) {
  if (IS_PRODUCTION) return false;
  let changed = false;
  for (const candidate of store.users || []) {
    // `temporaryPassword === true` sinaliza um usuário REALMENTE pendente de primeiro acesso (aprovação
    // de cadastro real, ou o fluxo administrativo de emissão de token — ver
    // POST /api/auth/requests/:id/approve e POST /api/auth/users/:id/reset-token): nunca ganha uma senha
    // de conveniência "de graça", mesmo fora de produção. Não dá para distinguir `null` de `undefined`
    // em `passwordHash` como sinal (uma vez que o usuário passa por um round-trip pelo Postgres, a coluna
    // nulável sempre volta como `null`, nunca `undefined`, apagando essa diferença) — por isso o sinal
    // usado é `temporaryPassword`, que é uma coluna `boolean NOT NULL` e sobrevive ao round-trip
    // exatamente como gravada. Objetos de usuário legados/de teste anteriores a H2 nunca declaram
    // `temporaryPassword` (portanto `false` por padrão) e continuam recebendo a senha de conveniência.
    if (!candidate.passwordHash && candidate.temporaryPassword !== true) {
      candidate.passwordHash = authCrypto.hashPassword(DEV_SEED_PASSWORD);
      candidate.passwordChangedAt = candidate.passwordChangedAt || new Date().toISOString();
      candidate.temporaryPassword = false;
      candidate.credentialsVersion = candidate.credentialsVersion || 1;
      changed = true;
    }
    // Mesma degradação graciosa de seedAuthFields(): sem MFA_ENCRYPTION_KEY configurada neste ambiente,
    // o backfill simplesmente não pré-ativa MFA para o usuário legado/de teste (continua exigindo
    // enrolamento normal), em vez de derrubar toda leitura da store por uma chave de conveniência ainda
    // não configurada.
    if (requireMfa(candidate) && !candidate.mfaEnabled && !candidate.mfaSecretEncrypted) {
      try {
        candidate.mfaSecretEncrypted = authCrypto.encryptSecret(DEV_SEED_TOTP_SECRET);
        candidate.mfaEnabled = true;
        candidate.mfaMethod = 'totp';
        candidate.mfaEnrolledAt = candidate.mfaEnrolledAt || new Date().toISOString();
        changed = true;
      } catch { /* MFA_ENCRYPTION_KEY ausente/curta — deixa o usuário sem MFA pré-configurado */ }
    }
    if (typeof candidate.failedLoginCount !== 'number') { candidate.failedLoginCount = 0; changed = true; }
    // migrations/006_h2_unique_login_identity.sql faz este mesmo backfill (login_identifier = id) a nível
    // de banco para o backend Postgres; replicado aqui para usuários legados/de teste no fallback local
    // (JSON) e para objetos de usuário inseridos diretamente pela suíte de testes sem passar pela ponte
    // relacional — nunca inventa um identificador de negócio, só reaproveita o id técnico já existente.
    if (!candidate.loginIdentifier) { candidate.loginIdentifier = candidate.id; changed = true; }
  }
  return changed;
}
async function readStore() {
  const store = await storage.readStore();
  if (migrateLegacyStore(store)) await storage.writeStore(store);
  return store;
}
async function writeStore(store) { return storage.writeStore(store); }
// Helper único reaproveitado em toda rota de mutação: grava e, em caso de conflito de concorrência
// (StoreConflictError — outra requisição já gravou uma versão mais nova do mesmo store), responde 409
// diretamente e devolve `false` para o chamador interromper a rota sem tentar responder de novo.
// Nunca sobrescreve silenciosamente uma versão concorrente (PG-02).
async function commitStore(res, store) {
  try { await writeStore(store); return true; }
  catch (error) {
    if (error instanceof StoreConflictError) { json(res, 409, { error: error.message, code: error.code }); return false; }
    throw error;
  }
}
function audit(store, user, action, entity, entityId, before, after, reason = 'Operação solicitada pelo usuário') {
  store.audit.push({ id: crypto.randomUUID(), action, entity, entityId, responsible: user.name, date: new Date().toISOString(), reason, before, after, correlationId: crypto.randomUUID() });
}
// P0 corrigido (rodada 7, item 2): separa AUDITORIA TÉCNICA (metadados: quem fez o quê, quando, por
// quê — sempre necessários para a função técnica legítima de auditoria) de CONTEÚDO AUDITADO
// (`before`/`after`, o snapshot do registro em si, que pode conter dado jurídico/financeiro/pessoal
// completo). Só alçada de negócio global (`hasGlobalScope`) recebe `before`/`after` — um papel sem
// alçada global (hoje, na prática, só `administrador` chega a `/api/audit`, já que é a única rota de
// auditoria e exige `allowed(user,'*')`) vê apenas os metadados técnicos, nunca o conteúdo do registro
// auditado. Função única, reaproveitada onde eventos de auditoria são devolvidos ao cliente — evita
// duplicar a lógica de redação em múltiplos pontos.
const AUDIT_TECHNICAL_FIELDS = ['id', 'action', 'entity', 'entityId', 'responsible', 'date', 'reason', 'correlationId'];
function sanitizeAuditEventForUser(user, event) {
  if (hasGlobalScope(user)) return event;
  return Object.fromEntries(AUDIT_TECHNICAL_FIELDS.filter(field => Object.hasOwn(event, field)).map(field => [field, event[field]]));
}
function allowed(user, module, action = 'read') {
  const policy = ROLES[user.role];
  return !!policy && (policy.modules.includes('*') || policy.modules.includes(module)) && (policy.actions.includes('*') || policy.actions.includes(action));
}
// P0 corrigido (rodada 5, item 1): 'juridico' e 'ti' são módulos que representam um departamento
// operacional específico do negócio — mas `lider`/`colaborador` têm os DOIS módulos simultaneamente em
// ROLES, independentemente do próprio departamento (ver docs/PERMISSIONS.md, nota histórica). Isso é
// inofensivo em rotas com escopo por registro (scoped() já nega por department — ver /api/legal/:module,
// /api/entities/:type), mas era uma lacuna real nas rotas SEM registro individual para filtrar
// (/api/monday/status, /schedule, /test, /sync): um usuário de TI passava no gate de módulo e operava
// uma função exclusivamente jurídica, e vice-versa. `allowedInDepartment()` fecha isso: além de
// `allowed()`, exige que o department do usuário corresponda ao do módulo — deny-by-default para quem
// não é do departamento certo. Alçada de negócio global (`hasGlobalScope`) sempre passa; administrador
// técnico também passa aqui (gerencia integrações/sistema de qualquer departamento — MASTER_HANDOFF
// §11), mas isso NÃO reabre acesso a conteúdo: scoped() (acima) já nega administrador por registro.
const MODULE_DEPARTMENT = Object.freeze({ juridico: 'Jurídico', ti: 'TI' });
function allowedInDepartment(user, module, action = 'read') {
  if (!allowed(user, module, action)) return false;
  const requiredDepartment = MODULE_DEPARTMENT[module];
  if (!requiredDepartment) return true;
  if (hasGlobalScope(user) || user.role === 'administrador') return true;
  return user.department === requiredDepartment;
}
// P0 corrigido (rodada 6, item 3): `administrador` mantém modules:['*']/actions:['*'] — necessário para
// as rotas técnicas de sistema/integração (auditoria, aprovação de cadastro, backup, Monday), gated por
// `allowed(user,'*',ação)` (módulo literal `'*'`, não um módulo de negócio). O problema: como
// `policy.modules.includes('*')` também torna `allowed(user, qualquerModulo, ação)` verdadeiro, o mesmo
// wildcard "abria" qualquer módulo de CONTEÚDO de negócio (agenda/comitês/orçamento/projetos/jurídico/
// TI) para criação/alteração/arquivamento/restauração/exportação — exatamente o que o MASTER_HANDOFF
// §11 proíbe ("administrador técnico ≠ superusuário de conteúdo"). `allowedInDepartment()` sozinho não
// resolve isso: seu bypass de departamento para `administrador` existe para permitir a operação técnica
// de integração (ex.: `POST /api/monday/sync`), não para autorizar mutação de conteúdo.
// BUSINESS_CONTENT_MODULES são os módulos operacionais/departamentais cujo CRUD é feito pelo motor
// genérico de entidades, agenda, comitês, orçamento e sub-recursos de projeto — deny-by-default para
// `administrador` em qualquer ação de MUTAÇÃO (tudo exceto leitura, que `scoped()` já filtra
// corretamente — ver rodada 5, item 3). Leitura permanece via `allowed()`/`allowedInDepartment()`
// normalmente, não por aqui.
const BUSINESS_CONTENT_MODULES = new Set(['central','estrategia','projetos','agenda','comites','orcamento','juridico','ti']);
function allowedContent(user, module, action) {
  if (user.role === 'administrador' && BUSINESS_CONTENT_MODULES.has(module)) return false;
  return allowedInDepartment(user, module, action);
}
// Normaliza um nome de departamento para o slug usado em departmentId ('dep-juridico', 'dep-ti', ...).
// Extraído para evitar repetir a mesma expressão de normalização em múltiplos pontos do código.
function normalizeDeptSlug(department) { return String(department || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
// P0 corrigido (rodada 5, item 5): centraliza a MESMA autorização usada em GET /api/dashboards/:id
// (módulo + alçada global para dashboards corporativos + departamento) para reaproveitar em
// /api/dashboard-preferences/:id — que antes não verificava autorização nenhuma antes de ler/gravar
// preferências de um dashboard.
function dashboardAuthorized(user, definition) {
  if (!definition) return false;
  if (!allowed(user, definition.module)) return false;
  if (dashboardRequiresGlobalScope(definition) && !hasGlobalScope(user)) return false;
  // P0 corrigido (rodada 6, item 2): dashboard departamental (`scope:'department'`) só pode ser
  // acessado por (A) alçada de negócio global ou (B) usuário cujo department corresponde ao
  // `departmentId` do dashboard. Antes, a negação só era avaliada quando `user.department` existia E
  // não batia (`user.department && definition.departmentId && mismatch`) — um usuário SEM department
  // (como `administrador` técnico, que não tem alçada global de negócio desde a rodada 5) nunca caía
  // nessa condição e passava despercebido, apesar de `modules:['*']` fazer o gate de módulo acima
  // sempre aceitar. Agora é deny-by-default: ausência de department correspondente nega, não libera.
  if (definition.scope === 'department' && !hasGlobalScope(user)) {
    if (!definition.departmentId || !user.department || !definition.departmentId.endsWith(normalizeDeptSlug(user.department))) return false;
  }
  return true;
}
function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); }
// Sprint 2, Fase 4B (revisão pós-PR #8, P1.2): `deletedAt` em `users` agora é consistentemente a
// convenção de "usuário inativo" também na autenticação — uma sessão de um usuário com `deletedAt`
// preenchido nunca é resolvida como válida aqui (mesmo padrão de soft-delete já aplicado a
// processos/agenda/entidades genéricas, agora fechado também no ponto de entrada de sessão), para não
// deixar `responsibleInactive`/rejeição de nova atribuição inconsistentes com quem ainda pode logar.
// Não cria rota de inativação (fora de escopo) nem revoga sessões já emitidas antes da inativação
// (fora de escopo — ver docs/SECURITY.md, "Revogação de sessão").
// Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): a sessão deixa de
// viver em `sessions.get(token)` (Map em memória do processo) e passa a ser resolvida em
// `store.authSessions` (auth_sessions, migrations/005_h2_auth_sessions.sql) — sobrevive a restart e é
// compartilhada entre instâncias via o mesmo Postgres. `getUser()` recebe o `store` já lido pelo
// chamador (evita uma segunda leitura completa da store a cada requisição autenticada). Nega a sessão
// quando: token não bate com nenhum hash gravado; sessão revogada (`revokedAt`); expirada
// (`expiresAt`); usuário não existe mais ou está logicamente inativo (`deletedAt`); ou
// `session.credentialsVersion` diverge de `user.credentialsVersion` — este último é o mecanismo que
// invalida TODAS as sessões emitidas antes de uma troca/reset de senha, sem precisar apagá-las uma a
// uma (item 19 do escopo).
async function getUser(req, store) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const tokenHash = authCrypto.hashToken(token);
  const session = (store.authSessions || []).find(s => s.tokenHash === tokenHash);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  const found = store.users.find(u => u.id === session.userId);
  if (!found || found.deletedAt) return null;
  if (session.credentialsVersion !== (found.credentialsVersion || 1)) return null;
  // `lastSeenAt` deliberadamente NÃO é atualizado aqui a cada requisição: sem idle timeout nesta rodada
  // (simplificação documentada em docs/SECURITY.md), atualizar a cada leitura só produziria uma escrita
  // extra por requisição autenticada sem nenhum efeito funcional, além de quebrar a idempotência
  // observável de rotas de view pura (ex.: GET /api/my-week) nos testes de integração.
  return found;
}
async function body(req) { let s=''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }
function metrics(store) { const finance=departmentFinancials(store); const total=finance.reduce((n,d)=>n+(d.actual||0),0); const budget=finance.reduce((n,d)=>n+(d.budget||0),0); return { realized:total, budget, execution:budget?total/budget:0, composition:finance.map(d=>({departmentId:d.departmentId,departmentName:d.departmentName,budget:d.budget,actual:d.actual})), agenda:store.agenda.length, audit:store.audit.length }; }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function encryptBackup(value) {
  if (!BACKUP_KEY || BACKUP_KEY.length < 32) throw new Error('COEVO_BACKUP_KEY deve ter pelo menos 32 caracteres');
  const iv=crypto.randomBytes(12); const key=crypto.createHash('sha256').update(BACKUP_KEY).digest(); const cipher=crypto.createCipheriv('aes-256-gcm',key,iv); const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]); return {algorithm:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),payload:encrypted.toString('base64'),checksum:hash(encrypted.toString('base64'))};
}
function decryptBackup(input) {
  if (!BACKUP_KEY || BACKUP_KEY.length < 32) throw new Error('COEVO_BACKUP_KEY deve ter pelo menos 32 caracteres');
  const key=crypto.createHash('sha256').update(BACKUP_KEY).digest(); const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(input.iv,'base64')); decipher.setAuthTag(Buffer.from(input.tag,'base64')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(input.payload,'base64')),decipher.final()]).toString('utf8'));
}
// P0 corrigido (item D do docs/SEGURANCA-CORRECOES.md): MFA para perfis privilegiados é exigido pelo
// papel, não pela flag `mfa` do próprio cadastro — um cadastro aprovado com `mfa:false` e papel
// privilegiado não deve conseguir contornar o segundo fator (MASTER_HANDOFF §11/§31).
function requireMfa(user) { return user.role === 'diretoria' || user.role === 'administrador' || user.role === 'lider'; }
// Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): sessão persistente —
// o token bruto (`generateOpaqueToken()`, CSPRNG de 32 bytes) só existe na resposta HTTP; o banco grava
// apenas `tokenHash` (`hashToken()`, SHA-256 — o token já tem 256 bits de entropia própria, dispensando
// um KDF lento como para senha). `credentialsVersion` é copiado do usuário no momento da criação: uma
// troca/reset de senha posterior incrementa `user.credentialsVersion`, o que invalida esta sessão sem
// precisar apagá-la explicitamente (ver getUser()).
function createSession(store, user) {
  if (!Array.isArray(store.authSessions)) store.authSessions = [];
  const rawToken = authCrypto.generateOpaqueToken();
  const session = {
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: authCrypto.hashToken(rawToken),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    lastSeenAt: new Date().toISOString(),
    revokedAt: null,
    credentialsVersion: user.credentialsVersion || 1,
    version: 1
  };
  store.authSessions.push(session);
  return { session, token: rawToken };
}
function revokeSession(session) { if (session && !session.revokedAt) session.revokedAt = new Date().toISOString(); }
// Usado em: troca de senha, reset de senha concluído e inativação lógica do usuário — nenhuma dessas
// operações confia em o cliente "esquecer" o token; a sessão é revogada no servidor (item 18 do escopo).
function revokeAllUserSessions(store, userId) {
  for (const session of store.authSessions || []) if (session.userId === userId && !session.revokedAt) session.revokedAt = new Date().toISOString();
}
// Item 6 e bloco de bootstrapping do MFA obrigatório: enquanto a conta tem senha temporária OU exige
// MFA por papel mas ainda não concluiu o enrolamento, só uma lista mínima de rotas de autogestão da
// própria conta é permitida — nunca conteúdo de negócio (código de erro `ACCOUNT_SETUP_REQUIRED`).
const AUTH_SETUP_ALLOWED_PATHS = new Set(['/api/auth/change-password', '/api/auth/mfa/enroll', '/api/auth/mfa/confirm', '/api/auth/logout', '/api/me']);
function accountSetupRequired(user) { return Boolean(user.temporaryPassword) || (requireMfa(user) && !user.mfaEnabled); }
// Item 15/16 do escopo: nunca devolver hash de senha nem segredo MFA cifrado via API — usado sempre que
// o próprio objeto de usuário é devolvido ao cliente (ex.: GET /api/me).
const SENSITIVE_USER_FIELDS = ['passwordHash', 'mfaSecretEncrypted'];
function publicUser(user) { return Object.fromEntries(Object.entries(user).filter(([key]) => !SENSITIVE_USER_FIELDS.includes(key))); }
// Revisão pós-PR #13 (docs/DECISIONS.md, PROD-H2-01): `email` nunca foi único em `app_users` (gap
// preexistente de H1B, seed inclusive) — resolver por `find(first-match)` sobre e-mail duplicado não é
// compatível com autenticação individual (não há garantia de qual conta de fato autentica). O
// identificador PRIMÁRIO de login passa a ser `login_identifier` (técnico, único —
// migrations/006_h2_unique_login_identity.sql); `email` continua aceito só por compatibilidade e SOMENTE
// quando resolve para EXATAMENTE um usuário ativo — caso contrário (zero ou mais de um), o chamador trata
// como "não encontrado" (mesma resposta genérica), nunca escolhendo uma conta arbitrária.
function resolveLoginIdentity(store, input) {
  const loginId = typeof input.login === 'string' ? input.login.trim() : '';
  if (loginId) return store.users.find(u => u.loginIdentifier === loginId);
  const email = String(input.email || '').toLowerCase();
  if (!email) return undefined;
  const matches = store.users.filter(u => u.email.toLowerCase() === email && !u.deletedAt);
  return matches.length === 1 ? matches[0] : undefined;
}
// Emissão de token de reset/primeiro acesso — usado tanto pelo fluxo público (forgot-password, só
// quando o e-mail resolve para exatamente um usuário ativo) quanto pela rota administrativa
// (POST /api/auth/users/:id/reset-token, por userId explícito, nunca por e-mail). Único ponto que cria
// uma linha em password_reset_tokens — garante que toda emissão siga exatamente a mesma regra (CSPRNG,
// hash apenas persistido, expiração, uso único).
function issuePasswordResetToken(store, targetUser) {
  if (!Array.isArray(store.passwordResetTokens)) store.passwordResetTokens = [];
  const rawToken = authCrypto.generateOpaqueToken();
  const record = { id: crypto.randomUUID(), userId: targetUser.id, tokenHash: authCrypto.hashToken(rawToken), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+PASSWORD_RESET_TTL_MS).toISOString(), usedAt: null, version: 1 };
  store.passwordResetTokens.push(record);
  return { rawToken, record };
}
// P0 corrigido (rodada 2): antes, um registro SEM `department` era tratado como acessível a qualquer
// usuário autenticado — ausência de classificação virava, na prática, "global" por acidente. Agora é
// deny-by-default: um registro só é global se explicitamente marcado (`scopeType:'global'`); um
// registro sem classificação nenhuma é negado, nunca liberado por omissão.
//
// Empresa/SPE (MASTER_HANDOFF §4/§11): nenhum cadastro de empresa/SPE existe ainda neste repositório —
// nenhum ID foi inventado. As linhas de `companyId`/`speId` abaixo são a fundação da autorização por
// empresa/SPE prevista na v1.3: hoje são inertes (nenhum registro ou usuário carrega esses campos),
// mas já bloqueiam automaticamente quando esse cadastro existir, sem exigir nova revisão de `scoped()`.
// Ver docs/PERMISSIONS.md para o estado exato do que está e do que NÃO está implementado.
// P0 corrigido (rodada 3): a checagem de companyId/speId só negava quando AMBOS os lados carregavam
// o campo — um usuário sem companyId conseguia acessar um registro com companyId (porque
// `item.companyId && user.companyId` era falso quando o usuário não tinha o campo, então a condição de
// negação inteira nunca era avaliada). Isso não é deny-by-default. Agora: se o registro tem
// companyId/speId, o usuário PRECISA ter o mesmo valor (ausência ou valor diferente nega); mesma regra
// para speId. Continua inerte hoje (nenhum registro/usuário real carrega esses campos — ver
// docs/PERMISSIONS.md), mas testado com dados sintéticos em tests/core.test.js.
function scoped(user, item) {
  // P0 corrigido (rodada 5, item 3): bypass agora usa hasGlobalScope() (ROLES[role].scopes) em vez de
  // checar `user.role === 'administrador'` diretamente — uma única fonte de verdade para "alçada de
  // negócio global". Com `administrador.scopes` mudado para `[]`, administrador deixa de bypassar
  // scoped() automaticamente: precisa que o próprio registro esteja no seu escopo (ex.: department),
  // exatamente como qualquer outro usuário sem alçada global — não é mais superusuário de conteúdo.
  if (hasGlobalScope(user)) return true;
  if (item.scopeType === 'global') return true;
  if (item.companyId && (!user.companyId || user.companyId !== item.companyId)) return false;
  if (item.speId && (!user.speId || user.speId !== item.speId)) return false;
  if (!item.department) return false;
  return item.department === user.department;
}
function collection(store, type) { if (!store.records) store.records = {}; if (!store.records[type]) store.records[type] = []; return store.records[type]; }
function parseCsv(csv) {
  const rows = String(csv || '').trim().split(/\r?\n/).filter(Boolean).map(row => row.split(',').map(v => v.trim()));
  if (!rows.length) return { headers: [], valid: [], invalid: ['Arquivo vazio'], duplicates: [] };
  const headers = rows.shift(); const required = ['department','competence','budgeted','planned','committed','realized']; const missing = required.filter(x => !headers.includes(x));
  if (missing.length) return { headers, valid: [], invalid: [`Cabeçalhos ausentes: ${missing.join(', ')}`], duplicates: [] };
  const indexes = Object.fromEntries(headers.map((h,i)=>[h,i])); const seen = new Set(); const valid=[]; const invalid=[]; const duplicates=[];
  for (const row of rows) { const item = Object.fromEntries(headers.map((h,i)=>[h,row[i]])); const key=`${item.department}|${item.competence}`; if(seen.has(key)){duplicates.push(key);continue} seen.add(key); if(!item.department || !/^\d{4}-\d{2}$/.test(item.competence) || required.slice(2).some(k=>Number.isNaN(Number(item[k])))){invalid.push(item);continue} valid.push(item); }
  return { headers, valid, invalid, duplicates };
}
async function mondayQuery(query, variables={}) {
  if(!process.env.MONDAY_TOKEN) throw new Error('MONDAY_TOKEN não configurado no backend');
  const response=await fetch('https://api.monday.com/v2',{method:'POST',headers:{'Content-Type':'application/json','Authorization':process.env.MONDAY_TOKEN,'API-Version':'2024-10'},body:JSON.stringify({query,variables})});
  const data=await response.json(); if(!response.ok || data.errors?.length) throw new Error(data.errors?.map(e=>e.message).join('; ') || `Monday HTTP ${response.status}`); return data.data;
}
async function fetchMondayBoard(boardId) {
  const query=`query($boardId:ID!,$limit:Int!,$cursor:String){boards(ids:[$boardId]){columns{id title} items_page(limit:$limit,cursor:$cursor){cursor items{id name created_at group{id title} column_values{id text}}}}}`;
  let cursor=null, items=[]; let columnTitles={}; do { const data=await mondayQuery(query,{boardId:String(boardId),limit:200,cursor}); const board=data.boards?.[0]; const page=board?.items_page; if(!page)break; columnTitles=Object.fromEntries((board.columns||[]).map(c=>[String(c.id),c.title])); items=items.concat((page.items||[]).map(item=>({...item,column_titles:columnTitles})));cursor=page.cursor||null; } while(cursor); return items;
}
// department:'Jurídico' é atribuído explicitamente porque todos os boards em MONDAY_BOARDS pertencem
// ao Jurídico (P0 corrigido na rodada 2 de scoped(): ausência de `department` deixou de significar
// acesso liberado a qualquer departamento — sem esta classificação explícita, TI teria sido bloqueado
// destes registros por engano, em vez de Jurídico ser corretamente isolado de TI).
function normalizeMondayItem(item,module,board){const columns=Object.fromEntries((item.column_values||[]).map(c=>[c.id,c.text]));const columnsByTitle=Object.fromEntries((item.column_values||[]).map(c=>[item.column_titles?.[c.id]||c.id,c.text]));return {id:crypto.randomUUID(),source:'monday',externalId:String(item.id),module,boardId:board.id,boardName:board.name,department:'Jurídico',title:item.name,group:item.group?.title||null,columns,columnsByTitle,createdAt:item.created_at||null,syncedAt:new Date().toISOString(),classification:'Interno',deletedAt:null};}
function processColumn(row,title,id){return String(row.columnsByTitle?.[title]??row.columns?.[id]??'').trim();}
function processStatusValue(row){const value=processColumn(row,"'MEU TRABALHO'",'status5')||processColumn(row,'STATUS (para comitê)','status84__1')||processColumn(row,'STATUS','color_mky1db73');if(/acordo/i.test(value))return 'Acordo';if(/finaliz|encerr|baix|extint|arquiv/i.test(value))return 'Finalizado';if(/acompanha/i.test(value))return 'Em acompanhamento';if(/andamento|suspenso/i.test(value))return 'Em andamento';return 'A classificar';}
function processScopeValue(row){const value=processColumn(row,'LOCAL','status3');if(/interno/i.test(value))return 'Interno';if(/externo/i.test(value))return 'Externo';return 'A classificar';}
function processPartyValue(row){const value=processColumn(row,'POSIÇÃO','status');if(/requerente|autor/i.test(value))return 'Requerente';if(/requerid|reclamad|réu|reu/i.test(value))return 'Requerida';return 'A classificar';}
function processTypeValue(row){return processColumn(row,'TIPO DE AÇÃO','status8')||processColumn(row,'MOTIVO','status4')||'Não informado';}
function processEnterpriseValue(row){return processColumn(row,'EMPREENDIMENTO','status__1')||row.group||'Não informado';}
function processResponsibleValues(row){const raw=processColumn(row,'RESPONSÁVEL','person');return [...new Set(raw.split(',').map(value=>value.trim()).filter(Boolean))];}
function processExternalResponsibleValues(row){const local=processColumn(row,'LOCAL','status3'),match=local.match(/^EXTERNO\s+(.+)$/i);if(!match)return [];return match[1].split(/[,;/]/).map(value=>value.trim().toLocaleLowerCase('pt-BR').replace(/(^|\s)\p{L}/gu,char=>char.toLocaleUpperCase('pt-BR'))).filter(Boolean);}
function processAllResponsibleValues(row){return [...new Set([...processResponsibleValues(row),...processExternalResponsibleValues(row)])];}
function processRelevantDate(row){return processColumn(row,'DATA','data6')||processColumn(row,'CITAÇÃO/PROTOCOLO','data8')||String(row.createdAt||'').slice(0,10)||null;}
function processCompetenceDate(row){return processColumn(row,'CITAÇÃO/PROTOCOLO','data8')||String(row.createdAt||'').slice(0,10)||processRelevantDate(row);}
function processYearValue(row){return String(row.title||'').match(/\.(20\d{2})\./)?.[1]||processCompetenceDate(row)?.slice(0,4)||'Não informado';}
function processMonthValue(row){const date=processCompetenceDate(row);return date?.slice(5,7)||'Não informado';}
function processSearchText(row){return [row.title,row.group,processEnterpriseValue(row),...processResponsibleValues(row),...processExternalResponsibleValues(row),processTypeValue(row),...Object.values(row.columns||{}),...Object.values(row.columnsByTitle||{})].join(' ').toLocaleLowerCase('pt-BR');}
function processFacet(rows,getter){return [...new Set(rows.flatMap(row=>{const value=getter(row);return Array.isArray(value)?value:[value]}).filter(value=>value&&value!=='Não informado'))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));}
function filterProcesses(rows,url){const values=name=>url.searchParams.getAll(name).map(value=>value.trim()).filter(Boolean),selected={status:values('status'),enterprise:values('enterprise'),responsible:values('responsible'),externalResponsible:values('externalResponsible'),scope:values('scope'),year:values('year'),type:values('type'),month:values('month'),party:values('party')},search=String(url.searchParams.get('search')||'').trim().toLocaleLowerCase('pt-BR');const filtered=rows.filter(row=>(!search||processSearchText(row).includes(search))&&(!selected.status.length||selected.status.includes(processStatusValue(row)))&&(!selected.enterprise.length||selected.enterprise.includes(processEnterpriseValue(row)))&&(!selected.responsible.length||processAllResponsibleValues(row).some(value=>selected.responsible.includes(value)))&&(!selected.externalResponsible.length||processExternalResponsibleValues(row).some(value=>selected.externalResponsible.includes(value)))&&(!selected.scope.length||selected.scope.includes(processScopeValue(row)))&&(!selected.year.length||selected.year.includes(processYearValue(row)))&&(!selected.type.length||selected.type.includes(processTypeValue(row)))&&(!selected.month.length||selected.month.includes(processMonthValue(row)))&&(!selected.party.length||selected.party.includes(processPartyValue(row))));const sort=url.searchParams.get('sort')||'date',direction=url.searchParams.get('direction')==='asc'?1:-1,getter={process:row=>String(row.title||''),date:row=>String(processRelevantDate(row)||''),enterprise:processEnterpriseValue,responsible:row=>processAllResponsibleValues(row).join(', '),externalResponsible:row=>processExternalResponsibleValues(row).join(', '),status:processStatusValue}[sort]||processRelevantDate;filtered.sort((a,b)=>String(getter(a)||'').localeCompare(String(getter(b)||''),'pt-BR',{numeric:true})*direction);const pageSize=[25,50,100].includes(Number(url.searchParams.get('pageSize')))?Number(url.searchParams.get('pageSize')):25,totalPages=Math.max(1,Math.ceil(filtered.length/pageSize)),page=Math.min(totalPages,Math.max(1,Number(url.searchParams.get('page'))||1)),start=(page-1)*pageSize;return {records:filtered.slice(start,start+pageSize),count:filtered.length,totalAvailable:rows.length,pagination:{page,pageSize,totalPages},facets:{status:processFacet(rows,processStatusValue),enterprise:processFacet(rows,processEnterpriseValue),responsible:processFacet(rows,processAllResponsibleValues),scope:processFacet(rows,processScopeValue),year:processFacet(rows,processYearValue).sort((a,b)=>String(b).localeCompare(String(a))),type:processFacet(rows,processTypeValue),month:processFacet(rows,processMonthValue),party:processFacet(rows,processPartyValue)}};}

const HONORARIUM_MONTHS={JAN:'01',JANEIRO:'01',FEV:'02',FEVEREIRO:'02',MAR:'03',MARCO:'03',ABR:'04',ABRIL:'04',MAI:'05',MAIO:'05',JUN:'06',JUNHO:'06',JUL:'07',JULHO:'07',AGO:'08',AGOSTO:'08',SET:'09',SETEMBRO:'09',OUT:'10',OUTUBRO:'10',NOV:'11',NOVEMBRO:'11',DEZ:'12',DEZEMBRO:'12'};
function honorariumColumn(row,title,id){return String(row.columnsByTitle?.[title]??row.columns?.[id]??'').trim();}
function honorariumCompetence(row){const normalized=String(row.group||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,'');const match=normalized.match(/^([A-Z]+)\/?(\d{2}|\d{4})$/);if(match&&HONORARIUM_MONTHS[match[1]]){const year=match[2].length===2?`20${match[2]}`:match[2];return `${year}-${HONORARIUM_MONTHS[match[1]]}`;}const date=honorariumColumn(row,'Data','data')||String(row.createdAt||'').slice(0,10);return /^\d{4}-\d{2}/.test(date)?date.slice(0,7):'Não informada';}
function honorariumStatus(row){return honorariumColumn(row,'Status','status')||'Não informado';}
function honorariumEnterprise(row){return honorariumColumn(row,'🏢 Empreendimento Consolidado','status_1__1')||honorariumColumn(row,'EMPREENDIMENTO','status_1__1')||'Não informado';}
function honorariumResponsibleValues(row){const raw=honorariumColumn(row,'Pessoa','person');return [...new Set(raw.split(/[,;/]/).map(value=>value.trim()).filter(Boolean))];}
function honorariumType(row){return honorariumColumn(row,'📋 Tipo de Honorário','color_mm35a6aw')||'Não informado';}
function honorariumDate(row){return honorariumColumn(row,'📅 Data Solicitação','date_mm3512fb')||honorariumColumn(row,'Data','data')||String(row.createdAt||'').slice(0,10)||null;}
function honorariumPaymentMethod(row){return honorariumColumn(row,'💳 Forma de Pagamento','color_mm35trwq')||'Não informado';}
function honorariumUnit(row){return honorariumColumn(row,'UNIDADE','texto__1')||'Não informado';}
function honorariumAmount(row){const raw=honorariumColumn(row,'💰 Honorário Total','numeric_mm35fmz7')||honorariumColumn(row,'HONORÁRIOS','n_meros7__1');const text=String(raw).trim(),value=Number(text.includes(',')?text.replace(/\./g,'').replace(',','.'):text);return Number.isFinite(value)?value:null;}
function honorariumView(row){const competence=honorariumCompetence(row);return {status:honorariumStatus(row),enterprise:honorariumEnterprise(row),responsibles:honorariumResponsibleValues(row),type:honorariumType(row),competence,month:competence.slice(5,7),year:competence.slice(0,4),date:honorariumDate(row),paymentMethod:honorariumPaymentMethod(row),unit:honorariumUnit(row),amount:honorariumAmount(row)};}
function filterHonorariums(rows,url){
  const values=name=>url.searchParams.getAll(name).map(value=>value.trim()).filter(Boolean);
  const selected={status:values('status'),enterprise:values('enterprise'),responsible:values('responsible'),year:values('year'),type:values('type'),month:values('month'),competence:values('competence'),paymentMethod:values('paymentMethod'),unit:values('unit')};
  const search=String(url.searchParams.get('search')||'').trim().toLocaleLowerCase('pt-BR');
  const enriched=rows.map(row=>({row,view:honorariumView(row)}));
  const filtered=enriched.filter(({row,view})=>{const haystack=[row.title,row.group,view.status,view.enterprise,...view.responsibles,view.type,view.competence,view.paymentMethod,view.unit,...Object.values(row.columnsByTitle||{})].join(' ').toLocaleLowerCase('pt-BR');return(!search||haystack.includes(search))&&(!selected.status.length||selected.status.includes(view.status))&&(!selected.enterprise.length||selected.enterprise.includes(view.enterprise))&&(!selected.responsible.length||view.responsibles.some(value=>selected.responsible.includes(value)))&&(!selected.year.length||selected.year.includes(view.year))&&(!selected.type.length||selected.type.includes(view.type))&&(!selected.month.length||selected.month.includes(view.month))&&(!selected.competence.length||selected.competence.includes(view.competence))&&(!selected.paymentMethod.length||selected.paymentMethod.includes(view.paymentMethod))&&(!selected.unit.length||selected.unit.includes(view.unit));});
  const direction=url.searchParams.get('direction')==='asc'?1:-1,sort=url.searchParams.get('sort')||'date',getter={date:item=>item.view.date||'',status:item=>item.view.status,enterprise:item=>item.view.enterprise,responsible:item=>item.view.responsibles.join(', '),competence:item=>item.view.competence,amount:item=>item.view.amount??-1}[sort]||((item)=>item.view.date||'');
  filtered.sort((a,b)=>String(getter(a)).localeCompare(String(getter(b)),'pt-BR',{numeric:true})*direction);
  const pageSize=[25,50,100].includes(Number(url.searchParams.get('pageSize')))?Number(url.searchParams.get('pageSize')):25,totalPages=Math.max(1,Math.ceil(filtered.length/pageSize)),page=Math.min(totalPages,Math.max(1,Number(url.searchParams.get('page'))||1)),start=(page-1)*pageSize,facet=(getter,excludeMissing=true)=>processFacet(enriched.map(item=>item.view),getter).filter(value=>!excludeMissing||!/^Não informad/.test(value));
  const aggregate=period=>{const groups=new Map();for(const {view} of filtered){if(!Number.isFinite(view.amount)||view.competence==='Não informada')continue;const [year,month]=view.competence.split('-'),key=period==='month'?view.competence:period==='quarter'?`${year}-T${Math.ceil(Number(month)/3)}`:`${year}-S${Math.ceil(Number(month)/6)}`;const current=groups.get(key)||{key,total:0,count:0};current.total+=view.amount;current.count++;groups.set(key,current);}return [...groups.values()].sort((a,b)=>String(b.key).localeCompare(String(a.key)));};
  const amounts=filtered.map(item=>item.view.amount).filter(Number.isFinite);
  const summary={total:amounts.reduce((sum,value)=>sum+value,0),recordsWithAmount:amounts.length,average:amounts.length?amounts.reduce((sum,value)=>sum+value,0)/amounts.length:null,months:aggregate('month'),quarters:aggregate('quarter'),semesters:aggregate('semester')};
  return {records:filtered.slice(start,start+pageSize).map(({row,view})=>({...row,normalized:view})),count:filtered.length,totalAvailable:rows.length,lastSyncedAt:rows.map(row=>row.syncedAt).filter(Boolean).sort().at(-1)||null,summary,pagination:{page,pageSize,totalPages},facets:{status:facet(item=>item.status),enterprise:facet(item=>item.enterprise),responsible:facet(item=>item.responsibles),year:facet(item=>item.year).sort((a,b)=>String(b).localeCompare(String(a))),type:facet(item=>item.type),month:facet(item=>item.month),competence:facet(item=>item.competence).sort().reverse(),paymentMethod:facet(item=>item.paymentMethod),unit:facet(item=>item.unit)}};
}
function judicialHonorariumPayload(rows){
  const normalized=rows.map(row=>{const raw=processColumn(row,'HONORÁRIOS EFETIVADOS',''),amount=Number(String(raw).replace(',','.'));if(!String(raw).trim()||!Number.isFinite(amount))return null;const date=processCompetenceDate(row),year=processYearValue(row),competence=/^\d{4}-\d{2}/.test(String(date||''))?String(date).slice(0,7):null;return {...row,normalized:{amount,date,year,competence,enterprise:processEnterpriseValue(row),responsibles:processAllResponsibleValues(row),status:processStatusValue(row),type:processTypeValue(row)}};}).filter(Boolean).sort((a,b)=>String(b.normalized.date||'').localeCompare(String(a.normalized.date||'')));
  const total=normalized.reduce((sum,row)=>sum+row.normalized.amount,0),aggregate=period=>{const groups=new Map();for(const row of normalized){const competence=row.normalized.competence;if(!competence)continue;const [year,month]=competence.split('-'),key=period==='month'?competence:period==='quarter'?`${year}-T${Math.ceil(Number(month)/3)}`:`${year}-S${Math.ceil(Number(month)/6)}`,current=groups.get(key)||{key,total:0,count:0};current.total+=row.normalized.amount;current.count++;groups.set(key,current);}return [...groups.values()].sort((a,b)=>String(b.key).localeCompare(String(a.key)));};
  return {records:normalized,count:normalized.length,totalAvailable:normalized.length,lastSyncedAt:normalized.map(row=>row.syncedAt).filter(Boolean).sort().at(-1)||null,summary:{total,recordsWithAmount:normalized.length,average:normalized.length?total/normalized.length:null,months:aggregate('month'),quarters:aggregate('quarter'),semesters:aggregate('semester')}};
}
async function runMondaySync(store, requestedBy='Agendador COEVO') {
  store.mondayRuns=store.mondayRuns||[]; const run={id:crypto.randomUUID(),startedAt:new Date().toISOString(),requestedBy,modules:[],status:'running'}; store.mondayRuns.push(run); let failed=0;
  for(const [moduleName,board] of Object.entries(MONDAY_BOARDS)){try{const items=await fetchMondayBoard(board.id);const list=collection(store,moduleName);let created=0,updated=0;for(const raw of items){const normalized=normalizeMondayItem(raw,moduleName,board);const existing=list.find(x=>x.source==='monday'&&x.externalId===normalized.externalId);if(existing){Object.assign(existing,normalized,{id:existing.id,version:(existing.version||1)+1});updated++;}else{list.push({...normalized,version:1});created++;}}run.modules.push({module:moduleName,board:board.name,read:items.length,created,updated,status:'ok'});}catch(error){failed++;run.modules.push({module:moduleName,board:board.name,status:'error',error:error.message});}}
  run.status=failed?'partial':'completed';run.finishedAt=new Date().toISOString();return run;
}
function scheduleDueNow(now=new Date()){const local=now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Sao_Paulo'});return MONDAY_SYNC_TIMES.includes(local)?local:null;}
async function scheduledMondayTick(){if(!process.env.MONDAY_TOKEN)return;const store=await readStore();const due=scheduleDueNow();if(!due)return;const date=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});if((store.mondayRuns||[]).some(r=>r.trigger==='scheduled'&&r.scheduleTime===due&&String(r.startedAt).startsWith(date)))return;const run=await runMondaySync(store,'Agendador COEVO');run.trigger='scheduled';run.scheduleTime=due;audit(store,{name:'Agendador COEVO'},'SYNC_SCHEDULED','monday',run.id,null,run,'Sincronização automática programada');await writeStore(store);}

function staticFile(res, file) {
  const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff' });
  return fs.createReadStream(file).pipe(res);
}
function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/v1/')) url.pathname = url.pathname.replace('/api/v1/', '/api/');
  if (req.method === 'GET' && url.pathname === '/') return staticFile(res, path.join(ROOT, 'public', 'index.html'));
  if (req.method === 'GET' && url.pathname === '/status') return staticFile(res, path.join(ROOT, 'public', 'status.html'));
  if (req.method === 'GET' && ['/app.js','/dashboard-widgets.js','/styles.css','/sidebar.css','/dashboard.css','/dashboard-widgets.css','/processes.css','/projects.css'].includes(url.pathname)) return staticFile(res, path.join(ROOT, 'public', path.basename(url.pathname)));
  if (req.method === 'GET' && /^\/logo-coevo[^/]*\.png$/.test(url.pathname)) { const file = path.join(ROOT, 'public', path.basename(url.pathname)); if (fs.existsSync(file)) return staticFile(res, file); return json(res,404,{error:'Não encontrado'}); }
  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) { const file = path.join(ROOT, url.pathname); if (fs.existsSync(file)) return staticFile(res, file); return json(res,404,{error:'Não encontrado'}); }
  if (!url.pathname.startsWith('/api/')) return json(res,404,{error:'Não encontrado'});
  // Sprint 2, Hardening H1A: a partir daqui a rota é assíncrona (persistência real, Postgres ou
  // fallback local) — embrulhada numa IIFE async com try/catch únicos para todo o roteamento, em vez
  // de espalhar tratamento de erro de storage por cada uma das rotas. `StoreConflictError` (conflito de
  // concorrência, PG-02) vira 409; qualquer outra falha de persistência vira 503, nunca um 500 genérico
  // escondendo a causa nem uma gravação parcial silenciosa.
  return (async () => {
  try {
  const store = await readStore();
  const module = url.pathname.split('/')[2];
  // Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): login individual —
  // localiza o usuário → verifica deletedAt → verifica bloqueio → verifica senha individual (nunca a
  // senha global COEVO_DEMO_PASSWORD) → só então, se MFA ativo, emite um desafio individual (nunca a
  // sessão completa antes da confirmação do segundo fator). Mensagem/HTTP genéricos em toda falha para
  // não revelar por timing/texto se o e-mail existe, está inativo ou está bloqueado.
  if (req.method === 'POST' && url.pathname === '/api/auth/login') return body(req).then(async input => {
    const found = resolveLoginIdentity(store, input);
    const genericInvalid = () => json(res,401,{error:'Credenciais inválidas'});
    if (!found || found.deletedAt) return genericInvalid();
    // Item 18 do escopo (anti-enumeração): conta bloqueada nunca recebe uma resposta HTTP/mensagem
    // diferente de "credenciais inválidas" — a diferença (423 vs 401) permitia inferir externamente que
    // aquela conta específica existe e está bloqueada. Auditoria interna continua distinguindo
    // ACCOUNT_LOCKED/LOGIN_FAILURE normalmente; só a superfície HTTP é uniforme.
    if (found.lockedUntil && new Date(found.lockedUntil).getTime() > Date.now()) {
      audit(store,found,'LOGIN_FAILURE','user',found.id,null,null,'Conta temporariamente bloqueada por excesso de tentativas');
      await writeStore(store);
      return genericInvalid();
    }
    if (!found.passwordHash || !authCrypto.verifyPassword(input.password, found.passwordHash)) {
      found.failedLoginCount = (found.failedLoginCount || 0) + 1;
      let locked = false;
      if (found.failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS) { found.lockedUntil = new Date(Date.now()+LOCKOUT_DURATION_MS).toISOString(); found.failedLoginCount = 0; locked = true; }
      audit(store,found,'LOGIN_FAILURE','user',found.id,null,null,'Senha inválida');
      if (locked) audit(store,found,'ACCOUNT_LOCKED','user',found.id,null,null,'Excesso de tentativas de login malsucedidas');
      await writeStore(store);
      return genericInvalid();
    }
    found.failedLoginCount = 0;
    if (found.lockedUntil) { found.lockedUntil = null; audit(store,found,'ACCOUNT_UNLOCKED','user',found.id,null,null,'Login bem-sucedido após período de bloqueio'); }
    if (requireMfa(found) && found.mfaEnabled) {
      if (!Array.isArray(store.authChallenges)) store.authChallenges = [];
      const challenge = { id: crypto.randomUUID(), userId: found.id, type: 'totp', expiresAt: new Date(Date.now()+MFA_CHALLENGE_TTL_MS).toISOString(), usedAt: null, attempts: 0, createdAt: new Date().toISOString(), version: 1 };
      store.authChallenges.push(challenge);
      audit(store,found,'MFA_CHALLENGE','user',found.id,null,null,'Desafio de segundo fator emitido');
      if (!(await commitStore(res,store))) return;
      return json(res,200,{mfaRequired:true,challenge:challenge.id});
    }
    const { token } = createSession(store,found);
    found.lastLoginAt = new Date().toISOString();
    audit(store,found,'LOGIN_SUCCESS','user',found.id,null,null,'Login concluído');
    if (!(await commitStore(res,store))) return;
    return json(res,200,{mfaRequired:false,token});
  });
  // Renomeado de /api/auth/mfa para /api/auth/mfa/verify (item 22 do escopo) — confirma o desafio
  // individual emitido no login e só então cria a sessão persistente.
  if (req.method === 'POST' && url.pathname === '/api/auth/mfa/verify') return body(req).then(async input => {
    const genericInvalid = () => json(res,401,{error:'Segundo fator inválido'});
    const challenge = (store.authChallenges || []).find(c => c.id === input.challenge);
    if (!challenge || challenge.usedAt || new Date(challenge.expiresAt).getTime() < Date.now()) return genericInvalid();
    const found = store.users.find(u => u.id === challenge.userId);
    if (!found || found.deletedAt || !found.mfaEnabled || !found.mfaSecretEncrypted) return genericInvalid();
    challenge.attempts = (challenge.attempts || 0) + 1;
    if (challenge.attempts > 5) {
      challenge.usedAt = new Date().toISOString();
      audit(store,found,'MFA_FAILURE','user',found.id,null,null,'Excesso de tentativas no desafio de segundo fator');
      await writeStore(store);
      return genericInvalid();
    }
    const secret = authCrypto.decryptSecret(found.mfaSecretEncrypted);
    if (!authCrypto.verifyTotp(secret, input.code)) {
      audit(store,found,'MFA_FAILURE','user',found.id,null,null,'Código de segundo fator incorreto');
      await writeStore(store);
      return genericInvalid();
    }
    challenge.usedAt = new Date().toISOString();
    const { token } = createSession(store,found);
    found.lastLoginAt = new Date().toISOString();
    audit(store,found,'MFA_SUCCESS','user',found.id,null,null,'Segundo fator validado');
    audit(store,found,'LOGIN_SUCCESS','user',found.id,null,null,'Login concluído após segundo fator');
    if (!(await commitStore(res,store))) return;
    return json(res,200,{token});
  });
  if (req.method === 'POST' && url.pathname === '/api/auth/register') return await body(req).then(async input => {
    const email=String(input.email||'').trim().toLowerCase(); const name=String(input.name||'').trim();
    if(!name || !/^\S+@\S+\.\S+$/.test(email)) return json(res,422,{error:'Informe nome e e-mail válidos'});
    if(store.users.some(u=>u.email.toLowerCase()===email) || store.registrationRequests.some(r=>r.email===email&&r.status==='pending')) return json(res,409,{error:'Já existe um cadastro ou solicitação para este e-mail'});
    const request={id:crypto.randomUUID(),name,email,department:input.department||'Jurídico',requestedRole:'colaborador',status:'pending',approver:'Cristiane Carneiro Rabelo',createdAt:new Date().toISOString()}; store.registrationRequests.push(request); if(!(await commitStore(res,store)))return; return json(res,201,{message:'Solicitação enviada para aprovação',request});
  });
  // Sprint 2, Hardening H2 (item 14 do escopo): fluxo de reset de senha — o token bruto só existe na
  // resposta (aqui, deliberadamente NÃO retornado ao cliente por este endpoint não ter um canal seguro
  // de entrega de e-mail neste repositório; ver docs/SECURITY.md sobre o limite de escopo assumido),
  // o banco grava só o hash (`password_reset_tokens.token_hash`), uso único (`usedAt`), com expiração.
  // Resposta sempre genérica — nunca revela se o e-mail existe.
  // Item 16 do escopo (revisão pós-PR #13): `email` não é único — nunca escolhe o primeiro registro
  // correspondente. Só emite o token quando o e-mail resolve para EXATAMENTE um usuário ativo; havendo
  // zero ou mais de um, a resposta externa é a mesma genérica (nunca revela ambiguidade nem existência).
  // O fluxo administrativo por userId (POST /api/auth/users/:id/reset-token) continua funcionando para
  // qualquer conta, mesmo com e-mail compartilhado.
  if (req.method === 'POST' && url.pathname === '/api/auth/forgot-password') return body(req).then(async input => {
    const email = String(input.email || '').toLowerCase();
    const matches = email ? store.users.filter(u => u.email.toLowerCase() === email && !u.deletedAt) : [];
    if (matches.length === 1) {
      const [found] = matches;
      issuePasswordResetToken(store, found);
      audit(store,found,'PASSWORD_RESET_REQUEST','user',found.id,null,null,'Solicitação de reset de senha');
      if (!(await commitStore(res,store))) return;
    }
    return json(res,200,{message:'Se o e-mail existir, instruções de redefinição serão enviadas.'});
  });
  if (req.method === 'POST' && url.pathname === '/api/auth/reset-password') return body(req).then(async input => {
    const genericInvalid = () => json(res,400,{error:'Token de redefinição inválido ou expirado'});
    const tokenHash = authCrypto.hashToken(String(input.token || ''));
    const record = (store.passwordResetTokens || []).find(t => t.tokenHash === tokenHash);
    if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) return genericInvalid();
    const found = store.users.find(u => u.id === record.userId);
    if (!found || found.deletedAt) return genericInvalid();
    if (!authCrypto.isPasswordAcceptable(input.newPassword)) return json(res,422,{error:`A nova senha deve ter ao menos ${authCrypto.MIN_PASSWORD_LENGTH} caracteres e não pode ser trivial`});
    record.usedAt = new Date().toISOString();
    found.passwordHash = authCrypto.hashPassword(input.newPassword);
    found.passwordChangedAt = new Date().toISOString();
    found.temporaryPassword = false;
    found.credentialsVersion = (found.credentialsVersion || 1) + 1;
    revokeAllUserSessions(store, found.id);
    audit(store,found,'PASSWORD_RESET_COMPLETE','user',found.id,null,null,'Redefinição de senha concluída via token de uso único');
    if (!(await commitStore(res,store))) return;
    return json(res,200,{message:'Senha redefinida com sucesso. Faça login novamente.'});
  });
  // Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, seção 22): nunca expõe host/usuário/senha/connection
  // string nem stack trace — só o estado observável da persistência (modo ativo, alcançável, schema pronto).
  if (req.method === 'GET' && url.pathname === '/api/health') { const persistenceHealth = await storage.healthcheck(); return json(res,200,{status:'ok',persistence:persistenceHealth.mode,databaseConfigured:Boolean(process.env.DATABASE_URL),databaseReachable:persistenceHealth.reachable,schemaReady:persistenceHealth.schemaReady,environment:process.env.NODE_ENV||'development'}); }
  const user = await getUser(req, store); if (!user) return json(res,401,{error:'Sessão inválida'});
  // Sprint 2, Hardening H2 (item 6 do escopo + bootstrapping de MFA obrigatório): enquanto a conta exige
  // configuração (senha temporária ainda não trocada, ou papel exige MFA e ele ainda não foi confirmado),
  // apenas a lista mínima de rotas de autogestão é permitida — nenhum conteúdo de negócio.
  if (accountSetupRequired(user) && !AUTH_SETUP_ALLOWED_PATHS.has(url.pathname)) {
    return json(res,403,{error:'Conclua a configuração da sua conta (troca de senha e/ou ativação do segundo fator) antes de continuar',code:'ACCOUNT_SETUP_REQUIRED'});
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') return (async () => {
    const header = req.headers.authorization; const token = header.slice(7); const tokenHash = authCrypto.hashToken(token);
    const session = (store.authSessions || []).find(s => s.tokenHash === tokenHash);
    if (session) revokeSession(session);
    audit(store,user,'LOGOUT','user',user.id,null,null,'Encerramento de sessão');
    if (!(await commitStore(res,store))) return;
    return json(res,200,{loggedOut:true});
  })();
  if (req.method === 'POST' && url.pathname === '/api/auth/logout-all') return (async () => {
    revokeAllUserSessions(store, user.id);
    audit(store,user,'LOGOUT_ALL','user',user.id,null,null,'Encerramento de todas as sessões do usuário');
    if (!(await commitStore(res,store))) return;
    return json(res,200,{loggedOut:true});
  })();
  // Revisão pós-PR #13 (docs/DECISIONS.md, PROD-H2-01): fluxo administrativo de primeiro acesso/reset —
  // sem provedor de e-mail integrado neste repositório (docs/SECURITY.md), um usuário recém-aprovado
  // (passwordHash:null, temporaryPassword:true) não tinha, até aqui, NENHUM caminho funcional para
  // definir a própria senha em produção. Um operador com a MESMA alçada já usada para aprovar cadastro
  // (`allowed(user,'*','approve')` — nunca uma nova escalada de privilégio; administrador técnico não
  // ganha alçada de negócio além da já autorizada) pode emitir um token para um userId explícito (nunca
  // por e-mail, que pode ser ambíguo). O token bruto só existe nesta resposta HTTP, uma única vez, para o
  // próprio operador autorizado entregá-lo ao usuário por um canal operacional/fora de banda nesta fase
  // (documentado como limitação — não exige integração de e-mail nesta rodada); o banco grava só o hash
  // (mesmo mecanismo/tabela de forgot-password/reset-password — `issuePasswordResetToken()`), com
  // expiração e uso único. Nunca aparece em log nem em evento de auditoria.
  if (req.method === 'POST' && /^\/api\/auth\/users\/[^/]+\/reset-token$/.test(url.pathname)) return (async () => {
    if (!allowed(user,'*','approve')) return json(res,403,{error:'Somente aprovadores podem emitir token de acesso'});
    const targetId = url.pathname.split('/')[4];
    const target = store.users.find(u => u.id === targetId);
    if (!target || target.deletedAt) return json(res,404,{error:'Usuário não encontrado'});
    const { rawToken, record } = issuePasswordResetToken(store, target);
    audit(store,user,'PASSWORD_RESET_REQUEST','user',target.id,null,null,`Token de primeiro acesso/redefinição emitido administrativamente por ${user.name}`);
    if (!(await commitStore(res,store))) return;
    return json(res,200,{token:rawToken,userId:target.id,expiresAt:record.expiresAt});
  })();
  // Item 5/6 do escopo: troca de senha autenticada — exige a senha atual, aplica a política mínima,
  // incrementa credentialsVersion (invalida sessões anteriores) e desliga temporaryPassword.
  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') return body(req).then(async input => {
    if (!user.passwordHash || !authCrypto.verifyPassword(input.currentPassword, user.passwordHash)) return json(res,401,{error:'Senha atual inválida'});
    if (!authCrypto.isPasswordAcceptable(input.newPassword)) return json(res,422,{error:`A nova senha deve ter ao menos ${authCrypto.MIN_PASSWORD_LENGTH} caracteres e não pode ser trivial`});
    if (authCrypto.verifyPassword(input.newPassword, user.passwordHash)) return json(res,422,{error:'A nova senha não pode ser igual à senha atual/temporária'});
    user.passwordHash = authCrypto.hashPassword(input.newPassword);
    user.passwordChangedAt = new Date().toISOString();
    user.temporaryPassword = false;
    user.credentialsVersion = (user.credentialsVersion || 1) + 1;
    revokeAllUserSessions(store, user.id);
    const { token } = createSession(store, user);
    audit(store,user,'PASSWORD_CHANGE','user',user.id,null,null,'Troca de senha pelo próprio usuário');
    if (!(await commitStore(res,store))) return;
    return json(res,200,{message:'Senha alterada com sucesso',token});
  });
  // Item 8-10 do escopo: enrolamento de MFA em duas etapas — gera um segredo TOTP individual (não ativa
  // MFA ainda); só `mfa/confirm` com um código válido marca `mfaEnabled:true`. O segredo cifrado nunca é
  // devolvido ao cliente depois de confirmado; durante o enrolamento (antes da confirmação), a resposta
  // devolve o segredo em texto puro apenas para o próprio usuário configurar o app autenticador — ainda
  // não há linha em app_users até a confirmação.
  if (req.method === 'POST' && url.pathname === '/api/auth/mfa/enroll') return (async () => {
    if (user.mfaEnabled) return json(res,409,{error:'MFA já está ativo para este usuário'});
    const secret = authCrypto.generateTotpSecret();
    if (!Array.isArray(store.authChallenges)) store.authChallenges = [];
    const challenge = { id: crypto.randomUUID(), userId: user.id, type: 'totp-enrollment', secretEncrypted: authCrypto.encryptSecret(secret), expiresAt: new Date(Date.now()+MFA_CHALLENGE_TTL_MS).toISOString(), usedAt: null, attempts: 0, createdAt: new Date().toISOString(), version: 1 };
    store.authChallenges.push(challenge);
    if (!(await commitStore(res,store))) return;
    return json(res,200,{enrollmentId:challenge.id,secret,otpauthUrl:authCrypto.totpProvisioningUri(secret,user.email)});
  })();
  if (req.method === 'POST' && url.pathname === '/api/auth/mfa/confirm') return body(req).then(async input => {
    const genericInvalid = () => json(res,401,{error:'Código de confirmação inválido'});
    const challenge = (store.authChallenges || []).find(c => c.id === input.enrollmentId && c.userId === user.id && c.type === 'totp-enrollment');
    if (!challenge || challenge.usedAt || new Date(challenge.expiresAt).getTime() < Date.now() || !challenge.secretEncrypted) return genericInvalid();
    challenge.attempts = (challenge.attempts || 0) + 1;
    if (challenge.attempts > 5) { challenge.usedAt = new Date().toISOString(); await writeStore(store); return genericInvalid(); }
    const secret = authCrypto.decryptSecret(challenge.secretEncrypted);
    if (!authCrypto.verifyTotp(secret, input.code)) { await writeStore(store); return genericInvalid(); }
    challenge.usedAt = new Date().toISOString();
    user.mfaEnabled = true;
    user.mfaMethod = 'totp';
    user.mfaSecretEncrypted = challenge.secretEncrypted;
    user.mfaEnrolledAt = new Date().toISOString();
    audit(store,user,'MFA_ENROLLED','user',user.id,null,null,'Segundo fator (TOTP) ativado');
    if (!(await commitStore(res,store))) return;
    return json(res,200,{mfaEnabled:true});
  });
  if (req.method === 'POST' && url.pathname === '/api/auth/mfa/disable') return body(req).then(async input => {
    if (!user.mfaEnabled) return json(res,409,{error:'MFA não está ativo para este usuário'});
    if (!user.passwordHash || !authCrypto.verifyPassword(input.password, user.passwordHash)) return json(res,401,{error:'Senha inválida'});
    user.mfaEnabled = false; user.mfaMethod = null; user.mfaSecretEncrypted = null; user.mfaEnrolledAt = null;
    audit(store,user,'MFA_DISABLED','user',user.id,null,null,'Segundo fator desativado pelo próprio usuário');
    if (!(await commitStore(res,store))) return;
    return json(res,200,{mfaEnabled:false});
  });
  // P0 corrigido (rodada 3, item 7): estas duas rotas ficavam ANTES do gate de sessão — qualquer
  // visitante sem autenticação alguma lia IDs internos de boards, nomes de boards, status de
  // configuração do Monday e, em /schedule, o histórico de sincronização com nomes de solicitantes e
  // mensagens de erro. Agora exigem sessão válida e o mesmo módulo usado para o restante do Jurídico,
  // e o payload de /schedule deixou de incluir `requestedBy`/`error` (mínimo privilégio — quem precisa
  // apenas saber que uma sincronização falhou não precisa do texto interno do erro nem de quem a pediu).
  // P0 corrigido (rodada 5, item 1): allowed() sozinho não nega um usuário de TI (que também tem o
  // módulo 'juridico' em ROLES) — allowedInDepartment() fecha isso para as rotas de Monday, que não
  // têm registro individual para scoped() filtrar.
  if (req.method === 'GET' && url.pathname === '/api/monday/status') { if(!allowedInDepartment(user,'juridico','read')) return json(res,403,{error:'Sem permissão'}); return json(res,200,{configured:Boolean(process.env.MONDAY_TOKEN), moduleCount:Object.keys(MONDAY_BOARDS).length}); }
  if (req.method === 'GET' && url.pathname === '/api/monday/schedule') { if(!allowedInDepartment(user,'juridico','read')) return json(res,403,{error:'Sem permissão'}); const lastRuns=(store.mondayRuns||[]).slice(-10).reverse().map(run=>({id:run.id,startedAt:run.startedAt,finishedAt:run.finishedAt||null,status:run.status,trigger:run.trigger||'manual',modules:(run.modules||[]).map(m=>({module:m.module,status:m.status,read:m.read,created:m.created,updated:m.updated}))})); return json(res,200,{enabled:Boolean(process.env.MONDAY_TOKEN),timezone:'America/Sao_Paulo',times:MONDAY_SYNC_TIMES,lastRuns}); }
  if (req.method === 'GET' && url.pathname === '/api/me') return json(res,200,{user:publicUser(user),permissions:ROLES[user.role],accountSetupRequired:accountSetupRequired(user)});
  if (req.method === 'GET' && url.pathname === '/api/projects') {
    if(!allowed(user,'projetos'))return json(res,403,{error:'Sem permissão para Projetos'});
    const projects=store.projects.filter(item=>!item.deletedAt&&scoped(user,item)).map(item=>projectSummary(store,item));
    return json(res,200,{count:projects.length,projects,permissions:projectPermissions(user)});
  }
  if (req.method === 'GET' && /^\/api\/projects\/[^/]+$/.test(url.pathname)) {
    if(!allowed(user,'projetos'))return json(res,403,{error:'Sem permissão para Projetos'});
    const id=url.pathname.split('/')[3],project=store.projects.find(item=>item.id===id&&!item.deletedAt);
    if(!project||!scoped(user,project))return json(res,404,{error:'Projeto não encontrado'});
    return json(res,200,{...projectDetail(store,id),permissions:projectPermissions(user)});
  }
  if (req.method === 'PATCH' && /^\/api\/projects\/[^/]+\/governance$/.test(url.pathname)) {
    // P0 corrigido (rodada 6, item 3): allowedContent() nega administrador — governança de projeto é
    // conteúdo de negócio, não função técnica de sistema/integração.
    if(!allowedContent(user,'projetos','update'))return json(res,403,{error:'Sem permissão para alterar a governança'});
    const id=url.pathname.split('/')[3],project=store.projects.find(item=>item.id===id&&!item.deletedAt);
    if(!project||!scoped(user,project))return json(res,404,{error:'Projeto não encontrado'});
    return await body(req).then(async input=>{const fields=['ownerUserId','managerUserId','sponsorUserId'],before=Object.fromEntries(fields.map(key=>[key,project[key]||null])),next={...before};for(const key of fields)if(Object.hasOwn(input,key)){if(input[key]&&!store.users.some(item=>item.id===input[key]))return json(res,422,{error:`Usuário inválido em ${key}`});next[key]=input[key]||null;}if(Object.hasOwn(input,'coOwnerUserIds')){const ids=[...new Set(input.coOwnerUserIds||[])];if(ids.some(value=>!store.users.some(item=>item.id===value)))return json(res,422,{error:'Co-responsável inválido'});project.coOwnerUserIds=ids;}Object.assign(project,next,{version:(project.version||1)+1,updatedAt:new Date().toISOString(),updatedBy:user.id});audit(store,user,'UPDATE_GOVERNANCE','projectGovernance',id,before,{...next,coOwnerUserIds:project.coOwnerUserIds},input.reason||'Alteração de responsabilidade do projeto');if(!(await commitStore(res,store)))return;return json(res,200,{...projectDetail(store,id),permissions:projectPermissions(user)})});
  }
  if (req.method === 'PUT' && /^\/api\/projects\/[^/]+\/target$/.test(url.pathname)) {
    const id=url.pathname.split('/')[3],permissions=projectPermissions(user),project=store.projects.find(item=>item.id===id&&!item.deletedAt);
    // P0 corrigido (rodada 3, item 5): faltava scoped(user,project) — `permissions.changeTarget` é
    // uma alçada do USUÁRIO (não do projeto), então qualquer papel elevado podia alterar a meta de um
    // projeto de outro departamento/escopo. Mesma correção aplicada a approval-rules, recovery-settings,
    // DELETE/restore de sub-recursos e decisão de management-items abaixo.
    if(!project||!scoped(user,project))return json(res,404,{error:'Projeto não encontrado'});
    // P0 corrigido (rodada 4, item 8): projectPermissions() não é deny-by-default para um papel
    // desconhecido em ROLES (ex.: `role:'externo'` com `department:'Jurídico'` herdava `edit`/`create`
    // por não ser 'colaborador' e por coincidência de department) — allowed(user,'projetos',...) fecha
    // essa lacuna em todas as rotas de sub-recurso que dependiam só de projectPermissions().
    if(!allowedContent(user,'projetos','update'))return json(res,403,{error:'Sem permissão para o módulo Projetos'});
    if(!permissions.changeTarget)return json(res,403,{error:'Sem permissão para alterar a meta'});
    return await body(req).then(async input=>{if(!input.indicatorId||!store.projectIndicators.some(item=>item.id===input.indicatorId&&item.projectId===id))return json(res,422,{error:'Selecione um indicador válido'});const existing=store.projectTargets.find(item=>item.id===project.targetId),before=existing?structuredClone(existing):null,target={id:existing?.id||newId('ptg'),projectId:id,indicatorId:input.indicatorId,baseline:input.baseline??null,targetValue:input.targetValue??null,dueDate:input.dueDate||null,updatedAt:new Date().toISOString(),updatedBy:user.id};if(existing)Object.assign(existing,target);else store.projectTargets.push(target);project.targetId=target.id;project.updatedAt=new Date().toISOString();audit(store,user,existing?'UPDATE_TARGET':'CREATE_TARGET','projectTarget',target.id,before,target,input.reason||'Configuração de meta do projeto');if(!(await commitStore(res,store)))return;return json(res,200,{...projectDetail(store,id),permissions})});
  }
  if (req.method === 'PUT' && /^\/api\/projects\/[^/]+\/approval-rules$/.test(url.pathname)) {
    const id=url.pathname.split('/')[3],permissions=projectPermissions(user),project=store.projects.find(item=>item.id===id&&!item.deletedAt);
    if(!project||!scoped(user,project))return json(res,404,{error:'Projeto não encontrado'});
    if(!allowedContent(user,'projetos','update'))return json(res,403,{error:'Sem permissão para o módulo Projetos'});
    if(!permissions.changeApprovalRule)return json(res,403,{error:'Sem permissão para alterar alçadas'});
    return await body(req).then(async input=>{const rule=store.projectApprovalRules.find(item=>item.projectId===id),before=structuredClone(rule);rule.levels=Array.isArray(input.levels)?input.levels:rule.levels;rule.version=(rule.version||1)+1;rule.updatedAt=new Date().toISOString();rule.updatedBy=user.id;audit(store,user,'UPDATE_APPROVAL_RULE','projectGovernance',id,before,rule,input.reason||'Alteração de alçada configurável');if(!(await commitStore(res,store)))return;return json(res,200,rule)});
  }
  if (req.method === 'PUT' && /^\/api\/projects\/[^/]+\/recovery-settings$/.test(url.pathname)) {
    const id=url.pathname.split('/')[3],permissions=projectPermissions(user),project=store.projects.find(item=>item.id===id&&!item.deletedAt),settings=store.projectRecoverySettings.find(item=>item.projectId===id);
    if(!project||!scoped(user,project))return json(res,404,{error:'Projeto não encontrado'});
    if(!allowedContent(user,'projetos','update'))return json(res,403,{error:'Sem permissão para o módulo Projetos'});
    if(!permissions.changeApprovalRule)return json(res,403,{error:'Sem permissão para alterar parâmetros de recuperação'});if(!settings)return json(res,404,{error:'Configuração não encontrada'});
    return await body(req).then(async input=>{const before=structuredClone(settings);for(const key of ['internalizationStatuses','internalizationCriteria','agingBands','honorariumPolicies'])if(Array.isArray(input[key]))settings[key]=input[key];settings.version=(settings.version||1)+1;settings.updatedAt=new Date().toISOString();settings.updatedBy=user.id;audit(store,user,'UPDATE_RECOVERY_SETTINGS','projectGovernance',id,before,settings,input.reason||'Alteração de parâmetros de recuperação');if(!(await commitStore(res,store)))return;return json(res,200,settings)});
  }
  if (req.method === 'POST' && /^\/api\/projects\/[^/]+\/(actions|milestones|risks|internalizations|negotiations|legal-treatments|management-items)$/.test(url.pathname)) {
    const [, , , id, resource]=url.pathname.split('/'),project=store.projects.find(item=>item.id===id&&!item.deletedAt),permissions=projectPermissions(user);
    if(!project||!scoped(user,project))return json(res,404,{error:'Projeto não encontrado'});
    if(!allowedContent(user,'projetos','create'))return json(res,403,{error:'Sem permissão para o módulo Projetos'});
    if(!permissions.edit)return json(res,403,{error:'Sem permissão para editar o projeto'});
    const [key,prefix]=PROJECT_RESOURCE_MAP[resource];
    return await body(req).then(async input=>{
      const sanitized=sanitizeProjectItemInput(input,user);
      if(resource==='internalizations'&&sanitized.processId){
        const invalid=validateInternalizationProcess(sanitized.processId,user,store);
        if(invalid)return json(res,invalid.status,{error:invalid.error});
      }
      const item={...sanitized,id:newId(prefix),projectId:id,status:resource==='management-items'?'Pendente':(sanitized.status||'Não iniciado'),createdAt:new Date().toISOString(),createdBy:user.id};store[key].push(item);audit(store,user,'CREATE',key,item.id,null,item,input.reason||'Registro vinculado ao projeto');if(!(await commitStore(res,store)))return;return json(res,201,item);
    });
  }
  if (req.method === 'PATCH' && /^\/api\/projects\/[^/]+\/(actions|milestones|risks|internalizations|negotiations|legal-treatments|management-items)\/[^/]+$/.test(url.pathname)) {
    const [, , , id, resource, itemId]=url.pathname.split('/'),project=store.projects.find(item=>item.id===id&&!item.deletedAt),permissions=projectPermissions(user),[key]=PROJECT_RESOURCE_MAP[resource],item=store[key].find(entry=>entry.id===itemId&&entry.projectId===id&&!entry.deletedAt);
    if(!project||!scoped(user,project)||!item)return json(res,404,{error:'Registro do projeto não encontrado'});
    if(!allowedContent(user,'projetos','update'))return json(res,403,{error:'Sem permissão para o módulo Projetos'});
    if(!permissions.edit)return json(res,403,{error:'Sem permissão para editar'});if(resource==='internalizations'&&!permissions.internalizeProcess)return json(res,403,{error:'Sem permissão para decidir internalização'});
    return await body(req).then(async input=>{const before=structuredClone(item),reason=input.reason||'Atualização de registro do projeto';delete input.reason;const sanitized=sanitizeProjectItemInput(input,user);
      if(resource==='internalizations'){
        // P0 corrigido (rodada 6, item 4): revalida sobre o ESTADO CANDIDATO (processId do input, se
        // enviado; senão o processId já gravado no item) — mesmo padrão de validateLegalDeadline() no
        // PATCH: a invariante precisa valer para o registro como ficaria após a atualização, não apenas
        // para os campos desta requisição específica.
        const candidateProcessId=Object.hasOwn(sanitized,'processId')?sanitized.processId:item.processId;
        if(candidateProcessId){
          const invalid=validateInternalizationProcess(candidateProcessId,user,store);
          if(invalid)return json(res,invalid.status,{error:invalid.error});
        }
      }
      Object.assign(item,sanitized,{updatedAt:new Date().toISOString(),updatedBy:user.id});audit(store,user,'UPDATE',key,item.id,before,item,reason);if(!(await commitStore(res,store)))return;return json(res,200,item)});
  }
  if (req.method === 'DELETE' && /^\/api\/projects\/[^/]+\/(actions|milestones|risks|internalizations|negotiations|legal-treatments|management-items)\/[^/]+$/.test(url.pathname)) {
    const [, , , id, resource, itemId]=url.pathname.split('/'),permissions=projectPermissions(user),project=store.projects.find(entry=>entry.id===id&&!entry.deletedAt),[key]=PROJECT_RESOURCE_MAP[resource],item=store[key].find(entry=>entry.id===itemId&&entry.projectId===id&&!entry.deletedAt);
    if(!project||!scoped(user,project)||!item)return json(res,404,{error:'Registro do projeto não encontrado'});
    if(!allowedContent(user,'projetos','archive'))return json(res,403,{error:'Sem permissão para o módulo Projetos'});
    if(!permissions.archive)return json(res,403,{error:'Sem permissão para excluir'});const before=structuredClone(item);item.deletedAt=new Date().toISOString();item.deletedBy=user.id;audit(store,user,'ARCHIVE',key,item.id,before,item,'Exclusão lógica de registro do projeto');if(!(await commitStore(res,store)))return;return json(res,200,{archived:true,id:item.id});
  }
  if (req.method === 'POST' && /^\/api\/projects\/[^/]+\/(actions|milestones|risks|internalizations|negotiations|legal-treatments|management-items)\/[^/]+\/restore$/.test(url.pathname)) {
    const [, , , id, resource, itemId]=url.pathname.split('/'),permissions=projectPermissions(user),project=store.projects.find(entry=>entry.id===id&&!entry.deletedAt),[key]=PROJECT_RESOURCE_MAP[resource],item=store[key].find(entry=>entry.id===itemId&&entry.projectId===id&&entry.deletedAt);
    if(!project||!scoped(user,project)||!item)return json(res,404,{error:'Registro arquivado não encontrado'});
    if(!allowedContent(user,'projetos','restore'))return json(res,403,{error:'Sem permissão para o módulo Projetos'});
    if(!permissions.restore)return json(res,403,{error:'Sem permissão para restaurar'});const before=structuredClone(item);delete item.deletedAt;delete item.deletedBy;item.updatedAt=new Date().toISOString();item.updatedBy=user.id;audit(store,user,'RESTORE',key,item.id,before,item,'Restauração de registro do projeto');if(!(await commitStore(res,store)))return;return json(res,200,item);
  }
  if (req.method === 'POST' && /^\/api\/projects\/[^/]+\/management-items\/[^/]+\/(approve|reject|escalate)$/.test(url.pathname)) {
    const parts=url.pathname.split('/'),id=parts[3],itemId=parts[5],decision=parts[6],permissions=projectPermissions(user),project=store.projects.find(entry=>entry.id===id&&!entry.deletedAt),item=store.projectManagementItems.find(entry=>entry.id===itemId&&entry.projectId===id);
    if(!project||!scoped(user,project)||!item)return json(res,404,{error:'Pendência não encontrada'});
    if(!allowedContent(user,'projetos','update'))return json(res,403,{error:'Sem permissão para o módulo Projetos'});
    if(decision!=='escalate'&&!permissions.approveAgreement)return json(res,403,{error:'Sem alçada para decidir'});
    return await body(req).then(async input=>{const before=structuredClone(item);item.status=decision==='approve'?'Aprovado':decision==='reject'?'Rejeitado':'Escalonado';item.decidedAt=new Date().toISOString();item.decidedBy=user.id;item.justification=input.reason||null;audit(store,user,decision.toUpperCase(),'projectGovernance',id,before,item,input.reason||`${decision} de pendência gerencial`);if(!(await commitStore(res,store)))return;return json(res,200,item)});
  }
  // P0 corrigido (rodada 6, item 2): a listagem tinha um filtro ad hoc próprio (com uma exceção
  // explícita `user.role === 'administrador'` que isentava o papel técnico do filtro departamental
  // inteiro) em vez de reaproveitar `dashboardAuthorized()` — a mesma função usada em
  // `GET /api/dashboards/:id` e em `/api/dashboard-preferences/:id`. Agora a listagem usa exatamente a
  // mesma regra: nenhuma divergência possível entre "o que aparece listado" e "o que é de fato acessível".
  if (req.method === 'GET' && url.pathname === '/api/dashboards') {
    const dashboards=visibleDashboards(user,allowed,hasGlobalScope).filter(item=>dashboardAuthorized(user,item));
    return json(res,200,{widgetTypes:WIDGET_TYPES,dashboards});
  }
  if (req.method === 'GET' && /^\/api\/dashboards\/[^/]+$/.test(url.pathname)) {
    const id=url.pathname.split('/')[3],definition=getDashboardDefinition(id);
    if(!definition)return json(res,404,{error:'Dashboard não encontrado'});
    if(!dashboardAuthorized(user,definition))return json(res,403,{error:'Sem permissão para este dashboard'});
    // Sprint 2, Fase 2, item 5: dashboardPayload() passa a receber user + scoped()/isLegalDeadlineOverdue()
    // para que o widget 'legal' aplique a MESMA autorização por registro usada no resto da plataforma
    // (defesa em profundidade sobre Legal Deadline + processo relacionado), em vez de confiar apenas no
    // gate de dashboardAuthorized() (que só autoriza o dashboard como um todo, não cada registro nele).
    return json(res,200,dashboardPayload(store,id,Object.fromEntries(url.searchParams),user,{scoped,isLegalDeadlineOverdue,civilDateAfterDays}));
  }
  // P0 corrigido (rodada 5, item 5): GET/PUT de preferências não validavam autorização alguma antes —
  // um usuário sem acesso a um dashboard ainda conseguia ler/gravar a própria preferência dele.
  // dashboardAuthorized() aplica a MESMA regra usada em GET /api/dashboards/:id (módulo + alçada
  // global para dashboard corporativo + departamento).
  if (req.method === 'GET' && /^\/api\/dashboard-preferences\/[^/]+$/.test(url.pathname)) {
    const dashboardId=url.pathname.split('/')[3],definition=getDashboardDefinition(dashboardId);if(!definition)return json(res,404,{error:'Dashboard não encontrado'});
    if(!dashboardAuthorized(user,definition))return json(res,403,{error:'Sem permissão para este dashboard'});
    const saved=(store.dashboardPreferences||[]).find(item=>item.userId===user.id&&item.dashboardId===dashboardId);
    return json(res,200,saved||{userId:user.id,dashboardId,hiddenWidgets:[],widgetOrder:definition.widgets.map(item=>item.id),density:'comfortable'});
  }
  if (req.method === 'PUT' && /^\/api\/dashboard-preferences\/[^/]+$/.test(url.pathname)) {
    const dashboardId=url.pathname.split('/')[3],definition=getDashboardDefinition(dashboardId);if(!definition)return json(res,404,{error:'Dashboard não encontrado'});
    if(!dashboardAuthorized(user,definition))return json(res,403,{error:'Sem permissão para este dashboard'});
    return await body(req).then(async input=>{const validIds=new Set(definition.widgets.map(item=>item.id)),preference={userId:user.id,dashboardId,hiddenWidgets:[...new Set(input.hiddenWidgets||[])].filter(id=>validIds.has(id)),widgetOrder:[...new Set(input.widgetOrder||[])].filter(id=>validIds.has(id)),density:input.density==='compact'?'compact':'comfortable',updatedAt:new Date().toISOString()};for(const id of validIds)if(!preference.widgetOrder.includes(id))preference.widgetOrder.push(id);store.dashboardPreferences=store.dashboardPreferences||[];const index=store.dashboardPreferences.findIndex(item=>item.userId===user.id&&item.dashboardId===dashboardId);if(index>=0)store.dashboardPreferences[index]=preference;else store.dashboardPreferences.push(preference);audit(store,user,'UPDATE','dashboardPreference',dashboardId,null,preference,'Personalização de dashboard');if(!(await commitStore(res,store)))return;return json(res,200,preference)});
  }
  if (req.method === 'POST' && url.pathname === '/api/monday/test') { if(!allowedInDepartment(user,'juridico','read')) return json(res,403,{error:'Sem permissão'}); return mondayQuery('{me{id name email}}').then(data=>json(res,200,{connected:true,account:data.me})).catch(error=>json(res,503,{connected:false,error:error.message})); }
  // P0 corrigido (rodada 6, item 1): allowed(user,'juridico','read') sozinho não nega um usuário de TI
  // (que também tem o módulo 'juridico' em ROLES, ver docs/PERMISSIONS.md) — allowedInDepartment()
  // fecha isso de forma transversal com as rotas de Monday da rodada 5, exigindo 403 (não apenas uma
  // listagem vazia por scoped()) para quem não é do departamento Jurídico nem tem alçada global.
  if (req.method === 'GET' && url.pathname.startsWith('/api/legal/')) { const moduleName=url.pathname.split('/')[3]; if(!allowedInDepartment(user,'juridico','read')) return json(res,403,{error:'Sem permissão para o módulo Jurídico'}); if(!LEGAL_MODULES.has(moduleName)) return json(res,404,{error:'Módulo jurídico não encontrado'}); if(moduleName==='honorariosJudiciais'){const processRows=collection(store,'processos').filter(x=>!x.deletedAt&&x.source==='monday'&&scoped(user,x));return json(res,200,{module:moduleName,...judicialHonorariumPayload(processRows)});}const rows=collection(store,moduleName).filter(x=>!x.deletedAt&&x.source==='monday'&&scoped(user,x)); if(moduleName==='processos'&&url.searchParams.get('paginated')==='1')return json(res,200,{module:moduleName,...filterProcesses(rows,url)});if(moduleName==='honorarios'&&url.searchParams.get('paginated')==='1')return json(res,200,{module:moduleName,...filterHonorariums(rows,url)});return json(res,200,{module:moduleName,count:rows.length,records:rows}); }
  if (req.method === 'POST' && url.pathname === '/api/monday/sync') { if(!allowedInDepartment(user,'juridico','create')) return json(res,403,{error:'Sem permissão para sincronizar'}); return await body(req).then(async input=>{const modules=input.modules?.length?input.modules:Object.keys(MONDAY_BOARDS);store.mondayRuns=store.mondayRuns||[];const run={id:crypto.randomUUID(),startedAt:new Date().toISOString(),requestedBy:user.name,modules:[],status:'running'};store.mondayRuns.push(run);let failed=0;for(const moduleName of modules){const board=MONDAY_BOARDS[moduleName];if(!board)continue;try{const items=await fetchMondayBoard(board.id);const list=collection(store,moduleName);let created=0,updated=0;for(const raw of items){const normalized=normalizeMondayItem(raw,moduleName,board);const existing=list.find(x=>x.source==='monday'&&x.externalId===normalized.externalId);if(existing){const before=structuredClone(existing);Object.assign(existing,normalized,{id:existing.id,version:(existing.version||1)+1});updated++;}else{list.push({...normalized,version:1});created++;}}run.modules.push({module:moduleName,board:board.name,read:items.length,created,updated,status:'ok'});}catch(error){failed++;run.modules.push({module:moduleName,board:board.name,status:'error',error:error.message});}}run.status=failed?'partial':'completed';run.finishedAt=new Date().toISOString();audit(store,user,'SYNC','monday',run.id,null,run,'Sincronização somente leitura com preservação de dados anteriores');if(!(await commitStore(res,store)))return;return json(res,failed?207:200,run);}); }
  if (req.method === 'GET' && url.pathname === '/api/auth/requests') { if(!allowed(user,'*','approve')) return json(res,403,{error:'Somente aprovadores podem consultar solicitações'}); return json(res,200,store.registrationRequests); }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/auth\/requests\/[^/]+\/approve$/)) { if(!allowed(user,'*','approve')) return json(res,403,{error:'Somente aprovadores podem aprovar'}); const id=url.pathname.split('/')[4]; const request=store.registrationRequests.find(r=>r.id===id&&r.status==='pending'); if(!request) return json(res,404,{error:'Solicitação não encontrada'}); request.status='approved';request.approvedAt=new Date().toISOString();request.approvedBy=user.name; // Sprint 2, Hardening H2 (item 27 do escopo; revisão pós-PR #13): cadastro aprovado nasce SEM
// senha/MFA utilizáveis (nenhuma credencial atribuída automaticamente) — o novo usuário só ganha acesso
// após um token de primeiro acesso definir sua própria senha individual (POST /api/auth/reset-password),
// emitido pelo fluxo administrativo (POST /api/auth/users/:id/reset-token) já que não há provedor de
// e-mail integrado nesta fase; `temporaryPassword:true` preserva a semântica pré-H2 até essa primeira
// definição. `loginIdentifier` é o próprio id técnico (único/estável) — email não é identidade de login.
const newUserId=crypto.randomUUID();
const created={id:newUserId,name:request.name,email:request.email,role:request.requestedRole,department:request.department,mfa:false,loginIdentifier:newUserId,temporaryPassword:true,passwordHash:null,credentialsVersion:1,mfaEnabled:false,mfaMethod:null,mfaSecretEncrypted:null,failedLoginCount:0,lockedUntil:null}; store.users.push(created); audit(store,user,'APPROVE','registration',id,{status:'pending'},{status:'approved',userId:created.id},'Aprovação de cadastro por responsável humano'); if(!(await commitStore(res,store)))return; return json(res,200,{approved:true,user:created}); }
  // P0 corrigido (rodada 3, item 6): a rota devolvia store.departments (com o objeto `budget` completo
  // de TODOS os departamentos) e store.agenda (de TODOS os departamentos) para qualquer usuário com
  // `allowed(user,'central')` — que é módulo comum a todos os papéis, inclusive colaborador. Um
  // colaborador do Jurídico lia o orçamento e a agenda da TI (e vice-versa). Agora filtra por escopo:
  // alçada global (diretoria/administrador) continua vendo o consolidado; os demais só o próprio
  // departamento. Não cria módulo financeiro novo — apenas aplica o mesmo escopo departamental já
  // usado em toda a plataforma.
  if (req.method === 'GET' && url.pathname === '/api/dashboard') { if (!allowed(user,'central')) return json(res,403,{error:'Sem permissão'}); const departments=visibleDepartments(store,user); const agenda=(store.agenda||[]).filter(item=>scoped(user,item)); const scopedStore={...store,departments,agenda}; return json(res,200,{metrics:metrics(scopedStore), departments, finance:departmentFinancials(scopedStore), upcoming:agenda}); }
  // P0 corrigido (rodada 7, item 2): `administrador` (modules:['*']/actions:['*']) passava em
  // `allowed(user,'*')` e recebia o evento de auditoria INTEIRO, incluindo `before`/`after` — que podem
  // conter o snapshot completo de um registro jurídico/financeiro. Isso reabria, por um atalho indireto,
  // exatamente o que a rodada 5/6 fechou diretamente (administrador não é superusuário de conteúdo).
  // sanitizeAuditEventForUser() separa AUDITORIA TÉCNICA (metadados: quem fez o quê, quando, por quê —
  // sempre visível a quem acessa /api/audit) de CONTEÚDO AUDITADO (before/after, o snapshot do registro
  // em si): só alçada de negócio global (hasGlobalScope) recebe before/after; administrador continua
  // vendo tudo o que precisa para auditoria técnica (ação, entidade, responsável, data, motivo,
  // correlationId), só não o conteúdo do registro.
  if (req.method === 'GET' && url.pathname === '/api/audit') { if (!allowed(user,'*')) return json(res,403,{error:'Sem permissão'}); return json(res,200,store.audit.slice(-100).reverse().map(event=>sanitizeAuditEventForUser(user,event))); }
  // P0 corrigido (rodada 3, item 5, depois rodada 7, item 1): GET e POST não tinham NENHUMA verificação
  // de permissão — qualquer usuário autenticado lia e criava entradas de compliance. Não existe módulo
  // `compliance` em ROLES (nem um dono de negócio definido para essa central de governança ainda — ver
  // ADR-007 em docs/DECISIONS.md); a rodada 3 restringiu a quem tivesse `allowed(user,'*',...)` — mas
  // isso inclui `administrador`, que não deveria ser autoridade de CONTEÚDO de Compliance (MASTER_HANDOFF
  // §11). Enquanto ADR-007 permanecer pendente, a política PROVISÓRIA e segura é: só alçada de negócio
  // global (`hasGlobalScope`, hoje só `diretoria`) acessa Compliance — nem administrador técnico, nem
  // papel departamental. Nenhum módulo/estrutura de Compliance foi criado ou alterado nesta rodada.
  // Mass assignment continua bloqueado: `id` deixou de poder ser sobrescrito pelo input.
  if (req.method === 'GET' && url.pathname === '/api/compliance') { if(!hasGlobalScope(user)) return json(res,403,{error:'Sem permissão'}); return json(res,200,store.compliance); }
  if (req.method === 'POST' && url.pathname === '/api/compliance') { if(!hasGlobalScope(user)) return json(res,403,{error:'Sem permissão'}); return await body(req).then(async input => { const clean={...input}; delete clean.id; delete clean.responsible; delete clean.createdAt; const entry={...clean, id:crypto.randomUUID(), ruleVersion:input.ruleVersion || 'COEVO-COMP-1.0', result:input.result || 'Pendente', responsible:user.name, createdAt:new Date().toISOString()}; store.compliance.push(entry); audit(store,user,'CREATE','compliance',entry.id,null,entry); if(!(await commitStore(res,store)))return; return json(res,201,entry); }); }
  // P0 corrigido (rodada 3, item 5): GET não era filtrado por escopo departamental (agenda de outro
  // departamento vazava — mesma classe de problema do /api/dashboard, item 6). POST tinha mass
  // assignment: `{id:crypto.randomUUID(),...input}` permitia que `input.id` vencesse o id gerado pelo
  // servidor, por vir depois no spread.
  // P0 corrigido (rodada 4, item 9): GET não tinha gate de módulo — só "estar autenticado" + escopo do
  // registro. Reaproveita o módulo 'agenda' já usado no POST, sem inventar um módulo novo.
  if (req.method === 'GET' && url.pathname === '/api/agenda') { if(!allowed(user,'agenda','read')) return json(res,403,{error:'Sem permissão'}); return json(res,200,(store.agenda||[]).filter(item=>scoped(user,item))); }
  // P0 corrigido (rodada 4, item 4): a sanitização anterior só protegia `department` — um papel
  // departamental ainda podia enviar `scopeType:'global'`, `companyId` ou `speId` e criar um item de
  // agenda global ou de outra empresa/SPE. Reaproveita sanitizeEntityInput() (mesma política de escopo
  // já usada em /api/entities e /api/committees) em vez de uma sanitização própria e divergente.
  // P0 corrigido (rodada 6, item 3): allowedContent() nega administrador (papel técnico) para a criação
  // de conteúdo de agenda — módulo de negócio, não de sistema/integração.
  if (req.method === 'POST' && url.pathname === '/api/agenda') { if (!allowedContent(user,'agenda','create')) return json(res,403,{error:'Sem permissão'}); return await body(req).then(async input=>{ const sanitized=sanitizeEntityInput(input,user); const item={...sanitized, id:crypto.randomUUID(), department: sanitized.department ?? (hasGlobalScope(user) ? null : (user.department||null))}; store.agenda.push(item); audit(store,user,'CREATE','agenda',item.id,null,item); if(!(await commitStore(res,store)))return; return json(res,201,item); }); }
  // P0 corrigido (rodada 3, item 5): GET devolvia store.departments (incluindo o objeto `budget`
  // completo) a qualquer usuário autenticado, independentemente do próprio departamento.
  // P0 corrigido (rodada 4, item 9): o objeto de departamento carrega orçamento (budget); "estar
  // autenticado" não bastava. Reaproveita o módulo 'orcamento' já existente (mesmo usado pelo
  // dashboard e pela importação de orçamento) em vez de criar um módulo novo — colaborador (que não
  // tem 'orcamento' em ROLES) deixa de conseguir ler esta rota.
  if (req.method === 'GET' && url.pathname === '/api/departments') { if(!allowed(user,'orcamento','read')) return json(res,403,{error:'Sem permissão'}); return json(res,200,visibleDepartments(store,user)); }
  // P0 corrigido (rodada 3, item 5): GET não verificava `allowed(user,'comites',...)` — um colaborador
  // (cujo papel NÃO inclui o módulo `comites` em ROLES) conseguia ler `/api/committees` mesmo sem
  // permissão de módulo, porque a rota simplesmente não tinha gate nenhum.
  // P0 corrigido (rodada 4, item 3): GET já exigia módulo 'comites' (rodada 3), mas devolvia a coleção
  // inteira — Comitê Jurídico, Comitê TI e Conselho/Governança VELKOR (quando existirem) não podem se
  // misturar. Reaproveita scoped()/sanitizeEntityInput() já usados no resto da plataforma: mesma
  // política de deny-by-default por department, e mesma proteção contra scopeType/companyId/speId
  // forjados por papel não-global.
  if (req.method === 'GET' && url.pathname === '/api/committees') { if(!allowed(user,'comites','read')) return json(res,403,{error:'Sem permissão'}); return json(res,200,store.committees.filter(item=>scoped(user,item))); }
  // P0 corrigido (rodada 6, item 3): allowedContent() nega administrador para a criação de comitê —
  // mesma classe de correção da agenda, acima.
  if (req.method === 'POST' && url.pathname === '/api/committees') { if (!allowedContent(user,'comites','create')) return json(res,403,{error:'Sem permissão'}); return await body(req).then(async input=>{ const sanitized=sanitizeEntityInput(input,user); const item={...sanitized, id:crypto.randomUUID(), status:sanitized.status||'Rascunho', createdBy:user.name, createdAt:new Date().toISOString(), department: sanitized.department ?? (hasGlobalScope(user) ? null : (user.department||null))}; store.committees.push(item); audit(store,user,'CREATE','committee',item.id,null,item); if(!(await commitStore(res,store)))return; return json(res,201,item); }); }
  // P0 corrigido (rodada 6, item 3): exportação de apresentação é conteúdo de negócio (export está na
  // lista explícita de ações que administrador não deve receber automaticamente).
  if (req.method === 'POST' && url.pathname === '/api/presentations/validate') { if (!allowedContent(user,'comites','export')) return json(res,403,{error:'Sem permissão para exportar'}); return body(req).then(input=>{ const blocked = input.audience === 'Diretoria' && input.classification === 'Compartilhável'; return json(res, blocked ? 422 : 200, blocked ? {error:'Classificação incompatível com o público Diretoria', complianceBlocked:true} : {valid:true, format:['pptx','pdf'], auditRequired:true}); }); }
  if (req.method === 'POST' && url.pathname === '/api/presentations/export') { if (!allowedContent(user,'comites','export')) return json(res,403,{error:'Sem permissão para exportar'}); return await body(req).then(async input=>{ if(input.audience === 'Diretoria' && input.classification === 'Compartilhável') return json(res,422,{error:'Classificação incompatível com o público Diretoria',complianceBlocked:true}); try { const result=await generatePresentation(input); audit(store,user,'EXPORT','presentation',result.id,null,{topics:result.topics,audience:input.audience,classification:input.classification,files:[result.pptxPath,result.pdfPath]},'Exportação validada'); if(!(await commitStore(res,store)))return; return json(res,201,result); } catch(error) { return json(res,500,{error:'Não foi possível gerar a apresentação'}); } }); }
  // P0 corrigido (item B do docs/SEGURANCA-CORRECOES.md): GET não verificava permissão de módulo,
  // permitindo que qualquer usuário autenticado lesse qualquer coleção via troca de :type na URL
  // (IDOR/BOLA — MASTER_HANDOFF §11/§26). Tipo fora de ENTITY_MODULE_MAP é negado por padrão.
  // P0 corrigido (rodada 6, item 1): allowed() sozinho não isola Jurídico x TI quando não há registro
  // prévio para scoped() filtrar (ex.: POST cria um registro novo). allowedInDepartment() aplica a
  // mesma regra departamental já usada nas rotas de Monday (rodada 5) de forma transversal ao CRUD
  // genérico de entidades — deny-by-default para módulos departamentais (juridico/ti).
  // Sprint 2, Fase 2, item 10: detalhe do Legal Deadline (id, processo relacionado, date, origin,
  // originType, status, createdAt/By, updatedAt/By, version, atraso derivado, histórico de auditoria).
  // Mesmo gate de autorização da listagem (allowedInDepartment + scoped) — nenhuma rota nova de
  // autorização foi criada. Reaproveita sanitizeAuditEventForUser() para o histórico: só quem tem
  // alçada de negócio global (hoje só diretoria) recebe before/after; administrador técnico nunca
  // chega a este ponto (scoped() já nega — sem department/alçada global, o 404 abaixo já cobre o caso).
  if (req.method === 'GET' && /^\/api\/entities\/legalDeadlines\/[^/]+\/detail$/.test(url.pathname)) {
    if (!allowedInDepartment(user,'juridico','read')) return json(res,403,{error:'Sem permissão'});
    const id = url.pathname.split('/')[4];
    // Defesa em profundidade (item 5 do plano da Fase 2, reaproveitada na Fase 3 via
    // scopedLegalDeadlineRows()): nunca expor o prazo se o processo relacionado não estiver (mais)
    // acessível ao usuário, mesmo que o registro já tenha herdado o escopo na criação/PATCH.
    const found = scopedLegalDeadlineRows(store,user).find(row => row.item.id === id);
    if (!found) return json(res,404,{error:'Registro não encontrado'});
    const { item, relatedProcess } = found;
    const history = store.audit.filter(event=>event.entity==='legalDeadlines' && event.entityId===id).sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(event=>sanitizeAuditEventForUser(user,event));
    return json(res,200,{ ...item, overdue: isLegalDeadlineOverdue(item), dataIntegrity: legalDeadlineIntegrityFlag(item), process: { id: relatedProcess.id, title: relatedProcess.title || null }, history, ...responsibleInfo(store, item), ...legalDeadlineLabels(item), confirmationLabel: legalDeadlineConfirmationLabel(legalDeadlineIntegrityFlag(item)) });
  }
  // Sprint 2, Fase 3: Agenda mínima combinando Legal Deadline (fonte canônica exclusiva de prazo
  // jurídico) e store.agenda (compromissos manuais pré-existentes) — cada fonte só entra se o usuário
  // tiver o módulo correspondente; nada é persistido, apenas montado na resposta (item 4/5 do plano).
  if (req.method === 'GET' && url.pathname === '/api/agenda-items') {
    const canReadLegal = allowedInDepartment(user,'juridico','read');
    const canReadAgenda = allowed(user,'agenda','read');
    if (!canReadLegal && !canReadAgenda) return json(res,403,{error:'Sem permissão'});
    // Sprint 2, Fase 4B (D4.15 homologada): reaproveita o mesmo padrão de parâmetro explícito já usado
    // em outras rotas do Sprint 2 (ex.: ?paginated=1) em vez de criar uma API paralela só para os itens
    // fechados — `includeInactive=1` devolve também cumprido/cancelado/suspenso nesta mesma rota.
    const includeInactive = url.searchParams.get('includeInactive') === '1';
    const items = sortAgendaItems([
      ...(canReadLegal ? legalDeadlineAgendaItems(store,user,{includeInactive}) : []),
      ...(canReadAgenda ? agendaEventItems(store,user) : [])
    ]);
    return json(res,200,{items});
  }
  // Sprint 2, Fase 4B (D4.10 homologada): "Minha Semana" é VIEW — nada é persistido aqui. Combina
  // Legal Deadline (responsibleUserId === usuário logado, dentro da semana civil corrente) com a
  // leitura somente-visualização do Google Calendar (Opção B homologada, D4.1) — Agenda Event manual
  // NÃO entra: `store.agenda` só tem `owner` em texto livre, sem um id canônico de usuário, e inferir
  // por nome seria a mesma "substituição textual" já vedada para responsibleUserId (lacuna reportada).
  if (req.method === 'GET' && url.pathname === '/api/my-week') {
    const window = civilWeekWindow();
    const legalItems = myWeekLegalDeadlineItems(store,user);
    const calendar = googleCalendarEvents(user);
    const calendarItems = filterCalendarEventsByWindow(calendar.events, window)
      .map(event => ({
        entityType: 'calendarEvent',
        externalId: event.id ?? null,
        date: event.date ?? null,
        source: 'google_calendar',
        title: event.title ?? null,
        start: event.start ?? null,
        end: event.end ?? null,
        allDay: Boolean(event.allDay),
        target: null
      }));
    const items = [...legalItems, ...calendarItems].sort((a,b)=>{
      const dateA=String(a.date||''), dateB=String(b.date||'');
      if (dateA!==dateB) return dateA.localeCompare(dateB);
      if (a.entityType!==b.entityType) return String(a.entityType).localeCompare(String(b.entityType));
      return String(a.entityId ?? a.externalId ?? '').localeCompare(String(b.entityId ?? b.externalId ?? ''));
    });
    return json(res,200,{ window, items, calendar: { configured: calendar.configured, connected: calendar.connected, status: calendar.status } });
  }
  // Sprint 2, Fase 4B (Opção B homologada, D4.1): status da integração de leitura do Google Calendar —
  // nunca devolve token/segredo, só o estado da conexão (mesmo padrão já usado para Monday em
  // /api/monday/status).
  if (req.method === 'GET' && url.pathname === '/api/calendar/status') return json(res,200, googleCalendarStatus(user));
  if (req.method === 'GET' && url.pathname === '/api/calendar/events') return json(res,200, googleCalendarEvents(user));
  // Sprint 2, Fase 3: Atenção mínima — só Legal Deadline (item 6 do plano). Categorias OVERDUE/
  // UPCOMING/REQUIRES_REVIEW são de apresentação (nunca persistidas, nunca um status novo).
  if (req.method === 'GET' && url.pathname === '/api/attention') {
    if (!allowedInDepartment(user,'juridico','read')) return json(res,403,{error:'Sem permissão'});
    const items = legalDeadlineAttentionItems(store,user);
    const summary = { overdue: items.filter(i=>i.category==='OVERDUE').length, upcoming: items.filter(i=>i.category==='UPCOMING').length, requiresReview: items.filter(i=>i.category==='REQUIRES_REVIEW').length };
    return json(res,200,{items,summary});
  }
  // Sprint 2, Fase 2, item 9: listagem/filtro de Legal Deadline reaproveita esta MESMA rota genérica
  // (`?paginated=1` opcional) em vez de criar uma arquitetura paralela — mesmo padrão já usado em
  // GET /api/legal/:module?paginated=1 (filterProcesses/filterHonorariums). O array simples (sem
  // `paginated=1`, ou para qualquer outro `type`) continua exatamente como antes, para não quebrar
  // nenhum chamador existente.
  if (req.method === 'GET' && url.pathname.startsWith('/api/entities/')) { const type=url.pathname.split('/')[3]; const module=entityModule(type); if(!module || !allowedInDepartment(user,module,'read')) return json(res,403,{error:'Sem permissão'}); let rows=collection(store,type).filter(x=>!x.deletedAt && scoped(user,x)); if(type==='legalDeadlines'){ rows=scopedLegalDeadlineRows(store,user).map(row=>row.item); if(url.searchParams.get('paginated')==='1') return json(res,200,filterLegalDeadlines(rows,url)); } return json(res,200,rows); }
  // P0 corrigido (rodada 6, itens 1 e 3): allowedContent() combina o isolamento departamental
  // (allowedInDepartment) com a negação explícita de `administrador` em módulos de CONTEÚDO de negócio
  // — sem isso, um líder de TI passava em allowed(user,'juridico','create') (item 1), e `administrador`
  // conseguia criar um registro jurídico novo sem nenhum `scoped()` prévio para barrar (item 3).
  if (req.method === 'POST' && url.pathname.startsWith('/api/entities/') && !url.pathname.endsWith('/restore')) { const type=url.pathname.split('/')[3]; const module=entityModule(type); if(!module || !allowedContent(user,module,'create')) return json(res,403,{error:'Sem permissão'}); const blocked=rejectIfMondaySourced(type); if(blocked) return json(res,403,blocked); return await body(req).then(async input=>{
    const sanitized = sanitizeEntityInput(input, user);
    if(type==='legalDeadlines'){
      for (const field of LEGAL_DEADLINE_TEXTUAL_RESPONSIBLE_FIELDS) delete sanitized[field];
      // Sprint 2, Fase 1: status é enum fechado, mas tem default server-side quando o cliente não o
      // informa na criação — 'ativo' é o único default seguro (nenhum Legal Deadline nasce suspenso/
      // cumprido/cancelado por omissão). Só o campo AUSENTE recebe o default; um valor explícito
      // (mesmo inválido) segue para validação normal, sem ser silenciosamente substituído.
      if (sanitized.status === undefined) sanitized.status = 'ativo';
      const invalid = validateLegalDeadline(sanitized, user, store);
      if(invalid) return json(res,invalid.status,{error:invalid.error});
    }
    // Campos controlados pelo servidor são atribuídos DEPOIS do input sanitizado, garantindo que
    // nenhum deles seja sobrescrito mesmo que o cliente os reenvie por outro nome/caminho.
    // Para legalDeadlines, `department` já foi definitivamente herdado do processo relacionado dentro
    // de validateLegalDeadline() — não aplicar o fallback por usuário aqui, para não sobrescrever
    // silenciosamente um `department: null` legítimo herdado do processo (rodada 4, item 7).
    const item={ ...sanitized, id:crypto.randomUUID(), version:1, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), createdBy:user.name, department: type==='legalDeadlines' ? (sanitized.department ?? null) : (sanitized.department ?? (hasGlobalScope(user) ? null : (user.department||null))) };
    collection(store,type).push(item); audit(store,user,'CREATE',type,item.id,null,item); if(!(await commitStore(res,store)))return; return json(res,201,item);
  }); }
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/entities/')) { const [, , , type, id]=url.pathname.split('/'); const module=entityModule(type); if(!module || !allowedContent(user,module,'update')) return json(res,403,{error:'Sem permissão'}); const blocked=rejectIfMondaySourced(type); if(blocked) return json(res,403,blocked); return await body(req).then(async rawInput=>{
    // Correção (revisão do PR #4): body(req) pode resolver para `null` (ex.: cliente envia o literal
    // JSON `null`) — sem essa guarda, qualquer leitura de propriedade abaixo (`input.reason` incluído)
    // derrubaria a rota com 500. `rawInput` só é tratado como objeto de fato quando for um.
    const input = rawInput && typeof rawInput === 'object' ? rawInput : {};
    const list=collection(store,type); const item=list.find(x=>x.id===id && !x.deletedAt); if(!item || !scoped(user,item)) return json(res,404,{error:'Registro não encontrado'});
    const before=structuredClone(item);
    // Sprint 2, Fase 1 (correção pós-revisão): o tratamento especial de `reason` é exclusivo de
    // legalDeadlines — para as demais entidades o comportamento permanece exatamente o anterior ao
    // PR #4 (sem extração de `reason`, audit() usa seu próprio default, nada é removido do input).
    const isLegalDeadline = type === 'legalDeadlines';
    const legalDeadlineReason = isLegalDeadline && typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : '';
    if (isLegalDeadline) delete input.reason;
    const sanitized=sanitizeEntityInput(input,user);
    // P0 corrigido (rodada 3, item 3): as invariantes de Legal Deadline precisam continuar válidas
    // após QUALQUER atualização — revalida sobre o estado CANDIDATO (item atual + input sanitizado),
    // não apenas sobre os campos enviados nesta requisição. Um PATCH que esvazia origin/date, ou troca
    // processId para um processo inexistente/fora de escopo, é rejeitado antes de qualquer gravação.
    if(isLegalDeadline){
      for (const field of LEGAL_DEADLINE_TEXTUAL_RESPONSIBLE_FIELDS) delete sanitized[field];
      // Sprint 2, Fase 4B (D4.2/D4.3, homologadas): "desatribuir" responsável (responsibleUserId
      // explicitamente null quando já havia um valor) NÃO foi homologado — só atribuição/reatribuição
      // a outro usuário. Em vez de inventar esse comportamento, o PATCH rejeita explicitamente e
      // reporta a lacuna, sem tocar em nenhum campo do registro.
      if (Object.hasOwn(sanitized, 'responsibleUserId') && sanitized.responsibleUserId === null && item.responsibleUserId != null) {
        return json(res,422,{error:'Remover o responsável (responsibleUserId nulo) não é suportado nesta fase — apenas atribuição/reatribuição a outro usuário são permitidas.'});
      }
      const candidate = { ...item, ...sanitized };
      // Correção (revisão do PR #4): reabertura (status sai de um valor diferente de 'ativo' e o PATCH
      // o leva de volta a 'ativo') exige `reason` textual não vazio — sem isso, 422 e NADA é alterado
      // (nem version, nem status, nem evento de auditoria).
      const isReopening = item.status !== 'ativo' && candidate.status === 'ativo';
      if (isReopening && !legalDeadlineReason) return json(res,422,{error:'A reabertura de um Legal Deadline exige motivo explícito (reason não pode ser vazio).'});
      const invalid = validateLegalDeadline(candidate, user, store, item.responsibleUserId ?? null);
      if(invalid) return json(res,invalid.status,{error:invalid.error});
      // validateLegalDeadline() herda department/companyId/speId/scopeType do processo relacionado
      // DENTRO de `candidate` — precisa ser copiado para `sanitized` (o que de fato é aplicado ao
      // registro abaixo) para que o PATCH também respeite a herança (rodada 4, item 7).
      sanitized.department = candidate.department; sanitized.companyId = candidate.companyId; sanitized.speId = candidate.speId; sanitized.scopeType = candidate.scopeType;
    }
    Object.assign(item,sanitized,{version:item.version+1,updatedAt:new Date().toISOString(),updatedBy:user.name});
    if (isLegalDeadline) audit(store,user,'UPDATE',type,id,before,item,legalDeadlineReason || 'Atualização de registro');
    else audit(store,user,'UPDATE',type,id,before,item);
    if(!(await commitStore(res,store)))return; return json(res,200,item);
  }); }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/entities/')) { const [, , , type, id]=url.pathname.split('/'); const module=entityModule(type); if(!module || !allowedContent(user,module,'archive')) return json(res,403,{error:'Exclusão lógica não autorizada'}); const blocked=rejectIfMondaySourced(type); if(blocked) return json(res,403,blocked); const item=collection(store,type).find(x=>x.id===id); if(!item || !scoped(user,item)) return json(res,404,{error:'Registro não encontrado'}); const before=structuredClone(item); item.deletedAt=new Date().toISOString(); item.deletedBy=user.name; audit(store,user,'ARCHIVE',type,id,before,item); if(!(await commitStore(res,store)))return; return json(res,200,{archived:true,id}); }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/entities\/[^/]+\/[^/]+\/restore$/)) { const [, , , type, id]=url.pathname.split('/'); const module=entityModule(type); if(!module || !allowedContent(user,module,'restore')) return json(res,403,{error:'Restauração não autorizada'}); const blocked=rejectIfMondaySourced(type); if(blocked) return json(res,403,blocked); const item=collection(store,type).find(x=>x.id===id); if(!item || !scoped(user,item)) return json(res,404,{error:'Registro não encontrado'}); const before=structuredClone(item); delete item.deletedAt; delete item.deletedBy; item.version++; item.updatedAt=new Date().toISOString(); audit(store,user,'RESTORE',type,id,before,item); if(!(await commitStore(res,store)))return; return json(res,200,item); }
  if (req.method === 'POST' && url.pathname === '/api/budgets/import/preview') return body(req).then(input=>json(res,200,parseCsv(input.csv)));
  // P0 corrigido (rodada 4, item 5): a importação de orçamento não checava o `department` das linhas
  // do CSV contra o escopo do usuário — um usuário departamental podia importar/alterar linhas de
  // outro departamento. Papel sem escopo global precisa ter TODAS as linhas do próprio departamento;
  // qualquer linha fora do escopo bloqueia a operação inteira (nunca importação parcial silenciosa).
  // P0 corrigido (rodada 6, item 3): importação de orçamento cria/altera conteúdo de negócio —
  // allowedContent() nega administrador, mantendo diretoria como única alçada capaz de importar
  // múltiplos departamentos de uma vez.
  if (req.method === 'POST' && url.pathname === '/api/budgets/import/commit') { if(!allowedContent(user,'orcamento','create')) return json(res,403,{error:'Sem permissão'}); return await body(req).then(async input=>{const parsed=parseCsv(input.csv); if(parsed.invalid.length || parsed.duplicates.length) return json(res,422,{error:'Importação rejeitada',...parsed}); if(!hasGlobalScope(user)){const outOfScope=parsed.valid.filter(row=>row.department!==user.department);if(outOfScope.length)return json(res,403,{error:`Importação bloqueada: ${outOfScope.length} linha(s) pertencem a departamento fora do seu escopo (${[...new Set(outOfScope.map(row=>row.department))].join(', ')})`});} const batch={id:crypto.randomUUID(),checksum:hash(input.csv),createdAt:new Date().toISOString(),createdBy:user.name,rows:parsed.valid}; store.budgetImports=(store.budgetImports||[]).filter(x=>x.checksum!==batch.checksum); store.budgetImports.push(batch); audit(store,user,'IMPORT','budget',batch.id,null,batch,'Importação validada e deduplicada'); if(!(await commitStore(res,store)))return; return json(res,201,batch); }); }
  // Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, seção 20): sob PostgreSQL, este backup continua
  // sendo apenas um SNAPSHOT cifrado sob demanda do estado atual — não é o backup canônico de produção
  // (isso é H5: agendamento, offsite, RPO/RTO). Nunca finge que este export substitui H5.
  if (req.method === 'POST' && url.pathname === '/api/backup') { if(!allowed(user,'*','approve')) return json(res,403,{error:'Backup restrito'}); try { const backup=encryptBackup(store); audit(store,user,'BACKUP','system',backup.checksum,null,{checksum:backup.checksum},'Backup cifrado'); await writeStore(store); return json(res,201,backup); } catch(error) { if(error instanceof StoreConflictError) return json(res,409,{error:error.message,code:error.code}); return json(res,503,{error:error.message}); } }
  // Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, seção 21): restaurar um backup antigo por cima do
  // runtime PostgreSQL, sem mecanismo transacional/validado de reconciliação, poderia sobrescrever dado
  // mais recente às cegas — bloqueado explicitamente em vez de arriscar uma restauração parcial/incorreta.
  if (req.method === 'POST' && url.pathname === '/api/backup/restore') { if(!allowed(user,'*','approve')) return json(res,403,{error:'Restauração restrita'}); if (storage.mode() === 'postgres') return json(res,501,{error:'RESTORE_NOT_SUPPORTED_FOR_POSTGRES',message:'Restauração direta de backup não é suportada com PostgreSQL como persistência ativa nesta fase (H1A). Ver docs/PRODUCTION_GATE.md, H5.'}); return await body(req).then(async input=>{ try { const restored=decryptBackup(input); if(!restored.users || !restored.departments || !restored.audit) return json(res,422,{error:'Backup inválido'}); audit(restored,user,'RESTORE_BACKUP','system','restore',null,{restoredAt:new Date().toISOString()},'Restauração autorizada'); await writeStore(restored); return json(res,200,{restored:true}); } catch(error) { return json(res,422,{error:'Backup inválido ou não pôde ser decifrado'}); } }); }
  return json(res,404,{error:'Rota não encontrada'});
  } catch (error) {
    if (error instanceof StoreConflictError) return json(res,409,{error:error.message,code:error.code});
    console.error('Erro de persistência não tratado:', error.message);
    return json(res,503,{error:'Persistência indisponível. Tente novamente.'});
  }
  })();
}
// Revisão pós-PR #13 (docs/DECISIONS.md, PROD-H2-01): MFA_ENCRYPTION_KEY é obrigatória em produção —
// sem ela, nenhum segredo TOTP pode ser cifrado/decifrado em repouso (authCrypto.encryptSecret()/
// decryptSecret() já falham explicitamente nesse caso), mas até esta correção essa ausência só era
// descoberta na hora de um enrolamento/validação de MFA real, em runtime, tarde demais para um operador
// perceber antes de expor o serviço. Falha explícita no BOOT, antes de escutar a porta — nunca imprime a
// chave, nunca a expõe em `GET /api/health` ou qualquer outra rota. Fora de produção, a ausência da
// chave continua degradando graciosamente (seedAuthFields()/backfillDevAuthFields() acima) — nunca
// exigida para rodar testes/desenvolvimento que não usam MFA.
// Lê `process.env.NODE_ENV` diretamente (nunca a constante `IS_PRODUCTION`, capturada uma única vez no
// carregamento do módulo) — esta função é chamada no boot real com o ambiente já definido, e também
// precisa ser testável isoladamente simulando produção/desenvolvimento sem exigir um `require('../server')`
// separado por cenário.
function validateAuthRuntimeConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!authCrypto.mfaEncryptionKey()) throw new Error('MFA_ENCRYPTION_KEY é obrigatória em produção (ausente ou com menos de 32 caracteres).');
}
// Sprint 2, Hardening H1A (docs/PRODUCTION_GATE.md, PG-22/seção 23): boot assíncrono — `storage.init()`
// aguarda a persistência estar pronta ANTES de aceitar qualquer requisição. Em produção sem
// DATABASE_URL, `storage.configure()` (acima) já lançou FailFastError antes de chegarmos aqui; se o
// Postgres estiver configurado mas inalcançável/schema incompatível, `init()` lança e o processo
// termina com código de saída ≠ 0 — nunca cai silenciosamente em modo arquivo.
if (require.main === module) {
  validateAuthRuntimeConfig();
  storage.init().then(() => {
    http.createServer((req,res)=>handler(req,res)).listen(PORT,()=>console.log(`COEVO Alta Performance disponível em http://localhost:${PORT}`));
    setInterval(()=>scheduledMondayTick().catch(error=>console.error('Monday scheduler:',error.message)),60000);
  }).catch(error => { console.error('Falha ao inicializar a persistência — processo não iniciado:', error.message); process.exit(1); });
}
module.exports = { seed, ROLES, allowed, scoped, metrics, departmentFinancials, filterProcesses, filterHonorariums, judicialHonorariumPayload, handler, readStore, writeStore, parseCsv, hash, dashboardPayload, ENTITY_MODULE_MAP, entityModule, requireMfa, LEGAL_MODULES, PROTECTED_ENTITY_FIELDS, sanitizeEntityInput, PORT, hasGlobalScope, visibleDepartments, isValidCivilDate, validateLegalDeadline, sanitizeProjectItemInput, PROTECTED_PROJECT_ITEM_FIELDS, MODULE_DEPARTMENT, allowedInDepartment, normalizeDeptSlug, dashboardAuthorized, BUSINESS_CONTENT_MODULES, allowedContent, validateInternalizationProcess, AUDIT_TECHNICAL_FIELDS, sanitizeAuditEventForUser, LEGAL_DEADLINE_ORIGIN_TYPES, LEGAL_DEADLINE_STATUSES, isLegalDeadlineOverdue, todayCivilDate, civilDateAfterDays, legalDeadlineIntegrityFlag, filterLegalDeadlines, scopedLegalDeadlineRows, legalDeadlineAgendaItems, agendaEventItems, sortAgendaItems, legalDeadlineAttentionItems, isOperationallyVisible, civilWeekWindow, responsibleInfo, myWeekLegalDeadlineItems, googleCalendarStatus, googleCalendarEvents, ORIGIN_TYPE_LABELS, STATUS_LABELS, CATEGORY_LABELS, legalDeadlineLabels, legalDeadlineConfirmationLabel, LEGAL_DEADLINE_TEXTUAL_RESPONSIBLE_FIELDS, filterCalendarEventsByWindow, canBeResponsibleForLegalDeadline, storage, migrateLegacyStore, validateAuthRuntimeConfig, resolveLoginIdentity, issuePasswordResetToken };

