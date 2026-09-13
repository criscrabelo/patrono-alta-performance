// Sprint 2, Hardening H3 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H3-01): resolução segura do
// IP do cliente. `req.headers['x-forwarded-for']` NUNCA é confiado diretamente — um atacante que fala
// com a aplicação sem passar por um proxy pode forjar esse header livremente. A única forma segura de
// usar X-Forwarded-For é combinada com uma política explícita de quantos saltos de proxy confiável
// existem entre o cliente real e este processo (`TRUST_PROXY_HOPS`).
//
// Semântica de `TRUST_PROXY_HOPS` (mesmo modelo do `trust proxy` numérico do Express/nginx):
// - `0` (padrão): nenhum proxy confiável configurado — usa sempre o endereço remoto real da conexão
//   TCP (`req.socket.remoteAddress`), nunca X-Forwarded-For.
// - `N` (N >= 1): existem exatamente N proxies confiáveis na frente desta aplicação. Cada proxy
//   confiável ACRESCENTA uma entrada ao final de X-Forwarded-For (a conexão TCP que este processo
//   enxerga — `req.socket.remoteAddress` — é o N-ésimo/último desses proxies, e não aparece na própria
//   cadeia). O IP do cliente é sempre a entrada `chain.length - 1 - N` (0-indexado) — nunca a primeira
//   entrada da esquerda (que qualquer requisição não autenticada pode forjar livremente), nem a última
//   (que é o próprio proxy confiável mais próximo).
//
// Limitação documentada (inerente a qualquer resolução por header, não específica desta implementação):
// isto só é seguro se a topologia de rede garantir que ESTE PROCESSO só é alcançável através dos N
// proxies configurados (ex.: firewall/security group permitindo apenas o proxy confiável) — nunca
// diretamente pela internet. `TRUST_PROXY_HOPS` sozinho não impede um atacante de burlar um proxy que
// não está de fato na frente da aplicação; a garantia vem da topologia de rede combinada com esta
// política.
const crypto = require('node:crypto');

function readTrustProxyHops() {
  const raw = Number(process.env.TRUST_PROXY_HOPS);
  return Number.isInteger(raw) && raw > 0 ? raw : 0;
}

// Normaliza IPv4-mapped IPv6 (`::ffff:1.2.3.4` → `1.2.3.4`) — a mesma máquina pode aparecer das duas
// formas dependendo da pilha de rede (IPv4 puro vs. dual-stack), e sem normalizar o mesmo cliente real
// contaria como duas identidades diferentes para fins de rate limiting.
function normalizeIp(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const v4Mapped = trimmed.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  return v4Mapped ? v4Mapped[1] : trimmed;
}

function resolveClientIp(req) {
  const direct = normalizeIp(req.socket && req.socket.remoteAddress);
  const hops = readTrustProxyHops();
  if (hops <= 0) return direct;
  const header = req.headers['x-forwarded-for'];
  if (!header) return direct;
  // X-Forwarded-For: cliente, proxy1, proxy2, ..., proxy(N-1) (o N-ésimo proxy, mais próximo deste
  // processo, não se auto-adiciona à cadeia — ele é `req.socket.remoteAddress`). Com N saltos
  // confiáveis configurados, o IP do cliente é a entrada `chain.length - 1 - N` (0-indexado) — nunca a
  // primeira entrada da cadeia, que é exatamente o valor que um atacante sem proxy nenhum poderia
  // inserir à vontade. Uma cadeia mais curta do que o esperado (menos entradas do que `hops` exigiria)
  // nunca inventa um IP — cai para o endereço direto da conexão.
  const chain = String(header).split(',').map(part => normalizeIp(part)).filter(Boolean);
  const index = chain.length - 1 - hops;
  if (index < 0 || index >= chain.length) return direct;
  return chain[index] || direct;
}

// Deriva um identificador estável e não-reversível do IP para uso em chaves de rate limit
// (minimização LGPD — o IP nunca é persistido em texto puro; ver auth/rate-limit.js).
function hashIp(ip, secret) {
  return crypto.createHmac('sha256', secret).update(`ip:${ip || 'desconhecido'}`).digest('hex');
}

module.exports = { resolveClientIp, normalizeIp, hashIp, readTrustProxyHops };
