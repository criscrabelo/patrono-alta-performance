# Arquitetura recomendada

Monólito modular inicial: frontend responsivo; API versionada; domínios de identidade, governança, agenda, comitês, orçamento, Jurídico e TI; PostgreSQL com migrations reversíveis; armazenamento privado de documentos; fila para exportações e integrações futuras.

O backend é o único ponto de autorização. Cada consulta deve aplicar usuário, papel, departamento, empreendimento, finalidade e classificação antes de retornar dados. Toda escrita crítica gera evento de auditoria com responsável, data, motivo, estado anterior, estado posterior e evidência.

## Contratos futuros

Conectores Monday, Sienge, CV, e-mail, Clicksign, Calendly e Google Agenda entram depois da validação do núcleo. A chave de deduplicação será `origem + tipo + id_externo`, com cursor, retry, reconciliação e preservação dos dois valores em conflito.

## Modelo de apresentação

`committee` define tipo, público, competência, classificação e tópicos. A exportação só pode ocorrer após filtro de escopo e revisão de compliance; mantém versão, checksum, filtros, arquivos e usuário gerador.
