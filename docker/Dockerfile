# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps
# Install production + dev dependencies and generate the Prisma client.
# Using Bun for fast, reproducible installs (bun.lock enforced).
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.3.8-alpine AS deps

WORKDIR /build

# Native build tools for any postinstall scripts that need to compile from
# source. argon2 ^0.41 ships prebuilds for linux-x64 (glibc) but NOT
# linux-x64-musl, so on Alpine it has to compile from source — without these
# tools the install silently produces a broken binary that throws
# "No native build was found for ... abi=137 ... libc=musl" the first time
# argon2.hash() is called (admin setup form, login, etc.).
RUN apk add --no-cache python3 make g++

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
FROM oven/bun:1.3.8-alpine AS builder

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
FROM oven/bun:1.3.8-alpine AS runtime

# tini reaps zombie processes and forwards signals properly (PID 1 safety).
# openssl provides the libssl3 that Prisma's schema engine binary links
# against — without it Prisma can't even detect its OpenSSL version, falls
# back to a 1.1.x engine binary that doesn't run on Alpine 3.x, and crashes
# with "Could not parse schema engine response" before any migration runs.
RUN apk add --no-cache tini openssl

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

# .bin contains the symlinks bunx/npx resolve to (./node_modules/.bin/prisma).
# Without this, `bunx prisma` falls back to the npm registry and pulls the
# latest major (currently 7.x), which has breaking changes vs the 5.x the
# schema is written for.
COPY --from=builder --chown=slotty:slotty /build/node_modules/.bin ./node_modules/.bin

# SQLite database lives on a mounted volume so data survives container restarts.
VOLUME ["/app/data"]

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SLOTTY_DATABASE_URL=file:/app/data/slotty.db

# Healthcheck intentionally not declared at image level. On TrueNAS
# Community Edition the on-disk Health.Log never gets flushed during
# runtime, so the container reads as `Health.Status=starting` for hours
# even when the app is fully serving traffic — TrueNAS then surfaces the
# whole app as DEPLOYING/starting and never transitions to RUNNING.
#
# Probe the /api/health endpoint at the compose / orchestrator level
# instead (where you control how strictly to interpret the result), or
# rely on the `running` state of the container itself. /api/health still
# exists and returns the same JSON for any external monitoring.

USER slotty

EXPOSE 3000

# tini as PID 1, then: run migrations, start the standalone server with Bun.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "bunx prisma migrate deploy && bun --bun server.js"]
