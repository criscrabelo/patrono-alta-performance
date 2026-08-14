---
name: ata-instituicao-condominio
description: Analisa e elabora Atas de Assembleia de Instituição de Condomínio (edilício, de lotes ou empreendimento imobiliário), entregando o documento final em formato Word (.docx) pronto para assinatura e registro em cartório. Use esta skill sempre que o usuário pedir para redigir, revisar, corrigir ou analisar uma ata de assembleia de instituição/constituição de condomínio, convenção de condomínio, ata de constituição de empreendimento, ou minutas relacionadas — mesmo que ele não use exatamente esses termos (ex: "ata do condomínio", "assembleia de instituição", "documento de constituição do empreendimento").
---

# Ata de Assembleia de Instituição de Condomínio

## Quando usar

Use esta skill em dois cenários:

1. **Elaboração**: o usuário fornece os dados do empreendimento (incorporador, unidades, fração ideal, etc.) e pede para redigir a ata do zero.
2. **Análise/Revisão**: o usuário envia uma minuta ou ata já redigida e pede para revisar, apontar riscos, inconsistências jurídicas ou sugerir ajustes antes da assinatura/registro.

Em ambos os casos, o entregável final é um documento **.docx**. Para gerar ou editar o arquivo Word, siga a skill `docx` deste ambiente — ela cobre formatação, estilos e geração do arquivo final. Use esta skill (`ata-instituicao-condominio`) para o **conteúdo jurídico e a estrutura** do documento; use `docx` para a **mecânica de criação do arquivo**.

## Por que isso importa

Uma ata de instituição de condomínio é o documento que dá nascimento jurídico ao condomínio: ela é levada a registro no Cartório de Registro de Imóveis e, a partir daali, vincula todos os futuros condôminos às regras nela estabelecidas. Erros de forma (ausência de assinatura, numeração de matrícula errada, fração ideal que não soma 100%) podem travar o registro; erros de conteúdo (cláusulas conflitantes com a convenção, omissão de áreas comuns) geram litígio anos depois. Por isso a precisão factual e a coerência interna do documento pesam mais do que a fluidez do texto.

## Passo 1 — Reunir as informações essenciais

Antes de redigir ou finalizar a análise, confirme que você tem (ou pergunte ao usuário) os seguintes dados. Não invente informação faltante — pergunte, ou marque com destaque tipo `[A CONFIRMAR: ...]` no rascunho.

**Sobre o empreendimento:**
- Nome/denominação do condomínio e endereço completo
- Matrícula do imóvel no Registro de Imóveis (número e cartório)
- Memorial de incorporação (número de registro, se houver)
- Descrição das unidades autônomas (quantidade, tipos, metragens)
- Fração ideal de cada unidade no terreno/áreas comuns (deve somar 100%)
- Descrição das áreas comuns (de uso comum geral e eventualmente de uso comum específico)

**Sobre as partes:**
- Incorporador/instituidor (qualificação completa: nome/razão social, CPF/CNPJ, endereço)
- Se houver assembleia de condôminos (e não apenas instituição unilateral pelo incorporador): lista de presentes, representações por procuração, quórum

**Sobre a formalização:**
- Data e local da assembleia/ato
- Regras de convocação observadas (se assembleia) e quórum exigido
- Se a convenção de condomínio será anexada/aprovada no mesmo ato ou em documento separado

## Passo 2 — Elaborar a ata (cenário de redação)

Estruture o documento segundo este roteiro (adapte a ordem conforme o padrão que a Coevo já usa, se houver modelo de referência anexado):

1. **Cabeçalho**: título ("Ata de Assembleia de Instituição de Condomínio" ou "Ata de Instituição de Condomínio"), identificação do empreendimento, data e local.
2. **Preâmbulo**: quem convocou, base legal da convocação (se assembleia), verificação de quórum, composição da mesa (presidente e secretário da assembleia), se aplicável.
3. **Deliberações**: cada deliberação numerada, na ordem em que aparecem na convocação/pauta. Tipicamente:
   - Instituição do condomínio sobre o imóvel descrito (com referência à matrícula e ao memorial de incorporação)
   - Discriminação e especificação das unidades autônomas e respectivas frações ideais
   - Aprovação da convenção de condomínio (se anexada) e do regimento interno, se houver
   - Eleição do síndico/administrador provisório (se pertinente nesta fase)
   - Autorização para prática dos atos necessários ao registro
4. **Fecho**: encerramento, lavratura e assinatura dos presentes (ou do instituidor, se ato unilateral), com espaço para testemunhas se exigido.
5. **Anexos** (referenciados, não necessariamente redigidos aqui): convenção de condomínio, memorial de incorporação, planta/quadro de áreas.

Use linguagem formal-jurídica, mas evite juridiquês vazio — cada cláusula deve ser localizável e conferível contra os dados do Passo 1. Numere parágrafos/cláusulas para facilitar referência cruzada e eventual retificação futura.

## Passo 3 — Analisar uma minuta existente (cenário de revisão)

Ao revisar uma ata/minuta fornecida pelo usuário, verifique nesta ordem — pare e reporte assim que encontrar algo relevante, não é preciso esperar terminar tudo para começar a sinalizar:

1. **Consistência numérica**: as frações ideais somam 100%? A soma das áreas privativas + comuns corresponde à área total do terreno/matrícula?
2. **Consistência de identidade**: os dados do incorporador/condôminos na ata coincidem com os do memorial de incorporação e da matrícula citados?
3. **Completude formal**: há campos em branco, referências a anexos que não constam, ou cláusulas que remetem a "conforme disposto no artigo X da convenção" sem que a convenção esteja de fato anexada?
4. **Coerência com a legislação de condomínios** (Lei 4.591/64 e Código Civil arts. 1.331 e seguintes): a ata cobre os elementos obrigatórios da instituição (descrição do imóvel, discriminação das unidades, fração ideal, destinação das unidades)?
5. **Riscos de registro**: cláusulas que costumam gerar exigência do cartório (ex: fração ideal incompatível com o memorial, ausência de assinatura de todos os instituidores/condôminos necessários).

Entregue a análise como uma lista de apontamentos, cada um com: **trecho/cláusula afetada → problema → sugestão de correção**. Se o usuário pedir para já corrigir, aplique as correções na minuta e gere o .docx revisado, destacando o que foi alterado.

## Passo 4 — Gerar o arquivo Word final

Depois que o conteúdo estiver definido (redigido ou corrigido), gere o arquivo `.docx` seguindo a skill `docx`. Pontos específicos deste tipo de documento:
- Papel timbrado/cabeçalho da Coevo, se houver modelo de referência
- Numeração de cláusulas/parágrafos preservada na formatação (não apenas no texto corrido)
- Espaço reservado para assinaturas de todos os instituidores/condôminos e, se exigido, testemunhas, com linha e campo para nome/CPF abaixo de cada assinatura
- Nome do arquivo sugerido: `Ata de Instituicao - [Nome do Empreendimento] - [AAAA-MM-DD].docx`

Ao final, confirme com o usuário se algum dado ficou marcado como `[A CONFIRMAR]` antes de considerar o documento pronto para registro.
