# AI_GOVERNANCE.md — Governança de IA

> Regras oficiais: `docs/MASTER_HANDOFF.md` §13 (Patrono IA), §22 (MVP), §26 (P0).

## Situação nesta execução: IA não implementada — por decisão explícita, não por omissão

O Handoff Master v1.3 é explícito: "IA não é requisito para homologação do MVP técnico inicial" (§13) e
o roadmap (§24) coloca "7 IA" depois de Fundação, Core de Dados, Piloto e Views Transversais. A
instrução desta execução também foi explícita: "Não quero IA... Não comece por IA." Portanto, **nenhum
código, endpoint, agente ou integração de IA foi criado nesta execução.**

## Regras que qualquer implementação futura de IA deverá respeitar (registradas aqui para referência)

- Core único; experiência contextual por módulo/registro/central/busca — nunca um chat isolado como
  único acesso.
- Níveis de autonomia 0 (Consulta) a 4 (Execução controlada); apenas 0–2 são autorizáveis quando a IA for
  implementada; níveis 3 e 4 ficam fora do MVP.
- Toda resposta deve trazer evidência + fonte + limitação. Fonte indisponível → "Não foi possível
  confirmar na fonte", nunca uma afirmação como "pagamento não realizado".
- **Proibições absolutas (violação = P0):** pagar, assinar, aprovar, aceitar risco, publicar, alterar
  permissão, distratar, cancelar venda, alterar preço, transferir dinheiro, conceder acesso, mesclar
  registro, alterar source of truth, resolver conflito, declarar conformidade definitiva.
- IA nunca tem permissão maior que a do usuário que a invoca — respeita o mesmo RBAC/escopo de
  `docs/PERMISSIONS.md`.
- Dependências antes de qualquer IA entrar em produção: Security & Permissions + Data Core +
  Governance/Data Quality (§25, épico "AI").

## Quando a IA for implementada (fora deste Sprint 1)

A fundação de permissões (`docs/PERMISSIONS.md`) e o Data Core mínimo (`docs/DATA_MODEL.md`) desta
execução são pré-requisitos diretos listados no épico "AI" do backlog (§25) — nenhuma ação adicional de
preparação de IA foi tomada além de garantir que essas dependências existam.
