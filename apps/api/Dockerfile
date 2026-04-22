FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
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
