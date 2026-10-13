FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile --filter @pwm/core --filter @pwm/server
COPY packages/core packages/core
COPY packages/server packages/server
RUN pnpm --filter @pwm/core run build
RUN pnpm --filter @pwm/server exec prisma generate --schema=prisma/schema.prisma
RUN pnpm --filter @pwm/server run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/server/prisma packages/server/prisma
RUN pnpm install --frozen-lockfile --prod --filter @pwm/core --filter @pwm/server
RUN pnpm --filter @pwm/server exec prisma generate --schema=prisma/schema.prisma

WORKDIR /app/packages/server
EXPOSE 3000
CMD ["node", "dist/index.js"]
