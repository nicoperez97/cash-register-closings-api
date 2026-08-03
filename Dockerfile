# Cash Register Closings API - imagen de produccion
# Build en 2 etapas para no arrastrar devDependencies al runtime.

FROM node:22-bookworm-slim AS builder
WORKDIR /app
# python3/make/g++ son necesarios para compilar bcrypt (modulo nativo)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
  COPY package.json package-lock.json ./
  RUN npm ci --no-audit --no-fund
  COPY . .
  RUN npm run build \
   && npm prune --omit=dev

   FROM node:22-bookworm-slim AS runtime
   ENV NODE_ENV=production
   ENV PORT=3000
   ENV TZ=UTC
   WORKDIR /app
   COPY --from=builder --chown=node:node /app/node_modules ./node_modules
   COPY --from=builder --chown=node:node /app/dist ./dist
   COPY --chown=node:node package.json ./
   COPY --chown=node:node database ./database
   COPY --chown=node:node legacy-ipad ./legacy-ipad
   USER node
   EXPOSE 3000
   HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
    CMD node -e "require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
    CMD ["node", "dist/main.js"]
    
