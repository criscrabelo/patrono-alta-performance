# PATRONO ALTA PERFORMANCE — HANDOFF MASTER

Versão 1.3 · 12 set 2026 · Coevo Construtora e Incorporadora — Taubaté/SP
Gestora e autoridade final: Cristiane C. Rabelo (Advogada · Coordenação)

Este documento é autossuficiente. O desenvolvedor não precisa ler os prompts de arquitetura anteriores.
Regra de uso: quando houver conflito entre este documento e uma interpretação, registrar a dúvida em `DECISIONS.md` — não improvisar regra crítica. Decisões técnicas locais e reversíveis seguem boas práticas sem parar o desenvolvimento.

---

## 1. Visão do Produto

**Propósito.** A Patrono é a camada de governança, contexto e decisão da COEVO e do Grupo VELKOR. Ela conecta o que precisa ser conectado, organiza o que precisa ser governado e apresenta o que precisa ser decidido. Não substitui os sistemas especialistas.

**Usuários.** Gestora (Visão Executiva); Jurídico (Miguel Clep, Thamar Victoria, Geovana Cavalcanti); TI (Jonathan Alves, Vinicius Heitor); equipes das empresas VELKOR; administradores técnicos.

Os nomes acima são referências organizacionais, nunca regras de autorização hardcoded. Todo acesso é concedido por identidade, perfil, papel e escopo configuráveis.

**Ambientes.** Visão Executiva · Departamento Jurídico · Tecnologia da Informação · Grupo VELKOR.

**Princípios.**
1. Uma informação existe uma vez e aparece em muitas views.
2. Um registro não vira novo registro por aparecer em outro módulo.
3. View ≠ Entidade. Dashboard ≠ Módulo. Ambiente ≠ Empresa ≠ Módulo.
4. Integração ≠ Fonte Oficial.
5. Central transversal não tem banco paralelo.
6. Segurança, permissões, dados e identidade são fundação, não acabamento.

## 2. Não Objetivos / Fora de Escopo

A Patrono **não** é e não deve virar: CRM completo, ERP financeiro, contabilidade, sistema fiscal, internet banking, plataforma de pagamentos, GED completo, provedor de assinatura, calendário corporativo, sistema de SST, sistema de compras, substituto do Monday.

Removidos explicitamente: módulo de Leads, funil de vendas completo, dashboard de corretor, botão "Pagar", edição de título financeiro, DRE/balanço/fluxo de caixa paralelos, scores genéricos (qualidade, compliance, performance, data health), rankings de pessoas ou áreas.

## 3. Arquitetura Funcional

Oito camadas:

| # | Camada | Conteúdo |
|---|---|---|
| 1 | Ambientes | Definem a sidebar e o escopo de acesso |
| 2 | Módulos de negócio | Domínio claro + usuário + entidade + fluxo + valor |
| 3 | Entidades canônicas | Identidade, lifecycle, relações, histórico |
| 4 | Views e centrais | Consomem entidades; sem registros próprios de negócio |
| 5 | Governança transversal | Permissões, auditoria, indicadores, compliance, dados |
| 6 | Integrações | Conectores somente leitura no MVP |
| 7 | Patrono IA | Core único + contexto + permissões + ferramentas + dados autorizados |
| 8 | Administração | Acessos, ambientes, catálogos, fontes, segurança, auditoria |

Arquitetura técnica conceitual: Core Domain · Application/Workflow · View/Experience · Integration · Governance. Tecnologia não definida aqui (ver §27).

Critérios de classificação:
- **Módulo**: domínio, usuário, entidade, fluxo e valor. Sem isso, é view.
- **Entidade**: identidade, lifecycle, relações e histórico. Sem isso, é atributo, evento ou view.
- **Central**: agrega registros de vários módulos e não é source of truth.
- **Dashboard**: responde perguntas e não guarda dados.
- **Remoção**: repete dados, não tem usuário claro, não gera ação, duplica outra central ou só existe porque existia board no Monday.

## 4. Ambientes e Empresas

| Ambiente | Natureza | Home |
|---|---|---|
| Visão Executiva | Camada de consolidação da gestora; sem registro operacional próprio | Centro de Comando |
| Departamento Jurídico | Operacional e gerencial | Visão Jurídica |
| Tecnologia da Informação | Operacional e gerencial | Visão TI |
| Grupo VELKOR | Grupo empresarial com quatro empresas segregadas | Visão Grupo VELKOR |

Empresas VELKOR (dentro do ambiente, segregadas entre si): VELKOR Soluções Imobiliárias · VELKOR Seguros e Consórcios · VELKOR Correspondente Bancário · VELKOR Finance.

Empresas internas COEVO: COEVO, SPEs, demais controladas — sempre segregadas por empresa/SPE.

Não existe ambiente "Financeiro COEVO": Financeiro é domínio transversal. **VELKOR Finance é frente de negócio; "Financeiro" é domínio corporativo. Não misturar.**

## 5. Navegação Final

**Topo global:** seletor de ambiente · busca global (uma só) · atenção/notificações · perfil. Nada além.

**Sidebar dinâmica por ambiente:**

- **Visão Executiva:** Centro de Comando · Minha Semana · Estratégia & Projetos · Decisões & Aprovações · Performance · Agenda · Relatórios. (Riscos e Saúde Operacional acessados pelo Centro de Comando.)
- **Jurídico:** Visão Jurídica · Processos (Judiciais, Administrativos, Parceiros, BOs; Audiências é view) · Demandas Jurídicas · Contratos (Clientes, Prestadores Administrativos, Prestadores de Obra, SCP/SPE, Outros — uma entidade) · Notificações · Cobrança & Recuperação (Protestos, Cessões, Transferência Intermediada, Recuperação) · Distratos & Retomadas · Entrega de Chaves · Regularização Imobiliária (views: Cartório & Prefeitura, Procurações, Convenções, Terrenos) · Honorários & Custos · Performance · Comitê Jurídico.
- **TI:** Visão TI · Chamados & Suporte · Projetos TI (IA & Inovação é view filtrada) · Sistemas & Licenças · Ativos & Aquisições · Governança TI · Performance · Comitê TI.
- **Grupo VELKOR:** Visão Grupo VELKOR · Soluções Imobiliárias · Seguros & Consórcios · Correspondente Bancário · VELKOR Finance · Conselho & Governança · Performance Consolidada.
  - Soluções: Visão Geral · Clientes · Pedidos & Orçamentos · Serviços/Catálogo (VLK01–VLK22) · Processos em Andamento · Contratos · Projetos & Implantação · Performance.
  - Seguros: Visão Geral · Clientes · Solicitações · Cotações & Propostas · Seguros · Renovações · Oportunidades · Performance · Governança. (Consórcio adiado; Atividades é view.)
  - Correspondente e Finance (em implantação): Visão da Implantação · Projetos/Pendências · Governança · Documentação. Sem produção fictícia.
- **Administração:** Usuários & Acessos · Ambientes & Empresas · Perfis & Permissões · Parâmetros & Catálogos · Integrações & Fontes · Dados & Qualidade · Patrono IA · Segurança & Privacidade · Auditoria.

**Padrões:** breadcrumb (Jurídico → Contratos → Contrato X); side panel para detalhe contextual; página completa quando a entidade tem complexidade própria; modal só para confirmação, ação curta ou crítica; rota canônica por entidade transversal (`/projects/:id` com contexto) — nunca o mesmo registro em duas rotas; favoritos e recentes apontam, não copiam.

**Mobile:** Centro de Comando · Minha Semana · Precisa de Mim · Agenda · Busca · Aprovações. Um só produto; sem replicar a sidebar desktop.

**Navegação final = target-state.** Módulos ainda não implementados não devem aparecer como telas vazias. Usar lifecycle/feature flags para manter ocultas capacidades futuras até estarem prontas e autorizadas para o ambiente.

## 6. Entidades Canônicas

| Grupo | Entidades | Nota |
|---|---|---|
| Pessoas & Organizações | Person, User, Organization, Internal Company, SPE | Cliente é papel/relacionamento, não pessoa duplicada. Person ≠ User. |
| Imobiliário | Development, Unit | Identidade canônica na Patrono; IDs externos via External Identity. Número da unidade nunca é ID global. |
| Comercial | Proposal, Reservation, Sale | Lead permanece no CV. Proposta ≠ Reserva ≠ Venda ≠ Contrato. |
| Contratual | Contract, Contract Obligation, Contract Event | Uma entidade para todos os tipos. Aditivo = Contract Event + documento. Contrato ≠ Documento. |
| Documental | Document, Document Version, File Reference, Signature | Por padrão, arquivos permanecem no repositório oficial e a Patrono armazena referência, identidade, metadados e versão. Cópia controlada só quando houver requisito jurídico, de preservação, evidência ou continuidade expressamente aprovado. |
| Jurídico | Legal Process, Legal Deadline, Legal Demand, Notification, Distrato, Retomada, BO, Legal Cost | Protesto é procedimento de cobrança, não entidade. Legal Deadline possui identidade própria no piloto; não é simples campo de data do processo. |
| TI | Ticket, System, License, Asset | Aquisição é solicitação relacionada ao ativo. |
| Projetos | Project, Milestone, Task/Action | Uma entidade Project com environment/company/domain. |
| Governança | Decision, Approval, Risk, Incident, Problem, Change, Meeting, Agenda Item, Relevant Fact | Uma por conceito; origem/ambiente como atributo. |
| Compliance & Dados | Policy, Obligation, Control, Evidence, Nonconformity, Control Exception, Data Quality Issue, Data Conflict | Conflito único reutilizado por todas as views. |
| Financeiro | Financial Obligation, Receivable, Payment Event, ERP Settlement, Reconciliation, Commission | Nunca colapsar em "Transação". |
| VELKOR | Service Definition, Order, Quote, Service Case, Insurance Request, Insurance Quote, InsurancePolicy | `Policy` é reservado à Política Corporativa de Compliance; apólice de seguro usa `InsurancePolicy` (e `InsuranceContract` quando aplicável), somente com operação real. |
| Transversais | Responsibility, Dependency, Blocker, External Identity, Integration Mapping | Follow-up é evento, não entidade. |

Deixam de ser entidade: Protesto, Follow-up, Proprietário atual (derivado do histórico), Projeto/Decisão/Reunião por ambiente, Condições Vigentes Consolidadas (view).

**Agenda Item ≠ Agenda temporal.** `Agenda Item` é item de pauta vinculado a uma `Meeting`. A `Agenda` transversal é uma view temporal que consome registros canônicos (ex.: Legal Deadline, Meeting, Milestone, Follow-up) sem criar cópias.

**Notification jurídica/negocial ≠ notificação de sistema/UI.** `Notification` no domínio Jurídico representa notificação jurídica/negocial. Alertas, badges, e notificações de interface são sinais/canais da camada de experiência e não reutilizam essa entidade.

**Policy corporativa ≠ InsurancePolicy.** `Policy` é reservado às políticas corporativas de Compliance/Governança. Uma apólice de seguro deve usar `InsurancePolicy` (ou `InsuranceContract`, quando a modelagem contratual exigir), evitando colisão semântica entre compliance e seguros.

**Prazo Jurídico / Legal Deadline.** É objeto de domínio com identidade própria, vinculado a Legal Process e capaz de preservar origem, data, alterações, suspensão, responsável, cumprimento, histórico e evidência. No MVP a Patrono não calcula automaticamente prazo processual: a data deve vir de fonte validada ou ser registrada por usuário autorizado, sempre com origem identificada. Qualquer motor futuro de cálculo exige calendário e regras juridicamente homologados.

## 7. Relacionamentos Principais

- Person/Organization —papel Cliente→ Sale —→ Unit —→ Development —→ SPE
- Sale —→ Contract —→ Document (versão oficial) —→ Signature
- Contract —→ Contract Obligation —→ Contract Event (aditivo, reajuste, renovação, encerramento)
- Financial Obligation —→ Payment Event —→ ERP Settlement —→ Reconciliation
- Commission: um master record por contexto de negócio. Para comissão de venda imobiliária COEVO, a origem é CV; outros domínios (ex.: Seguros) podem possuir outra fonte oficial. Relacionar sempre ao evento de pagamento/baixa correspondente sem duplicação.
- Legal Process possui Legal Deadline(s) com origem identificada. Cada Legal Deadline pode possuir Responsibility. Agenda e Atenção são views que consomem o mesmo Legal Deadline; não criam novos registros de prazo.
- Project —→ Milestone —→ Risk / Decision —→ Task/Action
- Policy —→ Obligation —→ Control —→ Evidence —→ Nonconformity —→ Task/Action
- Cliente × Unidade: relação contextual com papel (Comprador, Proprietário, Cessionário, Interessado, Locatário), início, fim, motivo, origem, contrato. Cessão, distrato e retomada preservam o histórico — nunca sobrescrevem.

## 8. Modelo de Dados Conceitual

Sem SQL definitivo. Regras estruturais:
- Toda entidade canônica tem ID Patrono (não CPF/CNPJ) e identidade estável. Empresa/SPE, owner, status de domínio, histórico e auditoria são aplicados conforme a natureza e criticidade da entidade; não devem ser adicionados mecanicamente a objetos que não os comportem (ex.: Document Version, Signature, External Identity).
- **Record Owner ≠ Data Owner.** Record Owner acompanha o registro/processo operacional. Data Owner responde pela definição, qualidade e governança do domínio/campo de dados.
- External Identity: `patrono_id → (sistema, id_externo, tipo de fonte, última sincronização)`. N por registro.
- Dado original preservado por fonte; dado canônico escolhido por regra de field ownership.
- Snapshot contratual é separado do cadastro mestre atual: contrato histórico não muda quando o cadastro muda.
- Status por camada na Unidade: comercial, contratual, financeiro, jurídico, entrega. Sem status universal.
- Registro mesclado vira alias; nunca é excluído. Unmerge previsto conceitualmente, não prometido.
- Dado derivado é marcado como derivado e tem fórmula única na definição central.

## 9. Source of Truth

| Dado | Fonte oficial | Observação |
|---|---|---|
| Identidade canônica de cliente, unidade, empreendimento | Patrono (Canonical Identity Registry) | Patrono mantém o ID canônico e os External Identities; a fonte oficial dos atributos é definida campo a campo por Field-Level Source of Truth. CV/Sienge permanecem origem/evidência conforme o atributo. |
| Nome do cliente (escopo comercial COEVO/CV) | CV | Sienge secundária. Para VELKOR ou outros domínios, a fonte deve ser definida por escopo/empresa. |
| Situação financeira, baixa ERP, título, fornecedor | Sienge | — |
| CPF/CNPJ | **DECISÃO DE NEGÓCIO PENDENTE** | Bloqueia matching e snapshot |
| Contato do cliente | **DECISÃO DE NEGÓCIO PENDENTE** | Divergência CV × Sienge já observada |
| Venda, proposta, reserva, status comercial da unidade, cálculo de comissão | CV | CV não é fonte de quitação |
| Pagamento (evento), liquidação | Plataforma financeira | Não é baixa |
| Contrato, decisão, risco, status jurídico | Patrono | Monday transitório no jurídico |
| Processo jurídico, projeto, tarefa | Monday → Patrono | Durante o MVP, Monday é System of Record operacional/transitório para os boards integrados em leitura; Patrono é identidade canônica e camada de governança. A assunção futura como System of Record exige decisão por board/domínio e plano de saída. |
| Documento / arquivo oficial | Drive / OneDrive / SharePoint (ou outro repositório documental aprovado) | Patrono referencia; repositório oficial final deve ser definido por documento/domínio. |
| Assinatura e evidência do processo de assinatura | Clicksign | Provedor de assinatura; não é cadastro mestre do contrato. O arquivo final assinado deve manter referência/versionamento no repositório oficial definido. |

Tipos de fonte: Master · Secondary · Operational · Reference · Derived · Transitional · Legacy. Sincronização só atualiza campo cuja fonte é a autorizada. Mudança de source of truth exige decisão, owner, impacto, plano de transição e data.

**Escopo do Source of Truth.** As fontes oficiais podem variar por empresa, domínio e processo. Uma regra válida para COEVO/CV não se estende automaticamente às empresas VELKOR. Quando necessário, a matriz deve ser lida como `Escopo + Dado/Campo + Fonte Oficial`.

**Canonical Identity ≠ Source of Truth.** A Patrono é o registro canônico de identidade das entidades que consolida, mas isso não a torna automaticamente dona de todos os atributos cadastrais. Nome, CPF/CNPJ, contato, status comercial, situação financeira e demais campos podem ter fontes oficiais distintas. O source of truth deve ser definido em nível de campo quando necessário.

**Regra de bloqueio por escopo.** Source of truth indefinido para dado crítico é P0 somente para a funcionalidade, integração, relatório, automação ou go-live que depende daquele dado. Decisões pendentes de CPF/CNPJ e contato não bloqueiam o shell, Auth, Design System ou fundação; bloqueiam, porém, matching definitivo, deduplicação e views/fluxos que dependam desses campos.

## 10. Integrações

| Sistema | Papel | Fase | Modo |
|---|---|---|---|
| Monday | Operacional / transitório | MVP | Leitura |
| Google Drive | Repositório | MVP | Leitura / referência |
| Google Calendar | Calendário/view externa de compromissos | Piloto opcional / MVP | Leitura |
| Clicksign | Provedor de assinatura | Pós-MVP | Leitura |
| CV | CRM especialista | Pós-MVP | Leitura |
| Sienge | ERP especialista | Pós-MVP | Leitura (módulos/API a confirmar) |
| Plataformas financeiras | Execução financeira | Pós-MVP | Leitura |
| OneDrive / SharePoint, Outlook, e-mail, WhatsApp | Repositório / calendário / comunicação | Futuro | Leitura |

Regras: menor privilégio; service account por finalidade; sem credencial compartilhada; conector de leitura sem acesso a pagamento; nenhuma escrita externa no MVP; fonte indisponível nunca apaga o último dado válido — preserva-o com status `stale`/Parcial/Indisponível, timestamp da última confirmação e da última tentativa, nunca como zero; schema change pausa o mapeamento e sinaliza impacto; webhook duplicado não duplica registro (idempotência).

**Segredos de integração — P0 de implementação.** Nenhum token, API key, client secret ou credencial pode residir no front-end, browser, `localStorage` ou `sessionStorage`. Integrações como Monday devem executar com segredo server-side (backend/proxy/serviço seguro) antes da homologação com dados reais.

**Google Calendar no piloto.** É integração de leitura para compromissos/eventos autorizados e pode funcionar como view externa de agenda. Não é fonte oficial de prazo jurídico. Legal Deadline nasce de fonte jurídica validada ou registro autorizado na Patrono; sua exibição em Agenda/Calendar não transfere a autoridade do prazo para o calendário.

## 11. Permissões e Segurança

- RBAC + escopos por ambiente, empresa/SPE, módulo, registro, campo, documento e ação.
- **Autorização obrigatoriamente server-side.** Cada requisição/operação deve validar identidade, escopo, ação e acesso ao objeto no backend. Ocultar menu, botão ou rota no front-end é apenas UX e nunca substitui autorização. Testar object-level authorization e prevenção de IDOR/BOLA.
- Administrador técnico ≠ superusuário de conteúdo.
- Identidade compartilhada ≠ permissão compartilhada: a mesma pessoa é reconhecida entre empresas, mas relacionamentos e acessos permanecem separados.
- Views 360, busca, lineage, catálogo e IA respeitam as mesmas permissões; nenhuma delas é atalho.
- Dados bancários: alta restrição; fora da visão executiva; sem alteração pela Patrono no MVP.
- Erro de permissão nunca aparece como erro técnico; não revela existência de registro restrito.
- Exportação restrita e auditada; sem exportação em massa por padrão.
- Revogação imediata de sessão, usuário e credencial de integração deve ser suportada e testada.
- Antes de produção com dados reais em escala, deve existir plano mínimo de resposta a incidentes de segurança e privacidade, com papéis, contenção, preservação de evidências e escalonamento.
- Retenção e descarte seguem política por categoria de dado/documento; não existe prazo universal. Legal hold/litígio prevalece sobre exclusão automática quando aplicável.
- **Catálogo global de testes de permissão:** TI acessando Jurídico; VELKOR Soluções acessando Seguros; SPE acessando outra; usuário comum acessando financeiro; URL/ID direto sem permissão; busca retornando item restrito; IA recuperando dado proibido. Cada cenário torna-se obrigatório no release que expuser aquela frente.
- **MVP/Piloto Jurídico — testes de permissão obrigatórios:** usuário sem escopo jurídico bloqueado; acesso por URL/ID direto bloqueado; busca local sem vazamento de registros restritos; administrador técnico sem acesso automático ao conteúdo jurídico; escopo por registro/documento respeitado.

## 12. Auditoria

Trilha única e transversal (sem log por ambiente). Auditar: criação, merge, unmerge, alteração de identidade, mudança de fonte oficial, alteração de CPF/CNPJ, alteração de empreendimento da unidade, alteração de parte/valor/prazo de contrato, mudança de documento oficial, aprovação, reconciliação manual, exportação, escrita externa, mudança de definição/fonte/fórmula/owner/mapping de dado, ações de IA nível 3. Não auditar visualização como produtividade. Não gravar conta bancária completa no log.

## 13. Patrono IA

Um core único; experiência contextual por módulo, registro, central e busca. "Perguntar à Patrono" é ação transversal; chat flutuante não é o único acesso.

Níveis de autonomia: 0 Consulta · 1 Organização · 2 Recomendação · 3 Preparação de ação (só com clareza e controle) · 4 Execução controlada (fora do MVP). Os níveis 0–2 são os primeiros níveis autorizáveis quando a camada de IA for implementada; a IA não é requisito para homologação do MVP técnico inicial.

Atributos: permission-aware, grounded, source-aware, auditable, human-controlled. Resposta sempre com evidência + fonte + limitação (ex.: "Valor R$ X · Fonte Sienge · Atualizado em … · Status parcial"). Se a fonte está indisponível: "Não foi possível confirmar na fonte", nunca "pagamento não realizado".

Proibições absolutas (violação = P0): pagar, assinar, aprovar, aceitar risco, publicar, alterar permissão, distratar, cancelar venda, alterar preço, transferir dinheiro, conceder acesso, mesclar registro, alterar source of truth, resolver conflito, declarar conformidade definitiva.

## 14. Automações

Governança central; nenhuma automação dentro de módulo sem registro. Sempre dentro de alçada; ação fora de alçada é bloqueada e auditada. Automações críticas ficam na Fase 8. **Automação determinística não depende de IA**: pode operar sobre regras, eventos e integrações governadas quando Security, Data Core, Governance e Integration estiverem maduras. IA só entra como dependência quando o caso de uso da automação realmente a utilizar. Event bus / workflow engine: conceito futuro, não implementar agora.

## 15. UX / Design System

Identidade warm premium. Cores base: laranja queimado, terracota, cobre, espresso, bege, areia, champagne, off-white, cinza quente. Azul não é cor de marca/estrutura da Patrono; eventual uso semântico só ocorre se formalmente definido no Design System para informação/acessibilidade. Cores semânticas apenas para status, risco, alerta e confirmação — sempre cor + texto + ícone. Tipografia consistente; densidade executiva e respirável. Tabelas padronizadas (header, filtros, busca, saved views, paginação, fonte, ação). Cards para síntese, não um por linha no desktop. Source badges discretos (CV, Sienge, Monday, Patrono); "Sobre este dado" mostra fonte, atualização e divergência. Sem ID técnico na UX de negócio.

## 16. Responsividade

Desktop/notebook é o ambiente principal de gestão, operação, análise e administração. Tablet adapta. Mobile prioriza as seis entradas do §5. Tabela vira cards no mobile quando necessário.

## 17. Acessibilidade

Contraste, navegação por teclado, focus visível, labels, screenreader, nunca depender apenas de cor. Auditoria de acessibilidade obrigatória antes do go-live.

## 18. Erros, Empty States e Source Down

Estados de dados: Carregando · Disponível · Parcial · Indisponível · Vazio real. Parcial nunca é apresentado como total. Indisponível mostra fonte e última atualização. **Falha de fonte nunca apaga o último dado válido**: quando houver valor anterior confiável, ele permanece visível com indicação clara de `stale`/Parcial/Indisponível e timestamp da última confirmação. Vazio real é distinto de falha. Todas as views refletem a mesma condição — nunca uma dizendo zero e outra indisponível.

## 19. Dados Demonstrativos

Marcados visivelmente; separados dos dados de produção; nunca misturados em relatório, KPI ou IA.

## 20. Indicadores

Dicionário Oficial único. Todo KPI declara campos, fonte, transformação e fórmula; sem lineage não é publicado. Sem fórmula local em módulo ou relatório. Performance segue Produção · Eficiência · Carga · Evolução — sem ranking, sem score, sem penalizar espera externa. Estoque ≠ fluxo. Sem KPI de conversão sem coorte e período definidos. Sem margem, ROI, EBITDA, DRE ou fluxo de caixa inventados.

## 21. Relatórios

Camada de saída sobre KPIs e snapshots das fontes oficiais. Sem data store próprio. Respeitam escopo e permissão. Não substituem relatórios do CRM ou do ERP.

## 22. MVP

**Entra:** autenticação e sessões · usuários e perfis · ambientes · permissões RBAC + escopo por empresa/SPE · navegação por ambiente · design system · auditoria básica · entidades canônicas do piloto, incluindo Legal Process e Legal Deadline · Monday somente leitura · listagem, busca local do módulo, filtros · detalhe · responsável · prazo com origem · próxima ação · histórico.

**Fica fora:** escrita em qualquer sistema externo · automações críticas · IA como requisito de homologação do MVP técnico inicial (quando implementada posteriormente, inicia pelos níveis 0–2; níveis 3 e 4 permanecem fora) · Governança Financeira com dados reais · views 360 completas · módulo de Consórcio · relatórios avançados · fuzzy matching · data contracts · event bus.

## 23. Piloto

**Processos Jurídicos.** Exercita o caminho completo da arquitetura — Legal Process, Legal Deadline com origem, responsável, documento relacionado, agenda, atenção e relatório — e é onde o erro custa mais caro. Chamados TI seria mais simples, mas valida pouco. Integrações do piloto: Monday em leitura como conector obrigatório; Google Drive como referência documental quando houver fonte disponível; Google Calendar como integração opcional de visualização de compromissos. O Google Calendar não é fonte do prazo jurídico e o MVP não calcula prazo processual automaticamente.

## 24. Roadmap

| Fase | Escopo |
|---|---|
| 0 Fundação | Repositório, ambientes, configuração, segurança, auth, permissões, design system, observabilidade básica |
| 1 Core de dados | Entidades base, IDs, relacionamentos, auditoria, source metadata |
| 2 Piloto | Processos Jurídicos + slices mínimos de Agenda/Atenção necessários ao piloto |
| 3 Views transversais | Generalização de Atenção, Agenda, Pendências e Busca Global para toda a plataforma |
| 4 Executivo | Centro de Comando, Minha Semana, Decisões, Riscos, Projetos |
| 5 Demais ambientes | Jurídico completo, TI, VELKOR |
| 6 Integrações | CV, Sienge, plataformas, Clicksign |
| 7 IA | Contextual |
| 8 Automações | Controladas |

**Sprint 1 (fundacional):** repositório e ambientes de execução · autenticação e sessões · design system e shell de navegação · modelo de permissões e escopo · infraestrutura de auditoria · esqueleto das entidades do piloto. Não começa por IA nem por dashboard.

**Sprint 2 (piloto):** Legal Process + Legal Deadline com listagem, filtros, detalhe e histórico · responsável, prazo com origem, próxima ação · leitura do Monday · Documento referenciado · slice mínimo de Agenda/Atenção consumindo o mesmo Legal Deadline · Google Calendar opcional apenas como visualização de compromissos autorizados, nunca como fonte do prazo · testes de permissão.

Sem estimativas de tempo nem story points — não há dados para isso.

## 25. Backlog por Épicos

| Épico | Objetivo | Depende de |
|---|---|---|
| Foundation | Repositório, ambientes, configuração, observabilidade | — |
| Security & Permissions | Auth, MFA, RBAC, escopos, secrets | Foundation |
| Design System | Tokens, componentes, tabelas, estados, acessibilidade | Foundation |
| Data Core | Entidades canônicas, External Identity, source metadata, auditoria | Security & Permissions |
| Legal (piloto) | Processos, Legal Deadlines, documentos referenciados e slices mínimos de Agenda/Atenção | Data Core |
| Transverse Views | Atenção, Agenda, Pendências, Busca | Data Core |
| Executive | Centro de Comando, Minha Semana, Decisões, Riscos | Transverse Views |
| IT | Chamados, sistemas, licenças, ativos | Data Core |
| VELKOR | Soluções, Seguros, implantações | Data Core |
| Governance | Compliance, dados, indicadores, relatórios | Data Core |
| Integration Foundation + Pilot Connectors | Base de conectores + Monday obrigatório no piloto; Drive/Calendar conforme disponibilidade | Data Core |
| Expanded Integrations | CV, Sienge, plataformas financeiras, Clicksign e demais conectores por onda | Integration Foundation + Pilot Connectors homologado |
| AI | Core contextual, permission-aware, grounded | Security & Permissions + Data Core + Governance/Data Quality |
| Automations | Automação governada centralmente | Security & Permissions + Data Core + Governance + Integration Foundation + Pilot Connectors; AI somente quando o caso de uso usar IA |

Cada épico deve ter objetivo, escopo, dependências, critérios de aceite e fora de escopo antes de iniciar.

## 26. P0 / P1 / P2 / P3

**P0 — bloqueia desenvolvimento seguro ou correto:** mesma entidade modelada duas vezes · central como source of truth · quebra de segregação entre empresas/SPEs · módulo duplicando CRM/ERP · contrato, cliente ou unidade duplicados · duas definições do mesmo KPI · view executiva com cálculo próprio · IA com permissão maior que a usuária · source of truth indefinido para dado crítico dentro do escopo da funcionalidade/go-live que dele depende · rota duplicada criando registros concorrentes · **autorização implementada apenas no front-end ou falha de object-level authorization/IDOR/BOLA** · Financeiro COEVO confundido com VELKOR Finance · dado indisponível transformado em zero · falha de fonte apagando o último dado válido · merge apagando histórico · CPF/CNPJ sobrescrito · sincronização sobrescrevendo campo de fonte oficial · pagamento duplicado ou para beneficiário incorreto · conta bancária exposta · contrato apresentado como assinado sem assinatura válida · aditivo sobrescrevendo original · evidência restrita exposta · exceção crítica sem aprovação · IA executando qualquer ação da lista de proibições · prazo jurídico crítico incorreto, duplicado, sem origem, perdido ou sobrescrito · segredo/token de integração exposto no front-end, browser, `localStorage` ou `sessionStorage`.

**P1 — antes da produção daquela frente:** owner ausente · mapping CV/Sienge incompleto · conflito pendente · freshness atrasada · definição ambígua · fonte transitória sem plano de saída · contrato sem owner · renovação próxima sem análise · obrigação sem responsável · política com revisão vencida · controle sem teste · menu excessivo · view redundante · termo inconsistente · dependência circular.

**P2:** dashboards adicionais · relatórios · templates · automações informativas · data contracts · impact analysis gráfico · UX de merge avançada · campanhas de antecipação.

**P3:** matching probabilístico · entity resolution avançado · observabilidade preditiva · agentes executores · escrita financeira · escrita comercial no CV · continuous controls monitoring.

## 27. Decision Backlog

| Questão | Impacto | Alternativas | Responsável | Quando | Bloqueia |
|---|---|---|---|---|---|
| Fonte/origem do Legal Deadline por tipo de processo/board no piloto | Prazo jurídico e Agenda | Campo validado do Monday · registro autorizado na Patrono · outra fonte jurídica homologada | Negócio + Jurídico + TI | Antes do Sprint 2 | Piloto jurídico / Legal Deadline |
| Fonte oficial de CPF/CNPJ | Matching, dedup, snapshot | CV · Sienge · Patrono com validação | Negócio | Antes de implementar matching/deduplicação definitiva ou fluxo que dependa de CPF/CNPJ | Cadastro Mestre, views 360 e snapshots dependentes |
| Data owner por domínio | Sem owner, nenhum campo crítico tem responsável | Por área ou por domínio | Negócio | Fase 1 | Governança de dados |
| Fonte oficial do contato do cliente | Divergência CV × Sienge | CV · Sienge · por tipo | Negócio | Fase 2 | Resolução de divergências |
| Plano de saída de cada board Monday | Fonte transitória virando permanente | Por board, com data | Negócio + TI | Fase 6 | Desativação de fonte |
| Módulos e endpoints do Sienge disponíveis | Escopo financeiro | Levantamento técnico | TI | Antes da Fase 6 | Governança Financeira |
| Expectativa de freshness por fonte | Define "atrasado" | Por fonte e domínio | Negócio + TI | Fase 6 | Observabilidade |
| Stack, hospedagem, banco | Base técnica | Boas práticas | Engenharia | Início da Fase 0 | Não bloqueia decisão de negócio; deve estar definido antes da implementação estrutural |
| Provedor de autenticação e MFA | Segurança | Boas práticas | Engenharia | Início da Fase 0 | Não bloqueia decisão de negócio; deve estar definido antes da implementação de autenticação |
| Fornecedor de IA | Camada de IA | Boas práticas + política de dados | Engenharia + Compliance | Fase 7 | Nada no MVP |

## 28. Critérios de Aceite Globais

- Nenhum registro de negócio criado dentro de central ou view.
- Toda entidade canônica com ID Patrono e identidade estável; empresa/SPE, owner, status, histórico e auditoria são exigidos quando aplicáveis à natureza e criticidade da entidade.
- Todo dado externo com External Identity e metadados de fonte (sistema, última atualização, última tentativa, status).
- Nenhum null convertido em zero; nenhum parcial apresentado como total.
- Toda ação crítica auditada com before/after.
- Todo acesso validado por ambiente, empresa/SPE, módulo, registro, campo e ação — inclusive por URL direta, busca e IA.
- Todo KPI rastreável até os campos de origem.
- Mesma condição visível em todas as views que a exibem (prazo, pendência, decisão, risco).

## 29. Checklist Claude Code

**Antes de codificar:** ler este documento · ler os P0 (§26) · ler o Decision Backlog (§27) · confirmar o piloto (§23) · confirmar as fontes (§9).
**Durante:** seguir as entidades canônicas (§6) · não duplicar entidade nem fonte · preservar permissões com autorização server-side em toda operação · testar object-level authorization · adicionar auditoria nas ações críticas · tratar source down preservando último valor válido com status de stale/parcial quando aplicável · nunca converter null em zero · escrever testes.
**Antes do PR:** lint · typecheck · testes · verificação de segurança · testes de permissão · responsividade · acessibilidade.
**Antes do merge:** review · QA · critérios de aceite · nenhum P0 novo.
**Conflito com a especificação:** registrar em `DECISIONS.md`; não improvisar regra crítica. Microdecisões técnicas reversíveis não param o desenvolvimento.

## 30. Checklist QA

**QA obrigatório do MVP/Piloto Jurídico (10 casos end-to-end):**
1. Usuário sem acesso tenta registro jurídico → bloqueio server-side com mensagem de permissão, nunca erro técnico.
2. Prazo jurídico vence → aparece em Processo, Agenda e Atenção como o mesmo registro.
3. Fonte indisponível → último dado válido é preservado com status stale/Parcial/Indisponível; nenhuma view mostra zero ou apaga o valor anterior.
4. Exportação de dado restrito do escopo piloto → negada e auditada quando a exportação existir no release; se a funcionalidade não existir, registrar N/A com justificativa sem bloquear a homologação.
5. Legal Deadline alterado → histórico preservado; prazo anterior não é sobrescrito.
6. Legal Deadline suspenso → não é exibido como vencimento comum; motivo/estado preservado.
7. Dois prazos no mesmo processo → coexistem como registros distintos; nenhum sobrescreve o outro.
8. Prazo sem origem identificada → bloqueado para homologação ou sinalizado como inconsistência crítica conforme regra.
9. Falha do Monday → não apaga nem altera o último prazo válido conhecido.
10. Inspeção do front-end/storage + chamada direta a endpoint/ID → nenhum token/segredo exposto e nenhuma operação autorizada apenas pelo front-end.

**Catálogo global de regressão — obrigatório apenas quando a funcionalidade correspondente entrar no release:**
- Cliente do CV já existe no Sienge → match proposto; nenhuma mesclagem automática.
- Venda com contrato e financeiro divergentes → divergência exibida; nada sobrescrito.
- Projeto TI com decisão pendente → Decision única em Projeto e Centro de Comando.
- Contrato recebe aditivo → original preservado; condições vigentes derivadas.
- Documento recebe nova versão → versão oficial só muda por regra, não por último upload.
- Pagamento na plataforma e no Sienge → dois eventos relacionados a uma obrigação; valor não duplicado.
- IA recebe pergunta sobre dado sem permissão → recusa sem revelar conteúdo nem existência.
- Automação fora de alçada → bloqueada e registrada.
- VELKOR Soluções tenta acessar Seguros → bloqueado no backend.
- Usuário de uma SPE tenta acessar registro de outra SPE → bloqueado no backend.
- Usuário sem permissão financeira tenta acessar dados financeiros → bloqueado no backend.

**Dados do release:** dedup · lineage · mapping · null · partial · conflict · source down · outdated · versão de fórmula · snapshots — somente para os componentes presentes no release.
**UX do release:** desktop · notebook · tablet · mobile · teclado · focus · screenreader · contraste — para as telas entregues no release.

## 31. Checklist Segurança

auth e sessões · MFA para perfis privilegiados · secrets fora do código · service account por finalidade · menor privilégio nos conectores · validação de upload · exportação restrita e auditada · logs sem dado bancário completo · IA sem permissão além da usuária · automação dentro de alçada · revogação de sessão/usuário/credencial testada · plano mínimo de resposta a incidentes · retenção/hold definidos para o escopo · backup e restauração testados. Nenhum destes controles é movido para fase futura quando aplicável ao escopo de produção.

## 32. Checklist de Homologação

A homologação é **por release e pelo escopo efetivamente entregue**. Funcionalidades deliberadamente fora do MVP não bloqueiam a homologação do piloto e passam a exigir seus testes quando entrarem em um release posterior.

- Piloto executado com registros reais do Monday em leitura por conector server-side seguro; Google Drive validado quando utilizado; Google Calendar validado apenas se ativado no piloto.
- Todos os testes de permissão obrigatórios do MVP/Piloto Jurídico (§11) aprovados.
- Todos os casos de QA obrigatórios do MVP/Piloto Jurídico (§30) aprovados.
- Casos do Catálogo Global de Regressão executados somente para funcionalidades presentes no release.
- Estados de dados do §18 verificados em todas as views do release.
- Auditoria consultável para toda ação crítica realizada na homologação.
- Dados demonstrativos identificados e separados.
- Checklist de Segurança aplicável ao release concluído sem bloqueios.
- Aceite formal da gestora e dos responsáveis de negócio da frente liberada; no piloto jurídico, Gestora + Jurídico.

## 33. Go-Live Gate

O Go-Live Gate é avaliado **por release e pelo escopo efetivamente disponibilizado**. Um requisito de funcionalidade futura não bloqueia um release que não a expõe; qualquer P0 do escopo liberado bloqueia o go-live.

1. Nenhum P0 aberto no escopo do release.
2. Permissões testadas por ambiente, empresa e SPE.
3. Source of truth definido para todo dado crítico do escopo.
4. Auditoria ativa nas ações críticas.
5. Source down tratado em todas as views.
6. Dados demonstrativos identificados e separados.
7. Acessibilidade auditada.
8. Backup e restauração testados.
9. Documentação atualizada junto ao código.
10. Revogação de sessão, usuário e credencial de integração testada.
11. Plano mínimo de resposta a incidente de segurança/privacidade homologado.
12. Política mínima de retenção/hold definida para os dados e documentos do escopo de produção.
13. Nenhum segredo/token presente em front-end, browser, `localStorage` ou `sessionStorage`; conectores críticos usando execução server-side segura.
14. QA, Segurança e Homologação aplicáveis ao release concluídos e aprovados, sem bloqueios abertos.

---

## Anexo A — Regras Globais Não Negociáveis

1. Um registro → múltiplas views.
2. Missing ≠ zero.
3. Falha de fonte ≠ ausência de dado.
4. Risco ≠ Fato ≠ Alerta.
5. Decisão ≠ Aprovação ≠ Tarefa.
6. Regra de negócio ≠ Tarefa.
7. Projeto ≠ Tarefa.
8. Pessoa ≠ Usuário.
9. Contrato ≠ Documento.
10. Pagamento ≠ Baixa ERP.
11. Dashboard ≠ Fonte.
12. IA não decide ações críticas autonomamente.
13. Autorização de segurança é server-side; esconder UI nunca concede nem substitui permissão.
14. Falha de fonte preserva o último dado válido com status e timestamp; nunca apaga nem converte em zero.

## Anexo B — Mapa Semântico

Status (situação no domínio; nunca universal) · Prioridade (ordem de atendimento) · Criticidade (relevância intrínseca) · Urgência (pressão temporal) · Risco (possibilidade futura) · Saúde (comportamento do fluxo) · Prazo (data-limite com origem) · Pendência (condição derivada) · Bloqueio (impedimento com responsável) · Atenção (sinal que merece leitura) · Alerta (sinal que exige ação) · Decisão (escolha registrada) · Aprovação (ato formal em alçada).

## Anexo C — Estrutura de Documentação no Repositório

```
/docs
  MASTER_HANDOFF.md      ← este documento
  ARCHITECTURE.md
  DATA_MODEL.md
  PERMISSIONS.md
  INTEGRATIONS.md
  AI_GOVERNANCE.md
  SECURITY.md
  DECISIONS.md           ← decision backlog + ADRs relevantes
  QA.md
README.md                ← aponta para MASTER_HANDOFF.md
```

Atualizar a documentação junto ao código quando a arquitetura mudar. Mudança estrutural atualiza documentação, arquitetura, testes, permissões e análise de impacto. Modelo canônico não muda em produção sem plano.

## Anexo D — Matriz de Prontidão da Especificação

| Área | Situação da especificação | Motivo |
|---|---|---|
| Produto | Pronta | Escopo, fronteiras e não objetivos definidos |
| UX | Pronta | Design system, navegação, estados e acessibilidade consolidados |
| Dados | Parcial | CPF/CNPJ sem fonte; owners não nomeados |
| Segurança | Pronta | RBAC, escopos, auditoria e controles P0 definidos |
| Integrações | Parcial | Módulos e API do Sienge não confirmados |
| Jurídico | Parcial | Estrutura do piloto especificada; fonte/origem do Legal Deadline por tipo de processo/board deve ser homologada antes do Sprint 2 |
| TI | Pronta | Entidades e fluxos definidos |
| VELKOR | Parcial | Correspondente e Finance em implantação; Consórcio sem evidência |
| IA | Parcial | Níveis 0–2 prontos; nível 3 depende de dados em produção |
| QA | Pronta | Casos funcionais, de dados e de UX definidos |

## Alterações da Versão 1.2

Correções consolidadas após duas auditorias críticas do Handoff Master:
- Mantidas todas as correções da v1.1: Canonical Identity vs Field-Level Source of Truth; Legal Deadline; P0 por escopo; Monday transitório; Google Calendar não autoritativo para prazo; separação repositório/Clicksign; Record Owner vs Data Owner; IA fora do MVP técnico; revogação, incident response e retenção/hold; decisões técnicas da Fase 0.
- Segredos/tokens de integração passam a ser P0 explícito: nenhum segredo no front-end, browser, `localStorage` ou `sessionStorage`; Monday e conectores críticos usam execução server-side segura.
- Legal Deadline reforçado como P0 quando incorreto, duplicado, sem origem, perdido ou sobrescrito; QA ampliado com cenários específicos de prazo.
- Source of Truth passou a ser lido por escopo/domínio/empresa; regras COEVO/CV não se estendem automaticamente à VELKOR.
- Comissão com origem CV limitada ao contexto de venda imobiliária COEVO.
- `Agenda Item` diferenciado da Agenda temporal e `Notification` jurídica diferenciado de notificações de sistema/UI.
- Fase 2 passa a conter slices mínimos de Agenda/Atenção do piloto; Fase 3 generaliza as centrais e a Busca Global.
- Busca do MVP explicitamente local ao módulo piloto.
- Integrações separadas em Foundation/Pilot Connectors e Expanded Integrations.
- Homologação atualizada para 18 casos funcionais e validação explícita do conector server-side do Monday.
- Navegação final marcada como target-state com feature flags/lifecycle para módulos futuros.
- Matriz de prontidão renomeada para prontidão da especificação.
- Regra de campos comuns das entidades flexibilizada conforme natureza/criticidade.
- Azul proibido apenas como cor de marca/estrutura; uso semântico depende do Design System.

## Alterações da Versão 1.3

Correções finais após a terceira auditoria crítica:
- Homologação e Go-Live passaram a ser avaliados por **release/escopo**, evitando que funcionalidades deliberadamente futuras bloqueiem o MVP.
- QA separado entre **10 casos obrigatórios do MVP/Piloto Jurídico** e **Catálogo Global de Regressão** ativado conforme cada frente entra em release.
- Testes de permissão separados por escopo, com conjunto mínimo obrigatório do piloto jurídico.
- Autorização **server-side** tornou-se requisito explícito e P0; esconder menu/botão é apenas UX. Incluídos object-level authorization e prevenção de IDOR/BOLA.
- Falha de fonte passa a preservar globalmente o último dado válido, com status stale/Parcial/Indisponível e timestamps.
- `Policy` reservado a Política Corporativa; apólice usa `InsurancePolicy`/`InsuranceContract`.
- Dependências de IA e automações corrigidas: automação determinística não depende de IA; AI depende de Security/Permissions + Data Core + Governance/Data Quality.
- Go-Live Gate exige explicitamente QA, Segurança e Homologação do release concluídos sem bloqueios.

## Recomendação Final

**Sim — versão 1.3 aprovada para handoff ao Claude Code e apta para início controlado de desenvolvimento das Fases 0, 1 e do piloto jurídico, respeitando os gates por release/escopo.** As decisões de negócio pendentes sobre fonte/origem do Legal Deadline, CPF/CNPJ, contato do cliente, data owners e plano de saída do Monday bloqueiam somente as funcionalidades que dependem diretamente delas. A fonte/origem do Legal Deadline deve estar homologada antes do Sprint 2. O levantamento técnico do Sienge permanece obrigatório antes da Fase 6. Views 360 completas, Governança Financeira com dados reais, IA e automações avançadas permanecem bloqueadas até suas dependências estarem homologadas.
