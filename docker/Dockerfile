# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG LAYERLING_BUILD_CPUS=2
ENV LAYERLING_BUILD_CPUS=$LAYERLING_BUILD_CPUS
ARG NEXT_PUBLIC_SOURCE_CODE_URL=https://github.com/rrmm94/layerling
ENV NEXT_PUBLIC_SOURCE_CODE_URL=$NEXT_PUBLIC_SOURCE_CODE_URL
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 999 nodejs \
  && useradd --system --uid 999 --gid nodejs nextjs

COPY --chown=nextjs:nodejs package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev && npm cache clean --force

COPY --chown=nextjs:nodejs --from=builder /app/apps/web/.next ./apps/web/.next
COPY --chown=nextjs:nodejs --from=builder /app/apps/web/public ./apps/web/public

# The start page keeps the preview pictures of the designs here; the folder must belong to the user the
# server runs as, or every picture is refused and the cards stay on "No preview yet".
RUN mkdir -p /var/lib/layerling /app/.codex/project-thumbnails \
  && chown -R nextjs:nodejs /app/.codex /var/lib/layerling

USER nextjs
EXPOSE 3000

CMD ["npm", "start"]
