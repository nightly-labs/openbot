FROM oven/bun:1.4.2-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY patches ./patches
COPY apps/auth-api/package.json ./apps/auth-api/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/brand/package.json ./packages/brand/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/i18n/package.json ./packages/i18n/package.json
COPY packages/logging/package.json ./packages/logging/package.json
COPY packages/telemetry/package.json ./packages/telemetry/package.json
COPY packages/user-errors/package.json ./packages/user-errors/package.json
COPY packages/team-client/package.json ./packages/team-client/package.json
COPY packages/whatsapp/package.json ./packages/whatsapp/package.json
COPY remote/api/package.json ./remote/api/package.json
RUN bun install --production --ignore-scripts --frozen-lockfile --filter @openbot/remote-api

FROM oven/bun:1.4.2-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/remote/api/node_modules ./remote/api/node_modules
COPY packages/contracts ./packages/contracts
COPY packages/i18n ./packages/i18n
COPY remote/api ./remote/api
RUN mkdir -p /var/lib/openbot-signal && chown bun:bun /var/lib/openbot-signal && chmod 700 /var/lib/openbot-signal
USER bun
WORKDIR /app/remote/api
EXPOSE 8443
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD bun -e 'const r=await fetch("http://127.0.0.1:"+(process.env.REMOTE_HEALTH_PORT||"8080")+"/health/ready");process.exit(r.ok?0:1)'
ARG OPENBOT_SOURCE_COMMIT=unknown
ENV OPENBOT_SOURCE_COMMIT=$OPENBOT_SOURCE_COMMIT
ENTRYPOINT ["bun", "src/index.ts"]
