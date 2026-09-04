FROM node:20-bullseye-slim AS base
WORKDIR /app

# Install openssl 1.1 and other deps which are often required by older Prisma engines or specific cloud DBs
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    libssl-dev \
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
