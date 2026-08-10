# Homologação e compliance

Cada entrega deve registrar: requisito, regra de compliance aplicada, versão, resultado, evidência, responsável humano, ressalvas, exceções, plano de tratamento, aprovador e prazo.

Gate de publicação: qualquer resultado crítico em não conformidade bloqueia publicação, exportação, integração, automação ou operação afetada. A exceção precisa de justificativa, risco aceito, aprovador autorizado, medida compensatória e validade; o agente não aprova sua própria exceção.

## Cenários mínimos

1. perfil sem escopo tenta ler orçamento de outra área e recebe 403;
2. escrita cria auditoria com antes/depois e correlation ID;
3. saldo usa `orçado - realizado - comprometido` sem dupla contagem;
4. apresentação para Diretoria com classificação compartilhável é bloqueada;
5. layout funciona em 320 px e por teclado;
6. reprocessamento de importação mantém histórico e não duplica origem.
