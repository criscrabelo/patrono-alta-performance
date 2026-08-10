# Matriz inicial de rastreabilidade

| Requisito | Situação | Lacuna/implementação | Prioridade | Critério de aceite | Evidência |
|---|---|---|---|---|---|
| Nome oficial e vocabulário | Implementado | UI e API usam COEVO Alta Performance | P0 | busca sem marca legada nos artefatos públicos | `rg` + revisão de homologação |
| Departamentos e orçamento próprio | Implementado no núcleo | dados seed e migration relacional | P0 | Jurídico e TI têm orçamento e consolidação | `/api/dashboard`, migration |
| Autorização server-side | Implementado no núcleo | RBAC central no `server.js` | P0 | rota protegida nega perfil sem ação | `tests/core.test.js` |
| Auditoria crítica | Implementado no núcleo | evento com antes/depois, motivo, responsável e correlação | P0 | toda criação testada gera evento | `data/store.json` |
| Agenda interna | Implementado no núcleo | CRUD inicial e tela | P1 | evento tem responsável, área, data, prioridade e classificação | `/api/agenda` |
| Comitês e apresentações | Validação preparada | modelo e gate de classificação | P1 | público/tópicos/profundidade auditáveis; PPTX/PDF ainda dependem de biblioteca | `/api/presentations/validate` |
| Compliance transversal | Implementado no núcleo | registro de regra, versão, resultado, evidência, responsável e exceção | P0 | não conformidade crítica bloqueia operação | `/api/compliance` |
| MFA | Contrato preparado | exige provedor de identidade real em homologação | P0 | perfis privilegiados e ações críticas têm segundo fator | evidência do IdP |
| Integrações | Adiado corretamente | contratos definidos, sem dependência do piloto | P2 | sync idempotente e reconciliável | testes de conector |

