// Sprint 2, Hardening H3 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H3-01): resolução segura do
// IP do cliente. `req.headers['x-forwarded-for']` NUNCA é confiado diretamente — um atacante que fala
// com a aplicação sem passar por um proxy pode forjar esse header livremente. A única forma segura de
// usar X-Forwarded-For é combinada com uma política explícita de quantos saltos de proxy confiável
// existem entre o cliente real e este processo (`TRUST_PROXY_HOPS`).
//
// CORREÇÃO (revisão técnica pós-PR #14): a fórmula original desta função (`chain.length - 1 - hops`)
// estava desalinhada um salto para a esquerda — e o teste original também partia da mesma premissa
// errada, por isso o CI não pegou o bug. Cada proxy confiável, ao encaminhar a requisição, ACRESCENTA ao
// final de X-Forwarded-For o endereço de quem se conectou A ELE (nunca o próprio endereço) — logo, com N
// proxies confiáveis e nenhuma entrada forjada, a cadeia tem exatamente N entradas (cliente + os N-1
// proxies intermediários; o N-ésimo proxy, o mais próximo desta aplicação, nunca aparece na própria
// cadeia — ele é `req.socket.remoteAddress`). O cliente é sempre a entrada `chain.length - N`
// (0-indexado) — a fórmula certa é SEM o "-1" adicional.
//
// Exemplo (1 proxy confiável): cliente → proxy → aplicação. `remoteAddress` = IP do proxy;
// `X-Forwarded-For: <IP do cliente>` (1 entrada). `chain.length - hops` = `1 - 1` = `0` → `chain[0]`
// = IP do cliente. Um atacante que já chega ao proxy com um X-Forwarded-For pré-forjado
// (`X-Forwarded-For: 9.9.9.9`) não muda o resultado: o proxy ACRESCENTA o IP real observado ao final
// (`9.9.9.9, <IP real>`, 2 entradas), e `chain.length - hops` = `2 - 1` = `1` → a última entrada, o IP
// real — nunca a primeira, forjada.
//
// Semântica de `TRUST_PROXY_HOPS` (mesmo modelo do `trust proxy` numérico do Express/nginx):
// - `0` (padrão): nenhum proxy confiável configurado — usa sempre o endereço remoto real da conexão
//   TCP (`req.socket.remoteAddress`), nunca X-Forwarded-For.
// - `N` (N >= 1): existem exatamente N proxies confiáveis na frente desta aplicação. O IP do cliente é
//   sempre a entrada `chain.length - N` (0-indexado) — nunca a primeira entrada da cadeia (forjável por
//   qualquer requisição que já chegue ao primeiro proxy confiável com um X-Forwarded-For pré-existente).
//   Uma cadeia mais curta do que `hops` exigiria nunca inventa um IP — cai para o endereço direto da
//   conexão (fail-safe).
//
// Limitação documentada (inerente a qualquer resolução por header, não específica desta implementação):
// isto só é seguro se a topologia de rede garantir que ESTE PROCESSO só é alcançável através dos N
// proxies configurados (ex.: firewall/security group permitindo apenas o proxy confiável) — nunca
// diretamente pela internet. `TRUST_PROXY_HOPS` sozinho não impede um atacante de burlar um proxy que
// não está de fato na frente da aplicação; a garantia vem da topologia de rede combinada com esta
// política.
const crypto = require('node:crypto');
const net = require('node:net');

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

// Item 7 da revisão técnica: uma entrada de X-Forwarded-For não é confiável só por vir na posição
// certa da cadeia — precisa também ser um IPv4/IPv6 sintaticamente válido, nunca uma string arbitrária
// (nunca vira uma identidade legítima de rate limit). `node:net.isIP()` — nenhuma dependência nova.
function isValidIp(value) {
  return typeof value === 'string' && value.length > 0 && net.isIP(value) !== 0;
}

function resolveClientIp(req) {
  const direct = normalizeIp(req.socket && req.socket.remoteAddress);
  const hops = readTrustProxyHops();
  if (hops <= 0) return direct;
  const header = req.headers['x-forwarded-for'];
  if (!header) return direct;
  // Nunca remove/filtra entradas antes de calcular a posição — um atacante poderia inserir uma entrada
  // inválida deliberadamente para deslocar os índices e escapar da posição correta. A cadeia inteira,
  // exatamente como enviada, determina a posição; só o valor FINAL escolhido é validado.
  const chain = String(header).split(',').map(part => normalizeIp(part));
  const index = chain.length - hops;
  if (index < 0 || index >= chain.length) return direct;
  const candidate = chain[index];
  return isValidIp(candidate) ? candidate : direct;
}

// Deriva um identificador estável e não-reversível do IP para uso em chaves de rate limit
// (minimização LGPD — o IP nunca é persistido em texto puro; ver auth/rate-limit.js).
function hashIp(ip, secret) {
  return crypto.createHmac('sha256', secret).update(`ip:${ip || 'desconhecido'}`).digest('hex');
}

module.exports = { resolveClientIp, normalizeIp, hashIp, readTrustProxyHops, isValidIp };
