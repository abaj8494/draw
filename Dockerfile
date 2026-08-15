# draw.fatfort.com — single lightweight Node container: Express +
# better-sqlite3 + ws. Serves its own static frontend AND its API, so the
# shared Caddy needs just one reverse_proxy and no bind mount.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# better-sqlite3 ships prebuilt binaries for glibc; no toolchain needed.
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY js ./js
COPY css ./css
COPY index.html ./
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 5003
VOLUME /app/data
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5003/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
