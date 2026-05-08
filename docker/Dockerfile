# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps
# Install production + dev dependencies and generate the Prisma client.
# Using Bun for fast, reproducible installs (bun.lock enforced).
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS deps

WORKDIR /build

# Copy manifests first so this layer is cached unless they change.
COPY package.json bun.lock ./
COPY prisma/schema.prisma ./prisma/schema.prisma

RUN bun install --frozen-lockfile

# Generate Prisma client into node_modules/@prisma/client
RUN bunx prisma generate

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — build
# Compile the Next.js application using the standalone output preset.
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS builder

WORKDIR /build

# Bring installed node_modules from deps stage.
COPY --from=deps /build/node_modules ./node_modules
COPY --from=deps /build/prisma ./prisma

# Copy the full source tree.
COPY . .

# next build writes to .next/standalone (output: 'standalone' in next.config.mjs).
# Provide placeholder env vars so build-time validation passes without real secrets.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    SLOTTY_DATABASE_URL=file:/tmp/build.db \
    SLOTTY_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    SLOTTY_SESSION_SECRET=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA== \
    SLOTTY_PUBLIC_URL=http://localhost:3000

RUN bun run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — runtime
# Bun runtime: handles googleapis / pino / native node:* imports cleanly
# without the bundler-externalization gymnastics that Node + webpack require.
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS runtime

# tini reaps zombie processes and forwards signals properly (PID 1 safety).
RUN apk add --no-cache tini

# Create a non-root user for the application process.
RUN addgroup -S slotty && adduser -S slotty -G slotty

WORKDIR /app

# Copy the self-contained standalone server bundle.
COPY --from=builder --chown=slotty:slotty /build/.next/standalone ./

# Copy static assets (CSS, JS chunks) into the expected location inside standalone.
COPY --from=builder --chown=slotty:slotty /build/.next/static ./.next/static

# Copy public assets (favicon, robots.txt, etc.) if they exist.
COPY --from=builder --chown=slotty:slotty /build/public ./public

# Copy Prisma schema + migrations so `prisma migrate deploy` can run on startup.
COPY --from=builder --chown=slotty:slotty /build/prisma ./prisma

# Copy the Prisma client that was generated during deps stage.
COPY --from=builder --chown=slotty:slotty /build/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=slotty:slotty /build/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=slotty:slotty /build/node_modules/prisma ./node_modules/prisma

# SQLite database lives on a mounted volume so data survives container restarts.
VOLUME ["/app/data"]

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SLOTTY_DATABASE_URL=file:/app/data/slotty.db

# Health check — the /api/health endpoint should return 200.
# Initial delay allows migrations to run before the first probe.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

USER slotty

EXPOSE 3000

# tini as PID 1, then: run migrations, start the standalone server with Bun.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "bunx prisma migrate deploy && bun --bun server.js"]
