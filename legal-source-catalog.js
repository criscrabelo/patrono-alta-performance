// Catálogo único de fontes jurídicas do Monday (docs/DEMO_DEPLOY.md — rodada de integração completa do
// workspace "Jurídico", Monday workspace id 1678965). Fonte única de verdade para: MONDAY_BOARDS
// (server.js), o menu Jurídico e a lista de módulos (public/app.js), e os widgets do Dashboard
// (dashboard-service.js) — nenhum desses lugares deve mais hardcodar uma lista de boards separada.
//
// Cada entrada: { key, label, category, mondayBoardId, envVar, enabled, sourceType, readOnly }.
// - `key`: identificador técnico único, usado como chave de MONDAY_BOARDS/coleção local/módulo de menu.
// - `envVar`: nome da variável de ambiente que pode sobrescrever o board id (só nos 7 boards que já
//   tinham essa sobrescrita antes desta rodada — os novos não ganham override próprio, para não repetir
//   o mesmo erro de "explosão de configuração" já evitado em outras rodadas deste projeto).
// - `enabled`: false só para a duplicata explicitamente ignorada nesta rodada (ver item 2 do escopo).
// - `sourceType`: sempre 'monday' nesta rodada — campo existe para permitir, no futuro, uma fonte que
//   não seja Monday sem precisar de uma segunda arquitetura paralela.
// - `readOnly`: sempre true — nenhuma escrita de volta ao Monday existe neste projeto.
const LEGAL_SOURCE_CATALOG = Object.freeze([
  // 01 · Apoio Administrativo
  { key: 'pesquisas', label: 'Pesquisas', category: 'Apoio Administrativo', mondayBoardId: '9535379620', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'acessos', label: 'Acessos', category: 'Apoio Administrativo', mondayBoardId: '7377724937', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'contasAPagar', label: 'Contas a Pagar', category: 'Apoio Administrativo', mondayBoardId: '5876625743', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'pesquisasVitor', label: 'Pesquisas Vitor', category: 'Apoio Administrativo', mondayBoardId: '8352118420', enabled: true, sourceType: 'monday', readOnly: true },

  // 02 · Entrega de Chaves
  { key: 'unidades', label: 'Entrega de Chaves — Carpe Diem', category: 'Entrega de Chaves', mondayBoardId: '18410779605', envVar: 'MONDAY_BOARD_UNIDADES', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'entregaChavesVitaVillage', label: 'Entrega de Chaves — Vita Village', category: 'Entrega de Chaves', mondayBoardId: '6012535974', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'entregaChavesAurora', label: 'Entrega de Chaves — Aurora Residence', category: 'Entrega de Chaves', mondayBoardId: '6689135722', enabled: true, sourceType: 'monday', readOnly: true },
  // Duplicata explícita (item 2 do escopo): nunca sincronizada nesta rodada — sem conteúdo exclusivo
  // identificado que justifique preservá-la separadamente do board principal acima.
  { key: 'entregaChavesCarpeDienDuplicata', label: 'Duplicata — Entrega de Chaves Carpe Diem', category: 'Entrega de Chaves', mondayBoardId: '18428261720', enabled: false, sourceType: 'monday', readOnly: true },

  // 03 · Clientes
  { key: 'compraVenda', label: 'Contratos para Clientes / Compra e Venda', category: 'Clientes', mondayBoardId: '5821473011', envVar: 'MONDAY_BOARD_COMPRA_VENDA', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'retomadas', label: 'Retomadas', category: 'Clientes', mondayBoardId: '18413057491', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'protestos', label: 'Protestos', category: 'Clientes', mondayBoardId: '7787216106', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'honorarios', label: 'Honorários Extrajudiciais', category: 'Clientes', mondayBoardId: '7231876117', envVar: 'MONDAY_BOARD_HONORARIOS', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'distratos', label: 'Distratos e Desistências', category: 'Clientes', mondayBoardId: '18404493605', envVar: 'MONDAY_BOARD_DISTRATOS', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'cessaoDireitosBellaVida', label: 'Bella Vida — Cessão de Direitos de Inadimplência', category: 'Clientes', mondayBoardId: '6157336222', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'transferenciaIntermediaria', label: 'Transferência Intermediada', category: 'Clientes', mondayBoardId: '6149480325', envVar: 'MONDAY_BOARD_TRANSFERENCIA_INTERMEDIARIA', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'personalizacao', label: 'Personalização', category: 'Clientes', mondayBoardId: '6035477812', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'notificacoes', label: 'Notificações Clientes', category: 'Clientes', mondayBoardId: '5630368737', envVar: 'MONDAY_BOARD_NOTIFICACOES', enabled: true, sourceType: 'monday', readOnly: true },

  // 04 · Empresas (Contratos e Empresas)
  { key: 'alteracoesConvencoes', label: 'Alterações Convenções de Condomínio', category: 'Contratos e Empresas', mondayBoardId: '9099172459', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'contratoScpSpe', label: 'Contrato de SCP/SPE', category: 'Contratos e Empresas', mondayBoardId: '5800443639', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'analiseJuridica', label: 'Análise Jurídica', category: 'Contratos e Empresas', mondayBoardId: '5877009296', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'contratosPrestadoresServico', label: 'Controle Contratos Prestadores de Serviço', category: 'Contratos e Empresas', mondayBoardId: '7602547683', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'acompanhamentoCartorioPrefeitura', label: 'Acompanhamento de Cartório e Prefeitura', category: 'Contratos e Empresas', mondayBoardId: '5831481667', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'notificacoesEmpresariais', label: 'Notificações (Empresas)', category: 'Contratos e Empresas', mondayBoardId: '6814664713', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'rocsil', label: 'Rocsil', category: 'Contratos e Empresas', mondayBoardId: '9775979756', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'fglassTetusLocacao', label: 'FGlass e Tetus Locação', category: 'Contratos e Empresas', mondayBoardId: '4957387842', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'admContratosPrestadores', label: 'ADM — Contratos Prestadores de Serviços', category: 'Contratos e Empresas', mondayBoardId: '8734722297', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'obraContratoPrestacaoServico', label: 'Obra — Contrato de Prestação de Serviço', category: 'Contratos e Empresas', mondayBoardId: '5800267760', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'propostaTerreno', label: 'Proposta de Terreno', category: 'Contratos e Empresas', mondayBoardId: '5800554561', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'procuracoes', label: 'Procurações', category: 'Contratos e Empresas', mondayBoardId: '6022129654', enabled: true, sourceType: 'monday', readOnly: true },

  // 05 · Jurídico (Processos)
  { key: 'processos', label: 'Processos Judiciais', category: 'Processos', mondayBoardId: '5959705266', envVar: 'MONDAY_BOARD_PROCESSOS', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'boletimOcorrencia', label: 'Boletim de Ocorrência', category: 'Processos', mondayBoardId: '18378845322', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'audiencias', label: 'Audiências', category: 'Processos', mondayBoardId: '18422526820', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'processosParceiros', label: 'Acompanhamento Processos de Parceiros', category: 'Processos', mondayBoardId: '6342187473', enabled: true, sourceType: 'monday', readOnly: true },
  { key: 'processosAdministrativos', label: 'Processos Administrativos', category: 'Processos', mondayBoardId: '5877003779', enabled: true, sourceType: 'monday', readOnly: true },

  // 06 · Projetos em Implantação
  { key: 'melhoriasNotificacoes', label: 'Melhorias — Notificações Clientes', category: 'Projetos / Melhorias', mondayBoardId: '18427640622', enabled: true, sourceType: 'monday', readOnly: true },

  // 07 · Sócios
  { key: 'socioGilmarArantes', label: 'Gilmar Arantes', category: 'Sócios', mondayBoardId: '8725280592', enabled: true, sourceType: 'monday', readOnly: true }
]);

function enabledMondaySources() {
  return LEGAL_SOURCE_CATALOG.filter(entry => entry.enabled && entry.sourceType === 'monday');
}

module.exports = { LEGAL_SOURCE_CATALOG, enabledMondaySources };
