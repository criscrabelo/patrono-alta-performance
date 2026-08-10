const crypto = require('node:crypto');

const PROJECT_ID = 'prj-aumento-recuperacao-credito';
const OBJECTIVE_ID = 'obj-eficiencia-recuperacao-ativos';
const MIGUEL_USER_ID = 'usr-miguel';

const WORKSTREAMS = [
  'Internalização de processos selecionados',
  'Negociação ativa com clientes',
  'Aproximação com advogados das ações',
  'Política e alçadas de parcelamento',
  'Segmentação da carteira',
  'Automação e alertas',
  'Monitoramento de acordos',
  'Análise de performance interno x externo',
  'Gestão de honorários e resultado',
  'Integração futura com Sienge'
];

const ACTION_SUGGESTIONS = [
  ['Mapear processos externos atuais', 0],
  ['Identificar carteira prioritária', 4],
  ['Definir critérios de internalização', 0],
  ['Levantar custos dos escritórios externos', 7],
  ['Criar política de parcelamento', 3],
  ['Definir alçadas', 3],
  ['Criar fluxo de negociação ativa', 1],
  ['Criar rotina de contato com advogados', 2],
  ['Criar dashboard de recuperação', 5],
  ['Criar comparação interno x externo', 7],
  ['Integrar dados financeiros', 9],
  ['Criar alertas de acordos vencidos', 6]
];

const MILESTONE_SUGGESTIONS = [
  'Mapeamento concluído',
  'Critérios aprovados',
  'Primeira carteira internalizada',
  'Política de parcelamento aprovada',
  'Primeiro ciclo de comparação concluído',
  'Integração Sienge concluída',
  'Meta intermediária atingida'
];

const INDICATORS = [
  'Carteira inadimplente', 'Valor vencido', 'Valor negociado', 'Valor recuperado no mês',
  'Valor recuperado acumulado', 'Taxa de recuperação', 'Número de acordos', 'Taxa de acordo',
  'Acordos adimplentes', 'Acordos rompidos', 'Tempo médio até acordo', 'Tempo médio até recebimento',
  'Processos internalizados', '% de processos internalizados', 'Valor recuperado interno',
  'Valor recuperado externo', 'Taxa de recuperação interna', 'Taxa de recuperação externa',
  'Custo da recuperação interna', 'Custo da recuperação externa', 'Custo por R$ recuperado',
  'Honorários gerados', 'Honorários recebidos', 'Resultado líquido'
];

function ensureArray(store, key) {
  if (!Array.isArray(store[key])) store[key] = [];
  return store[key];
}

function ensureProjectStore(store) {
  let changed = false;
  if (!store.users.some(user => user.id === MIGUEL_USER_ID)) {
    store.users.push({ id: MIGUEL_USER_ID, name: 'Miguel', email: 'miguel@coevo.local', role: 'colaborador', department: 'Jurídico', mfa: false, active: true, profileStatus: 'Cadastro interno de homologação' });
    changed = true;
  }
  const keys = ['projects','strategicObjectives','projectWorkstreams','projectActions','projectMilestones','projectRisks','projectIndicators','projectTargets','recoveryCases','recoveryNegotiations','legalNegotiationHistory','projectApprovalRules','projectManagementItems','projectAssignments','projectRecoverySettings'];
  for (const key of keys) if (!Array.isArray(store[key])) { store[key] = []; changed = true; }

  if (!store.strategicObjectives.some(item => item.id === OBJECTIVE_ID)) {
    store.strategicObjectives.push({ id: OBJECTIVE_ID, title: 'Aumentar eficiência financeira e recuperação de ativos', departmentId: 'dep-juridico', editable: true, status: 'Ativo' });
    changed = true;
  }
  if (!store.projects.some(item => item.id === PROJECT_ID)) {
    store.projects.push({
      id: PROJECT_ID,
      slug: 'aumento-da-recuperacao-de-credito',
      name: 'Aumento da Recuperação de Crédito',
      departmentId: 'dep-juridico', department: 'Jurídico', category: 'Estratégico',
      objectiveId: OBJECTIVE_ID,
      objective: 'Aumentar a efetividade, velocidade e previsibilidade da recuperação de crédito de clientes inadimplentes, com maior controle interno sobre negociações, parcelamentos, estratégia processual e tomada de decisão.',
      ownerUserId: MIGUEL_USER_ID, coOwnerUserIds: [], managerUserId: 'usr-diretoria', sponsorUserId: null,
      status: 'Planejamento', progress: null, targetId: null, nextMilestoneId: null,
      sourceLinks: { processCollection: 'records.processos', extrajudicialHonorariumCollection: 'records.honorarios', futureRecoveryCollection: 'recoveryCases', futureFinancialSource: 'Sienge' },
      version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    changed = true;
  }
  if (!store.projectWorkstreams.some(item => item.projectId === PROJECT_ID)) {
    WORKSTREAMS.forEach((title, index) => store.projectWorkstreams.push({ id: `pws-${index + 1}`, projectId: PROJECT_ID, title, ownerUserId: null, status: 'Não iniciada', dueDate: null, progress: null, notes: null }));
    changed = true;
  }
  if (!store.projectActions.some(item => item.projectId === PROJECT_ID)) {
    ACTION_SUGGESTIONS.forEach(([title, workstreamIndex], index) => store.projectActions.push({ id: `pac-${index + 1}`, projectId: PROJECT_ID, workstreamId: `pws-${workstreamIndex + 1}`, title, ownerUserId: null, departmentId: 'dep-juridico', startDate: null, dueDate: null, status: 'Sugerida', priority: null, progress: null, indicatorId: null, dependencyId: null, notes: 'Sugestão inicial; requer validação antes do início.' }));
    changed = true;
  }
  if (!store.projectMilestones.some(item => item.projectId === PROJECT_ID)) {
    MILESTONE_SUGGESTIONS.forEach((title, index) => store.projectMilestones.push({ id: `pms-${index + 1}`, projectId: PROJECT_ID, title, targetDate: null, completedDate: null, status: 'Sugerido', ownerUserId: null, expectedResult: null }));
    changed = true;
  }
  if (!store.projectIndicators.some(item => item.projectId === PROJECT_ID)) {
    INDICATORS.forEach((name, index) => store.projectIndicators.push({ id: `pki-${index + 1}`, projectId: PROJECT_ID, name, value: null, unit: name.includes('Taxa') || name.startsWith('%') ? 'percent' : name.includes('Valor') || name.includes('Custo') || name.includes('Honorários') || name.includes('Resultado') || name === 'Carteira inadimplente' ? 'currency' : 'number', source: null, status: 'Aguardando integração', calculatedAt: null }));
    changed = true;
  }
  if (!store.projectApprovalRules.some(item => item.projectId === PROJECT_ID)) {
    store.projectApprovalRules.push({ id: 'par-recovery-default', projectId: PROJECT_ID, name: 'Alçadas de negociação', active: true, version: 1, levels: [], parameters: { debtRange: true, maximumDiscount: true, minimumDownPayment: true, maximumInstallments: true }, note: 'Sem limites financeiros cadastrados. A gestão deve configurar as faixas antes das aprovações.' });
    changed = true;
  }
  if (!store.projectRecoverySettings.some(item => item.projectId === PROJECT_ID)) {
    store.projectRecoverySettings.push({
      id: 'prs-recovery-default', projectId: PROJECT_ID, version: 1,
      internalizationStatuses: ['Externo','Em análise para internalização','Aprovado para internalização','Em transição','Internalizado','Manter externo'],
      internalizationCriteria: ['Valor da dívida','Idade da dívida','Estágio processual','Probabilidade de acordo','Histórico do cliente','Empreendimento','Custo do escritório externo','Possibilidade de negociação direta'].map(name=>({name,active:true,weight:null})),
      agingBands: [{label:'1–30 dias',min:1,max:30},{label:'31–60',min:31,max:60},{label:'61–90',min:61,max:90},{label:'91–120',min:91,max:120},{label:'121–180',min:121,max:180},{label:'+180 dias',min:181,max:null}],
      honorariumPolicies: [
        {kind:'Extrajudicial',basis:'Valor recuperado',rate:10,distribution:[{beneficiary:'Prevotica',rate:60},{beneficiary:'Advogados',rate:40}]},
        {kind:'Judicial',basis:'Honorários recebidos',rate:null,distribution:[{beneficiary:'Partes da regra',rate:50},{beneficiary:'Advogados',rate:50}]},
        {kind:'Recompra',basis:'Lucro',rate:null,distribution:[{beneficiary:'Advogados',rate:10}]}
      ],
      note: 'Parâmetros centralizados e editáveis; não executam decisões automaticamente.'
    });
    changed = true;
  }
  return changed;
}

function userView(store, id) {
  if (!id) return null;
  const user = store.users.find(item => item.id === id);
  return user ? { id: user.id, name: user.name, role: user.role, department: user.department } : { id, name: 'Usuário não encontrado' };
}

function projectProgress(actions) {
  const tracked = actions.filter(item => Number.isFinite(Number(item.progress)));
  return tracked.length ? tracked.reduce((sum, item) => sum + Number(item.progress), 0) / tracked.length : null;
}

function projectSummary(store, project) {
  const actions = store.projectActions.filter(item => item.projectId === project.id && !item.deletedAt);
  const milestones = store.projectMilestones.filter(item => item.projectId === project.id && !item.deletedAt);
  const dated = milestones.filter(item => item.targetDate && item.status !== 'Concluído').sort((a,b) => String(a.targetDate).localeCompare(String(b.targetDate)));
  const nextMilestone = milestones.find(item => item.id === project.nextMilestoneId) || dated[0] || null;
  const target = store.projectTargets.find(item => item.id === project.targetId) || null;
  const risks = store.projectRisks.filter(item => item.projectId === project.id && !item.deletedAt && item.status !== 'Encerrado');
  const managementPending = store.projectManagementItems.filter(item => item.projectId === project.id && !item.deletedAt && item.status === 'Pendente');
  return { ...project, owner: userView(store, project.ownerUserId), coOwners: project.coOwnerUserIds.map(id => userView(store,id)), manager: userView(store, project.managerUserId), sponsor: userView(store, project.sponsorUserId), target, progress: projectProgress(actions), nextMilestone, riskCount: risks.length, managementPendingCount: managementPending.length };
}

function projectDetail(store, projectId) {
  const project = store.projects.find(item => item.id === projectId);
  if (!project) return null;
  const byProject = key => store[key].filter(item => item.projectId === projectId && !item.deletedAt);
  const indicators = byProject('projectIndicators');
  const sourceRecords = store.records || {};
  return {
    project: projectSummary(store, project),
    strategicObjective: store.strategicObjectives.find(item => item.id === project.objectiveId) || null,
    workstreams: byProject('projectWorkstreams'), actions: byProject('projectActions'), milestones: byProject('projectMilestones'), risks: byProject('projectRisks'), indicators,
    target: store.projectTargets.find(item => item.id === project.targetId) || null,
    approvalRules: byProject('projectApprovalRules'), recoverySettings: byProject('projectRecoverySettings')[0] || null, managementItems: byProject('projectManagementItems').filter(item => item.status === 'Pendente'),
    internalizations: byProject('recoveryCases'), negotiations: byProject('recoveryNegotiations'), legalTreatments: byProject('legalNegotiationHistory'),
    responsibilityHistory: store.audit.filter(item => item.entity === 'projectGovernance' && item.entityId === projectId).slice(-50).reverse(),
    sourceReadiness: {
      processes: { records: (sourceRecords.processos || []).filter(item => !item.deletedAt).length, status: 'Disponível para vinculação; nenhum processo é classificado automaticamente como recuperação.' },
      extrajudicialHonorariums: { records: (sourceRecords.honorarios || []).filter(item => !item.deletedAt).length, status: 'Disponível para relacionamento por identificador.' },
      sienge: { records: 0, status: 'Aguardando integração financeira.' }, recovery: { records: byProject('recoveryCases').length, status: byProject('recoveryCases').length ? 'Dados cadastrados' : 'Dados ainda não disponíveis' }
    },
    chartSeries: { monthlyRecovery: [], internalVsExternal: [], aging: [], funnel: [], byEnterprise: [] }
  };
}

function projectPermissions(user) {
  const elevated = ['diretoria','administrador'].includes(user.role);
  const manager = user.id === 'usr-diretoria';
  return {
    view: true, create: user.role !== 'colaborador' || user.department === 'Jurídico', edit: elevated || user.department === 'Jurídico',
    approveAgreement: elevated, changeApprovalRule: elevated, internalizeProcess: elevated || user.role === 'lider', changeTarget: elevated || manager,
    export: user.role !== 'colaborador', archive: elevated, restore: elevated
  };
}

function newId(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

module.exports = { PROJECT_ID, ensureProjectStore, projectSummary, projectDetail, projectPermissions, userView, newId };
