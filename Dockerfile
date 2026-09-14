# DEMO/STAGING apenas (ver docs/DEMO_DEPLOY.md) — não é infraestrutura de produção homologada (H11,
# docs/PRODUCTION_GATE.md, PG-22, continua aberto). Runtime Node simples, sem build step (o projeto não
# usa bundler/transpilação) — server.js é o único entrypoint.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

# NODE_ENV é definido no ambiente de deploy (docs/DEMO_DEPLOY.md), nunca fixado na imagem — para um
# DEMO/STAGING, é mantido como "development" deliberadamente (ver docs/DEMO_DEPLOY.md, seção "Por que
# NODE_ENV=development"), então nunca hardcoded aqui.
EXPOSE 3007

CMD ["node", "server.js"]
