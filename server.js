const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { generatePresentation } = require('./presentation-export');
const { WIDGET_TYPES, getDashboardDefinition, visibleDashboards } = require('./dashboard-model');
const { dashboardPayload } = require('./dashboard-service');
const { PROJECT_ID, ensureProjectStore, projectSummary, projectDetail, projectPermissions, newId } = require('./project-service');

const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const PORT = Number(process.env.PORT || 3007);
const sessions = new Map();
const BACKUP_KEY = process.env.COEVO_BACKUP_KEY;
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
const PROJECT_RESOURCE_MAP={actions:['projectActions','pac'],milestones:['projectMilestones','pms'],risks:['projectRisks','prk'],internalizations:['recoveryCases','rca'],negotiations:['recoveryNegotiations','rng'],'legal-treatments':['legalNegotiationHistory','lth'],'management-items':['projectManagementItems','pmi']};
const ROLES = {
  diretoria: { modules: ['*'], scopes: ['*'], actions: ['read','create','update','archive','restore','approve','export'] },
  administrador: { modules: ['*'], scopes: ['*'], actions: ['*'] },
  lider: { modules: ['central','estrategia','projetos','agenda','comites','orcamento','juridico','ti'], scopes: ['department'], actions: ['read','create','update','archive','export'] },
  colaborador: { modules: ['central','projetos','agenda','juridico','ti'], scopes: ['department'], actions: ['read','create','update'] }
};
const seed = {
  users: [
    { id: 'usr-diretoria', name: 'Cristiane Carneiro Rabelo', email: 'juridico@coevoconstrutora.com.br', role: 'diretoria', department: null, mfa: true },
    { id: 'usr-juridico', name: 'Líder Jurídico', email: 'juridico@coevoconstrutora.com.br', role: 'lider', department: 'Jurídico', mfa: true },
    { id: 'usr-ti', name: 'Líder de Tecnologia', email: 'ti@coevo.local', role: 'lider', department: 'TI', mfa: true }
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
function ensureStore() { fs.mkdirSync(DATA_DIR, { recursive: true }); if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2)); const store=JSON.parse(fs.readFileSync(DB_FILE,'utf8')); let changed=false;for(const department of store.departments||[]){if(!department.source){department.source=seed.departments.find(item=>item.id===department.id)?.source||'Origem não informada';changed=true}else if(department.source.includes('Patrono')){department.source=department.source.replace(/Patrono/g,'COEVO');changed=true}}if(!Array.isArray(store.financials)||store.financials.length!==(store.departments||[]).length){store.financials=departmentFinancials(store);changed=true}else for(const finance of store.financials){if(typeof finance.source==='string'&&finance.source.includes('Patrono')){finance.source=finance.source.replace(/Patrono/g,'COEVO');changed=true}}if(!Array.isArray(store.dashboardPreferences)){store.dashboardPreferences=[];changed=true}if(ensureProjectStore(store))changed=true;if(changed)fs.writeFileSync(DB_FILE,JSON.stringify(store,null,2)); }
function readStore() { ensureStore(); return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function writeStore(store) { fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2)); }
function audit(store, user, action, entity, entityId, before, after, reason = 'Operação solicitada pelo usuário') {
  store.audit.push({ id: crypto.randomUUID(), action, entity, entityId, responsible: user.name, date: new Date().toISOString(), reason, before, after, correlationId: crypto.randomUUID() });
}
function allowed(user, module, action = 'read') {
  const policy = ROLES[user.role];
  return !!policy && (policy.modules.includes('*') || policy.modules.includes(module)) && (policy.actions.includes('*') || policy.actions.includes(action));
}
function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); }
function getUser(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const session = sessions.get(token);
  if (session && !session.challenge && session.expiresAt > Date.now()) return readStore().users.find(u => u.id === session.userId) || null;
  return null;
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
function requireMfa(user) { return user.mfa && (user.role === 'diretoria' || user.role === 'administrador' || user.role === 'lider'); }
function scoped(user, item) { return user.role === 'diretoria' || user.role === 'administrador' || !item.department || item.department === user.department; }
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
function normalizeMondayItem(item,module,board){const columns=Object.fromEntries((item.column_values||[]).map(c=>[c.id,c.text]));const columnsByTitle=Object.fromEntries((item.column_values||[]).map(c=>[item.column_titles?.[c.id]||c.id,c.text]));return {id:crypto.randomUUID(),source:'monday',externalId:String(item.id),module,boardId:board.id,boardName:board.name,title:item.name,group:item.group?.title||null,columns,columnsByTitle,createdAt:item.created_at||null,syncedAt:new Date().toISOString(),classification:'Interno',deletedAt:null};}
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
async function scheduledMondayTick(){if(!process.env.MONDAY_TOKEN)return;const store=readStore();const due=scheduleDueNow();if(!due)return;const date=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});if((store.mondayRuns||[]).some(r=>r.trigger==='scheduled'&&r.scheduleTime===due&&String(r.startedAt).startsWith(date)))return;const run=await runMondaySync(store,'Agendador COEVO');run.trigger='scheduled';run.scheduleTime=due;audit(store,{name:'Agendador COEVO'},'SYNC_SCHEDULED','monday',run.id,null,run,'Sincronização automática programada');writeStore(store);}

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
  if (req.method === 'GET' && ['/app.js','/dashboard-widgets.js','/styles.css','/sidebar.css','/dashboard.css','/dashboard-widgets.css','/processes.css','/projects.css','/committee.css'].includes(url.pathname)) return staticFile(res, path.join(ROOT, 'public', path.basename(url.pathname)));
  if (req.method === 'GET' && /^\/logo-coevo[^/]*\.png$/.test(url.pathname)) { const file = path.join(ROOT, 'public', path.basename(url.pathname)); if (fs.existsSync(file)) return staticFile(res, file); return json(res,404,{error:'Não encontrado'}); }
  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) { const file = path.join(ROOT, url.pathname); if (fs.existsSync(file)) return staticFile(res, file); return json(res,404,{error:'Não encontrado'}); }
  if (!url.pathname.startsWith('/api/')) return json(res,404,{error:'Não encontrado'});
  const store = readStore();
  const module = url.pathname.split('/')[2];
  if (req.method === 'POST' && url.pathname === '/api/auth/login') return body(req).then(input => {
    const found = store.users.find(u => u.email.toLowerCase() === String(input.email || '').toLowerCase());
    const configured = process.env.COEVO_DEMO_PASSWORD;
    if (!found || !configured || hash(input.password) !== hash(configured)) return json(res,401,{error:'Credenciais inválidas'});
    if (!requireMfa(found)) { const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{userId:found.id,expiresAt:Date.now()+Number(process.env.COEVO_SESSION_MS||3600000)}); return json(res,200,{mfaRequired:false,token}); }
    const challenge = crypto.randomUUID(); sessions.set(challenge,{userId:found.id,challenge:true,expiresAt:Date.now()+300000});
    return json(res,200,{mfaRequired:true,challenge,maskedPhone:'final ****'});
  });
  if (req.method === 'POST' && url.pathname === '/api/auth/mfa') return body(req).then(input => {
    const pending=sessions.get(input.challenge); const expected=process.env.COEVO_MFA_CODE;
    if(!pending || !pending.challenge || !expected || String(input.code)!==String(expected)) return json(res,401,{error:'Segundo fator inválido'});
    const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{userId:pending.userId,expiresAt:Date.now()+Number(process.env.COEVO_SESSION_MS||3600000)}); sessions.delete(input.challenge); return json(res,200,{token});
  });
  if (req.method === 'POST' && url.pathname === '/api/auth/register') return body(req).then(input => {
    const email=String(input.email||'').trim().toLowerCase(); const name=String(input.name||'').trim();
    if(!name || !/^\S+@\S+\.\S+$/.test(email)) return json(res,422,{error:'Informe nome e e-mail válidos'});
    if(store.users.some(u=>u.email.toLowerCase()===email) || store.registrationRequests.some(r=>r.email===email&&r.status==='pending')) return json(res,409,{error:'Já existe um cadastro ou solicitação para este e-mail'});
    const request={id:crypto.randomUUID(),name,email,department:input.department||'Jurídico',requestedRole:'colaborador',status:'pending',approver:'Cristiane Carneiro Rabelo',createdAt:new Date().toISOString()}; store.registrationRequests.push(request); writeStore(store); return json(res,201,{message:'Solicitação enviada para aprovação',request});
  });
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res,200,{status:'ok',persistence:'local-fallback',databaseConfigured:Boolean(process.env.DATABASE_URL),databaseMigrationReady:true,environment:process.env.NODE_ENV||'development'});
  if (req.method === 'GET' && url.pathname === '/api/monday/status') return json(res,200,{configured:Boolean(process.env.MONDAY_TOKEN),boards:Object.entries(MONDAY_BOARDS).map(([module,b])=>({module,...b}))});
  if (req.method === 'GET' && url.pathname === '/api/monday/schedule') return json(res,200,{enabled:Boolean(process.env.MONDAY_TOKEN),timezone:'America/Sao_Paulo',times:MONDAY_SYNC_TIMES,lastRuns:(store.mondayRuns||[]).slice(-10).reverse()});
  const user = getUser(req); if (!user) return json(res,401,{error:'Sessão inválida'});
  if (req.method === 'GET' && url.pathname === '/api/me') return json(res,200,{user,permissions:ROLES[user.role]});
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
    if(!allowed(user,'projetos','update'))return json(res,403,{error:'Sem permissão para alterar a governança'});
    const id=url.pathname.split('/')[3],project=store.projects.find(item=>item.id===id&&!item.deletedAt);
    if(!project||!scoped(user,project))return json(res,404,{error:'Projeto não encontrado'});
    return body(req).then(input=>{const fields=['ownerUserId','managerUserId','sponsorUserId'],before=Object.fromEntries(fields.map(key=>[key,project[key]||null])),next={...before};for(const key of fields)if(Object.hasOwn(input,key)){if(input[key]&&!store.users.some(item=>item.id===input[key]))return json(res,422,{error:`Usuário inválido em ${key}`});next[key]=input[key]||null;}if(Object.hasOwn(input,'coOwnerUserIds')){const ids=[...new Set(input.coOwnerUserIds||[])];if(ids.some(value=>!store.users.some(item=>item.id===value)))return json(res,422,{error:'Co-responsável inválido'});project.coOwnerUserIds=ids;}Object.assign(project,next,{version:(project.version||1)+1,updatedAt:new Date().toISOString(),updatedBy:user.id});audit(store,user,'UPDATE_GOVERNANCE','projectGovernance',id,before,{...next,coOwnerUserIds:project.coOwnerUserIds},input.reason||'Alteração de responsabilidade do projeto');writeStore(store);return json(res,200,{...projectDetail(store,id),permissions:projectPermissions(user)})});
  }
  if (req.method === 'PUT' && /^\/api\/projects\/[^/]+\/target$/.test(url.pathname)) {
    const id=url.pathname.split('/')[3],permissions=projectPermissions(user),project=store.projects.find(item=>item.id===id&&!item.deletedAt);
    if(!permissions.changeTarget)return json(res,403,{error:'Sem permissão para alterar a meta'});if(!project)return json(res,404,{error:'Projeto não encontrado'});
    return body(req).then(input=>{if(!input.indicatorId||!store.projectIndicators.some(item=>item.id===input.indicatorId&&item.projectId===id))return json(res,422,{error:'Selecione um indicador válido'});const existing=store.projectTargets.find(item=>item.id===project.targetId),before=existing?structuredClone(existing):null,target={id:existing?.id||newId('ptg'),projectId:id,indicatorId:input.indicatorId,baseline:input.baseline??null,targetValue:input.targetValue??null,dueDate:input.dueDate||null,updatedAt:new Date().toISOString(),updatedBy:user.id};if(existing)Object.assign(existing,target);else store.projectTargets.push(target);project.targetId=target.id;project.updatedAt=new Date().toISOString();audit(store,user,existing?'UPDATE_TARGET':'CREATE_TARGET','projectTarget',target.id,before,target,input.reason||'Configuração de meta do projeto');writeStore(store);return json(res,200,{...projectDetail(store,id),permissions})});
  }
  if (req.method === 'PUT' && /^\/api\/projects\/[^/]+\/approval-rules$/.test(url.pathname)) {
    const id=url.pathname.split('/')[3],permissions=projectPermissions(user),project=store.projects.find(item=>item.id===id&&!item.deletedAt);
    if(!permissions.changeApprovalRule)return json(res,403,{error:'Sem permissão para alterar alçadas'});if(!project)return json(res,404,{error:'Projeto não encontrado'});
    return body(req).then(input=>{const rule=store.projectApprovalRules.find(item=>item.projectId===id),before=structuredClone(rule);rule.levels=Array.isArray(input.levels)?input.levels:rule.levels;rule.version=(rule.version||1)+1;rule.updatedAt=new Date().toISOString();rule.updatedBy=user.id;audit(store,user,'UPDATE_APPROVAL_RULE','projectGovernance',id,before,rule,input.reason||'Alteração de alçada configurável');writeStore(store);return json(res,200,rule)});
  }
  if (req.method === 'PUT' && /^\/api\/projects\/[^/]+\/recovery-settings$/.test(url.pathname)) {
    const id=url.pathname.split('/')[3],permissions=projectPermissions(user),settings=store.projectRecoverySettings.find(item=>item.projectId===id);
    if(!permissions.changeApprovalRule)return json(res,403,{error:'Sem permissão para alterar parâmetros de recuperação'});if(!settings)return json(res,404,{error:'Configuração não encontrada'});
    return body(req).then(input=>{const before=structuredClone(settings);for(const key of ['internalizationStatuses','internalizationCriteria','agingBands','honorariumPolicies'])if(Array.isArray(input[key]))settings[key]=input[key];settings.version=(settings.version||1)+1;settings.updatedAt=new Date().toISOString();settings.updatedBy=user.id;audit(store,user,'UPDATE_RECOVERY_SETTINGS','projectGovernance',id,before,settings,input.reason||'Alteração de parâmetros de recuperação');writeStore(store);return json(res,200,settings)});
  }
  if (req.method === 'POST' && /^\/api\/projects\/[^/]+\/(actions|milestones|risks|internalizations|negotiations|legal-treatments|management-items)$/.test(url.pathname)) {
    const [, , , id, resource]=url.pathname.split('/'),project=store.projects.find(item=>item.id===id&&!item.deletedAt),permissions=projectPermissions(user);
    if(!project||!scoped(user,project))return json(res,404,{error:'Projeto não encontrado'});if(!permissions.edit)return json(res,403,{error:'Sem permissão para editar o projeto'});
    const [key,prefix]=PROJECT_RESOURCE_MAP[resource];
    return body(req).then(input=>{if(resource==='internalizations'&&input.processId&&!collection(store,'processos').some(item=>item.id===input.processId))return json(res,422,{error:'Processo relacionado não encontrado'});const item={id:newId(prefix),projectId:id,status:resource==='management-items'?'Pendente':input.status||'Não iniciado',createdAt:new Date().toISOString(),createdBy:user.id,...input};store[key].push(item);audit(store,user,'CREATE',key,item.id,null,item,input.reason||'Registro vinculado ao projeto');writeStore(store);return json(res,201,item)});
  }
  if (req.method === 'PATCH' && /^\/api\/projects\/[^/]+\/(actions|milestones|risks|internalizations|negotiations|legal-treatments|management-items)\/[^/]+$/.test(url.pathname)) {
    const [, , , id, resource, itemId]=url.pathname.split('/'),project=store.projects.find(item=>item.id===id&&!item.deletedAt),permissions=projectPermissions(user),[key]=PROJECT_RESOURCE_MAP[resource],item=store[key].find(entry=>entry.id===itemId&&entry.projectId===id&&!entry.deletedAt);
    if(!project||!scoped(user,project)||!item)return json(res,404,{error:'Registro do projeto não encontrado'});if(!permissions.edit)return json(res,403,{error:'Sem permissão para editar'});if(resource==='internalizations'&&!permissions.internalizeProcess)return json(res,403,{error:'Sem permissão para decidir internalização'});
    return body(req).then(input=>{const before=structuredClone(item),reason=input.reason||'Atualização de registro do projeto';for(const field of ['id','projectId','createdAt','createdBy','deletedAt','deletedBy','reason'])delete input[field];Object.assign(item,input,{updatedAt:new Date().toISOString(),updatedBy:user.id});audit(store,user,'UPDATE',key,item.id,before,item,reason);writeStore(store);return json(res,200,item)});
  }
  if (req.method === 'DELETE' && /^\/api\/projects\/[^/]+\/(actions|milestones|risks|internalizations|negotiations|legal-treatments|management-items)\/[^/]+$/.test(url.pathname)) {
    const [, , , id, resource, itemId]=url.pathname.split('/'),permissions=projectPermissions(user),[key]=PROJECT_RESOURCE_MAP[resource],item=store[key].find(entry=>entry.id===itemId&&entry.projectId===id&&!entry.deletedAt);
    if(!item)return json(res,404,{error:'Registro do projeto não encontrado'});if(!permissions.archive)return json(res,403,{error:'Sem permissão para excluir'});const before=structuredClone(item);item.deletedAt=new Date().toISOString();item.deletedBy=user.id;audit(store,user,'ARCHIVE',key,item.id,before,item,'Exclusão lógica de registro do projeto');writeStore(store);return json(res,200,{archived:true,id:item.id});
  }
  if (req.method === 'POST' && /^\/api\/projects\/[^/]+\/(actions|milestones|risks|internalizations|negotiations|legal-treatments|management-items)\/[^/]+\/restore$/.test(url.pathname)) {
    const [, , , id, resource, itemId]=url.pathname.split('/'),permissions=projectPermissions(user),[key]=PROJECT_RESOURCE_MAP[resource],item=store[key].find(entry=>entry.id===itemId&&entry.projectId===id&&entry.deletedAt);
    if(!item)return json(res,404,{error:'Registro arquivado não encontrado'});if(!permissions.restore)return json(res,403,{error:'Sem permissão para restaurar'});const before=structuredClone(item);delete item.deletedAt;delete item.deletedBy;item.updatedAt=new Date().toISOString();item.updatedBy=user.id;audit(store,user,'RESTORE',key,item.id,before,item,'Restauração de registro do projeto');writeStore(store);return json(res,200,item);
  }
  if (req.method === 'POST' && /^\/api\/projects\/[^/]+\/management-items\/[^/]+\/(approve|reject|escalate)$/.test(url.pathname)) {
    const parts=url.pathname.split('/'),id=parts[3],itemId=parts[5],decision=parts[6],permissions=projectPermissions(user),item=store.projectManagementItems.find(entry=>entry.id===itemId&&entry.projectId===id);
    if(!item)return json(res,404,{error:'Pendência não encontrada'});if(decision!=='escalate'&&!permissions.approveAgreement)return json(res,403,{error:'Sem alçada para decidir'});
    return body(req).then(input=>{const before=structuredClone(item);item.status=decision==='approve'?'Aprovado':decision==='reject'?'Rejeitado':'Escalonado';item.decidedAt=new Date().toISOString();item.decidedBy=user.id;item.justification=input.reason||null;audit(store,user,decision.toUpperCase(),'projectGovernance',id,before,item,input.reason||`${decision} de pendência gerencial`);writeStore(store);return json(res,200,item)});
  }
  if (req.method === 'GET' && url.pathname === '/api/dashboards') {
    const dashboards=visibleDashboards(user,allowed).filter(item=>!user.department||user.role==='diretoria'||user.role==='administrador'||!item.departmentId||item.departmentId===`dep-${user.department.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'')}`);
    return json(res,200,{widgetTypes:WIDGET_TYPES,dashboards});
  }
  if (req.method === 'GET' && /^\/api\/dashboards\/[^/]+$/.test(url.pathname)) {
    const id=url.pathname.split('/')[3],definition=getDashboardDefinition(id);
    if(!definition)return json(res,404,{error:'Dashboard não encontrado'});
    if(!allowed(user,definition.module))return json(res,403,{error:'Sem permissão para este dashboard'});
    if(user.department&&definition.departmentId&&!definition.departmentId.endsWith(user.department.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'')))return json(res,403,{error:'Sem permissão para este departamento'});
    return json(res,200,dashboardPayload(store,id,Object.fromEntries(url.searchParams)));
  }
  if (req.method === 'GET' && /^\/api\/dashboard-preferences\/[^/]+$/.test(url.pathname)) {
    const dashboardId=url.pathname.split('/')[3],definition=getDashboardDefinition(dashboardId);if(!definition)return json(res,404,{error:'Dashboard não encontrado'});
    const saved=(store.dashboardPreferences||[]).find(item=>item.userId===user.id&&item.dashboardId===dashboardId);
    return json(res,200,saved||{userId:user.id,dashboardId,hiddenWidgets:[],widgetOrder:definition.widgets.map(item=>item.id),density:'comfortable'});
  }
  if (req.method === 'PUT' && /^\/api\/dashboard-preferences\/[^/]+$/.test(url.pathname)) {
    const dashboardId=url.pathname.split('/')[3],definition=getDashboardDefinition(dashboardId);if(!definition)return json(res,404,{error:'Dashboard não encontrado'});
    return body(req).then(input=>{const validIds=new Set(definition.widgets.map(item=>item.id)),preference={userId:user.id,dashboardId,hiddenWidgets:[...new Set(input.hiddenWidgets||[])].filter(id=>validIds.has(id)),widgetOrder:[...new Set(input.widgetOrder||[])].filter(id=>validIds.has(id)),density:input.density==='compact'?'compact':'comfortable',updatedAt:new Date().toISOString()};for(const id of validIds)if(!preference.widgetOrder.includes(id))preference.widgetOrder.push(id);store.dashboardPreferences=store.dashboardPreferences||[];const index=store.dashboardPreferences.findIndex(item=>item.userId===user.id&&item.dashboardId===dashboardId);if(index>=0)store.dashboardPreferences[index]=preference;else store.dashboardPreferences.push(preference);audit(store,user,'UPDATE','dashboardPreference',dashboardId,null,preference,'Personalização de dashboard');writeStore(store);return json(res,200,preference)});
  }
  if (req.method === 'POST' && url.pathname === '/api/monday/test') { if(!allowed(user,'juridico','read')) return json(res,403,{error:'Sem permissão'}); return mondayQuery('{me{id name email}}').then(data=>json(res,200,{connected:true,account:data.me})).catch(error=>json(res,503,{connected:false,error:error.message})); }
  if (req.method === 'GET' && url.pathname.startsWith('/api/legal/')) { const moduleName=url.pathname.split('/')[3];if(moduleName==='honorariosJudiciais'){const processRows=collection(store,'processos').filter(x=>!x.deletedAt&&x.source==='monday'&&scoped(user,x));return json(res,200,{module:moduleName,...judicialHonorariumPayload(processRows)});}const rows=collection(store,moduleName).filter(x=>!x.deletedAt&&x.source==='monday'&&scoped(user,x)); if(moduleName==='processos'&&url.searchParams.get('paginated')==='1')return json(res,200,{module:moduleName,...filterProcesses(rows,url)});if(moduleName==='honorarios'&&url.searchParams.get('paginated')==='1')return json(res,200,{module:moduleName,...filterHonorariums(rows,url)});return json(res,200,{module:moduleName,count:rows.length,records:rows}); }
  if (req.method === 'POST' && url.pathname === '/api/monday/sync') { if(!allowed(user,'juridico','create')) return json(res,403,{error:'Sem permissão para sincronizar'}); return body(req).then(async input=>{const modules=input.modules?.length?input.modules:Object.keys(MONDAY_BOARDS);store.mondayRuns=store.mondayRuns||[];const run={id:crypto.randomUUID(),startedAt:new Date().toISOString(),requestedBy:user.name,modules:[],status:'running'};store.mondayRuns.push(run);let failed=0;for(const moduleName of modules){const board=MONDAY_BOARDS[moduleName];if(!board)continue;try{const items=await fetchMondayBoard(board.id);const list=collection(store,moduleName);let created=0,updated=0;for(const raw of items){const normalized=normalizeMondayItem(raw,moduleName,board);const existing=list.find(x=>x.source==='monday'&&x.externalId===normalized.externalId);if(existing){const before=structuredClone(existing);Object.assign(existing,normalized,{id:existing.id,version:(existing.version||1)+1});updated++;}else{list.push({...normalized,version:1});created++;}}run.modules.push({module:moduleName,board:board.name,read:items.length,created,updated,status:'ok'});}catch(error){failed++;run.modules.push({module:moduleName,board:board.name,status:'error',error:error.message});}}run.status=failed?'partial':'completed';run.finishedAt=new Date().toISOString();audit(store,user,'SYNC','monday',run.id,null,run,'Sincronização somente leitura com preservação de dados anteriores');writeStore(store);return json(res,failed?207:200,run);}); }
  if (req.method === 'GET' && url.pathname === '/api/auth/requests') { if(!allowed(user,'*','approve')) return json(res,403,{error:'Somente aprovadores podem consultar solicitações'}); return json(res,200,store.registrationRequests); }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/auth\/requests\/[^/]+\/approve$/)) { if(!allowed(user,'*','approve')) return json(res,403,{error:'Somente aprovadores podem aprovar'}); const id=url.pathname.split('/')[4]; const request=store.registrationRequests.find(r=>r.id===id&&r.status==='pending'); if(!request) return json(res,404,{error:'Solicitação não encontrada'}); request.status='approved';request.approvedAt=new Date().toISOString();request.approvedBy=user.name; const created={id:crypto.randomUUID(),name:request.name,email:request.email,role:request.requestedRole,department:request.department,mfa:false,temporaryPassword:true}; store.users.push(created); audit(store,user,'APPROVE','registration',id,{status:'pending'},{status:'approved',userId:created.id},'Aprovação de cadastro por responsável humano'); writeStore(store); return json(res,200,{approved:true,user:created}); }
  if (req.method === 'GET' && url.pathname === '/api/dashboard') { if (!allowed(user,'central')) return json(res,403,{error:'Sem permissão'}); return json(res,200,{metrics:metrics(store), departments:store.departments, finance:departmentFinancials(store), upcoming:store.agenda}); }
  if (req.method === 'GET' && url.pathname === '/api/audit') { if (!allowed(user,'*')) return json(res,403,{error:'Sem permissão'}); return json(res,200,store.audit.slice(-100).reverse()); }
  if (req.method === 'GET' && url.pathname === '/api/compliance') return json(res,200,store.compliance);
  if (req.method === 'POST' && url.pathname === '/api/compliance') return body(req).then(input => { const entry={id:crypto.randomUUID(), ...input, ruleVersion:input.ruleVersion || 'COEVO-COMP-1.0', result:input.result || 'Pendente', responsible:user.name, createdAt:new Date().toISOString()}; store.compliance.push(entry); audit(store,user,'CREATE','compliance',entry.id,null,entry); writeStore(store); return json(res,201,entry); });
  if (req.method === 'GET' && url.pathname === '/api/agenda') return json(res,200,store.agenda);
  if (req.method === 'POST' && url.pathname === '/api/agenda') { if (!allowed(user,'agenda','create')) return json(res,403,{error:'Sem permissão'}); return body(req).then(input=>{ const item={id:crypto.randomUUID(),...input}; store.agenda.push(item); audit(store,user,'CREATE','agenda',item.id,null,item); writeStore(store); return json(res,201,item); }); }
  if (req.method === 'GET' && url.pathname === '/api/departments') return json(res,200,store.departments);
  if (req.method === 'GET' && url.pathname === '/api/committees') return json(res,200,store.committees);
  if (req.method === 'POST' && url.pathname === '/api/committees') { if (!allowed(user,'comites','create')) return json(res,403,{error:'Sem permissão'}); return body(req).then(input=>{ const item={id:crypto.randomUUID(),status:'Rascunho',createdBy:user.name,createdAt:new Date().toISOString(),...input}; store.committees.push(item); audit(store,user,'CREATE','committee',item.id,null,item); writeStore(store); return json(res,201,item); }); }
  if (req.method === 'POST' && url.pathname === '/api/presentations/validate') { if (!allowed(user,'comites','export')) return json(res,403,{error:'Sem permissão para exportar'}); return body(req).then(input=>{ const blocked = input.audience === 'Diretoria' && input.classification === 'Compartilhável'; return json(res, blocked ? 422 : 200, blocked ? {error:'Classificação incompatível com o público Diretoria', complianceBlocked:true} : {valid:true, format:['pptx','pdf'], auditRequired:true}); }); }
  if (req.method === 'POST' && url.pathname === '/api/presentations/export') { if (!allowed(user,'comites','export')) return json(res,403,{error:'Sem permissão para exportar'}); return body(req).then(async input=>{ if(input.audience === 'Diretoria' && input.classification === 'Compartilhável') return json(res,422,{error:'Classificação incompatível com o público Diretoria',complianceBlocked:true}); try { const result=await generatePresentation(input); audit(store,user,'EXPORT','presentation',result.id,null,{topics:result.topics,audience:input.audience,classification:input.classification,files:[result.pptxPath,result.pdfPath]},'Exportação validada'); writeStore(store); return json(res,201,result); } catch(error) { return json(res,500,{error:'Não foi possível gerar a apresentação'}); } }); }
  if (req.method === 'GET' && url.pathname.startsWith('/api/entities/')) { const type=url.pathname.split('/')[3]; return json(res,200,collection(store,type).filter(x=>!x.deletedAt && scoped(user,x))); }
  if (req.method === 'POST' && url.pathname.startsWith('/api/entities/') && !url.pathname.endsWith('/restore')) { const type=url.pathname.split('/')[3]; if(!allowed(user,type,'create')) return json(res,403,{error:'Sem permissão'}); return body(req).then(input=>{ const item={id:crypto.randomUUID(),version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdBy:user.name,...input}; collection(store,type).push(item); audit(store,user,'CREATE',type,item.id,null,item); writeStore(store); return json(res,201,item); }); }
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/entities/')) { const [, , , type, id]=url.pathname.split('/'); if(!allowed(user,type,'update')) return json(res,403,{error:'Sem permissão'}); return body(req).then(input=>{ const list=collection(store,type); const item=list.find(x=>x.id===id && !x.deletedAt); if(!item || !scoped(user,item)) return json(res,404,{error:'Registro não encontrado'}); const before=structuredClone(item); Object.assign(item,input,{version:item.version+1,updatedAt:new Date().toISOString(),updatedBy:user.name}); audit(store,user,'UPDATE',type,id,before,item); writeStore(store); return json(res,200,item); }); }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/entities/')) { const [, , , type, id]=url.pathname.split('/'); if(!allowed(user,type,'archive')) return json(res,403,{error:'Exclusão lógica não autorizada'}); const item=collection(store,type).find(x=>x.id===id); if(!item || !scoped(user,item)) return json(res,404,{error:'Registro não encontrado'}); const before=structuredClone(item); item.deletedAt=new Date().toISOString(); item.deletedBy=user.name; audit(store,user,'ARCHIVE',type,id,before,item); writeStore(store); return json(res,200,{archived:true,id}); }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/entities\/[^/]+\/[^/]+\/restore$/)) { const [, , , type, id]=url.pathname.split('/'); if(!allowed(user,type,'restore')) return json(res,403,{error:'Restauração não autorizada'}); const item=collection(store,type).find(x=>x.id===id); if(!item) return json(res,404,{error:'Registro não encontrado'}); const before=structuredClone(item); delete item.deletedAt; delete item.deletedBy; item.version++; item.updatedAt=new Date().toISOString(); audit(store,user,'RESTORE',type,id,before,item); writeStore(store); return json(res,200,item); }
  if (req.method === 'POST' && url.pathname === '/api/budgets/import/preview') return body(req).then(input=>json(res,200,parseCsv(input.csv)));
  if (req.method === 'POST' && url.pathname === '/api/budgets/import/commit') { if(!allowed(user,'orcamento','create')) return json(res,403,{error:'Sem permissão'}); return body(req).then(input=>{const parsed=parseCsv(input.csv); if(parsed.invalid.length || parsed.duplicates.length) return json(res,422,{error:'Importação rejeitada',...parsed}); const batch={id:crypto.randomUUID(),checksum:hash(input.csv),createdAt:new Date().toISOString(),createdBy:user.name,rows:parsed.valid}; store.budgetImports=(store.budgetImports||[]).filter(x=>x.checksum!==batch.checksum); store.budgetImports.push(batch); audit(store,user,'IMPORT','budget',batch.id,null,batch,'Importação validada e deduplicada'); writeStore(store); return json(res,201,batch); }); }
  if (req.method === 'POST' && url.pathname === '/api/backup') { if(!allowed(user,'*','approve')) return json(res,403,{error:'Backup restrito'}); try { const backup=encryptBackup(store); audit(store,user,'BACKUP','system',backup.checksum,null,{checksum:backup.checksum},'Backup cifrado'); writeStore(store); return json(res,201,backup); } catch(error) { return json(res,503,{error:error.message}); } }
  if (req.method === 'POST' && url.pathname === '/api/backup/restore') { if(!allowed(user,'*','approve')) return json(res,403,{error:'Restauração restrita'}); return body(req).then(input=>{ try { const restored=decryptBackup(input); if(!restored.users || !restored.departments || !restored.audit) return json(res,422,{error:'Backup inválido'}); audit(restored,user,'RESTORE_BACKUP','system','restore',null,{restoredAt:new Date().toISOString()},'Restauração autorizada'); writeStore(restored); return json(res,200,{restored:true}); } catch(error) { return json(res,422,{error:'Backup inválido ou não pôde ser decifrado'}); } }); }
  return json(res,404,{error:'Rota não encontrada'});
}
if (require.main === module) { ensureStore(); http.createServer((req,res)=>handler(req,res)).listen(PORT,()=>console.log(`COEVO Alta Performance disponível em http://localhost:${PORT}`)); setInterval(()=>scheduledMondayTick().catch(error=>console.error('Monday scheduler:',error.message)),60000); }
module.exports = { seed, ROLES, allowed, metrics, departmentFinancials, filterProcesses, filterHonorariums, judicialHonorariumPayload, handler, readStore, writeStore, parseCsv, hash, dashboardPayload };

