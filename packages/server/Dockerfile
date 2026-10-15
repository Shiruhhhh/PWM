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
# @prisma/client's own postinstall hook (triggered by the install above)
# can't find the schema -- it runs from /app, not packages/server/, so
# its default-location search misses prisma/schema.prisma entirely. The
# build stage's own `prisma generate` doesn't help either: that runs in
# a separate image layer, before this stage's fresh --prod install
# recreates node_modules from scratch. Needs an explicit generate here,
# with the right --schema path and cwd, after prisma is actually
# installed (see docs/DECISIONS.md #26).
RUN pnpm --filter @pwm/server exec prisma generate --schema=prisma/schema.prisma

WORKDIR /app/packages/server
EXPOSE 3000
CMD ["sh", "-c", "pnpm exec prisma migrate deploy --schema=prisma/schema.prisma && node dist/index.js"]
