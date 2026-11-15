FROM node:24.22.1-bookworm-slim
WORKDIR app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD node --input-type=module -e "fetch('http://127.0.0.1/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "scripts/start.mjs"]
