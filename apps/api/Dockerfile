FROM node:20-bookworm-slim AS base
WORKDIR /app

# Prisma needs an OpenSSL runtime to pick its query engine. Bookworm ships
# OpenSSL 3, which schema.prisma already lists in binaryTargets. The image was on
# bullseye to get OpenSSL 1.1, but bullseye is end-of-life: its security pool is
# archived and libssl1.1 now 404s, which fails the build outright.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

COPY package.json ./
COPY prisma ./prisma/
COPY tsconfig.json ./
COPY src ./src/

RUN pnpm install
RUN pnpm exec prisma generate
RUN pnpm run build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["sh", "-c", "pnpm exec prisma db push && node dist/index.js"]
