# Imagen de producción: Node 24 con SQLite nativo, sin builds nativos.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Solo dependencias de producción, con el lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Los datos viven en /data (volumen). El usuario no es root.
RUN mkdir -p /data /app/backups && chown -R node:node /app /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
