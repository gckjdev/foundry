# syntax=docker/dockerfile:1.7
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/realtime ./apps/realtime
COPY packages/shared ./packages/shared
RUN pnpm install --frozen-lockfile --filter @foundry/realtime...
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["pnpm", "--filter", "@foundry/realtime", "start"]
