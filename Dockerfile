# syntax=docker/dockerfile:1

# Public demo image — the hosted sandbox at reallywire.dev/netplan-studio/app/.
# One process serves the built SPA and the API (ADR-0002); the entrypoint
# seeds the demo scene on a fresh database and wipes + reseeds it on a
# schedule, because every visitor shares the one sandbox (ADR-0001: no auth).
FROM node:22-bookworm-slim

# Build toolchain for the better-sqlite3 native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

COPY . .
# HUSKY=0: no git hooks inside the image.
RUN HUSKY=0 pnpm install --frozen-lockfile

# Subpath the SPA is served under (must end in "/") and the demo banner.
ARG NETPLAN_BASE_PATH=/netplan-studio/app/
ARG VITE_NETPLAN_DEMO=1
ARG VITE_NETPLAN_HOME_URL=https://reallywire.dev/netplan-studio
RUN NETPLAN_BASE_PATH=$NETPLAN_BASE_PATH \
  VITE_NETPLAN_DEMO=$VITE_NETPLAN_DEMO \
  VITE_NETPLAN_HOME_URL=$VITE_NETPLAN_HOME_URL \
  pnpm build

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3001 \
  NETPLAN_SERVE_WEB=1 \
  NETPLAN_DB=/tmp/netplan/netplan.db \
  NETPLAN_RESET_HOURS=24

USER node
EXPOSE 3001
CMD ["bash", "docker/demo-entrypoint.sh"]
