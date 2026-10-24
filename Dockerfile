# ── deps: install production + dev deps ──────────────────────────────────────
# Debian (glibc), not Alpine: onnxruntime-node's Linux binary needs glibc ≥ 2.28.
FROM node:22-bookworm-slim AS base
# Prisma picks its engine by the OpenSSL it finds at install/generate time and
# needs it at runtime; the slim image ships none.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
# onnxruntime-node would otherwise fetch CUDA libraries on linux/x64; CPU only here.
ENV ONNXRUNTIME_NODE_INSTALL=skip
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN npm install

# ── builder: generate Prisma client, build Next.js, fetch the built-in model ──
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
# Build-time only placeholder — lib/prisma.ts constructs a client at module
# load (needed while Next statically collects route/page data), but nothing
# actually queries it during the build. Real DATABASE_URL is set at runtime.
ENV DATABASE_URL="file:./build-placeholder.db"
RUN npm run build
# The built-in embedding model ships in the image so semantic search works
# offline from the first start. Downloaded and checksum-verified here.
RUN npm run models:fetch-builtin
# Build and lint tools aren't needed past this point; dropping them keeps the
# image smaller. tsx and dotenv stay — they're dependencies, used at runtime
# by the seed and prisma.config.ts.
RUN npm prune --omit=dev

# ── runner: minimal production image ─────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
ARG TARGETARCH
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# gosu drops root in the entrypoint; wget serves the compose healthcheck;
# openssl is for Prisma (see base).
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu wget openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/nextjs nextjs
RUN mkdir -p /data/uploads && chown nextjs:nodejs /data
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Include native modules (@libsql, canvas, onnxruntime) from builder
COPY --from=builder /app/node_modules ./node_modules
# ONNX Runtime ships binaries for every OS and CPU; keep only this image's.
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo arm64 || echo x64) \
  && cd node_modules/onnxruntime-node/bin/napi-v6 \
  && rm -rf darwin win32 \
  && find linux -mindepth 1 -maxdepth 1 ! -name "$ARCH" -exec rm -rf {} +
# Needed at runtime for migrate deploy + seed (not part of the standalone output)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json
# Backup/restore engine for the boot-time restore step and the CLI (run with tsx).
COPY --from=builder /app/lib/backup ./lib/backup
COPY --from=builder /app/lib/attachment-location.ts ./lib/attachment-location.ts
COPY --from=builder /app/lib/secret-box.ts ./lib/secret-box.ts
COPY --from=builder /app/scripts ./scripts
# Document extractors, loaded with tsx by workers/extract-worker.mjs (not bundled by Next).
COPY --from=builder /app/lib/documents/extract ./lib/documents/extract
COPY --from=builder /app/lib/documents/limits.ts /app/lib/documents/types.ts /app/lib/documents/normalize.ts ./lib/documents/
# Embedding and extraction workers (plain ESM, not bundled by Next) and the built-in model
COPY --from=builder /app/workers ./workers
COPY --from=builder /app/models/builtin ./models/builtin
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV UPLOAD_DIR=/data/uploads
ENV MODELS_DIR=/data/models
# Lets "Restart to finish" exit the process; compose's restart policy brings it back.
ENV HOMECENTER_SUPERVISED=1
# Probes the database through /api/health (left public in proxy.ts).
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
