#!/usr/bin/env bash
# Public-demo supervisor: start the app on a fresh database, seed the demo
# scene through the real Operation log, and every NETPLAN_RESET_HOURS wipe the
# database and start over. If the app dies, exit non-zero so Docker restarts
# the container (which also starts from a clean sandbox).
set -uo pipefail

API="http://127.0.0.1:${PORT:-3001}"
RESET_SECONDS=$(( ${NETPLAN_RESET_HOURS:-24} * 3600 ))
DB_DIR="$(dirname "${NETPLAN_DB:?NETPLAN_DB must be set}")"

server_pid=""
sleeper_pid=""

stop_all() {
  [ -n "$sleeper_pid" ] && kill "$sleeper_pid" 2>/dev/null
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null
    wait "$server_pid" 2>/dev/null
  fi
  server_pid=""
  sleeper_pid=""
}
trap 'stop_all; exit 0' TERM INT

healthy() {
  node -e "fetch('$API/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
}

while true; do
  rm -rf "$DB_DIR"
  mkdir -p "$DB_DIR"

  node apps/server/dist/index.js &
  server_pid=$!

  for _ in $(seq 1 60); do
    healthy && break
    kill -0 "$server_pid" 2>/dev/null || { echo "demo: server exited during startup" >&2; exit 1; }
    sleep 1
  done

  # tsx straight from node_modules: pnpm via corepack would try to download
  # itself again as the unprivileged user.
  if ! (cd apps/web && node_modules/.bin/tsx e2e/seed-dev.ts --reset --api "$API"); then
    echo "demo: seeding failed" >&2
    stop_all
    exit 1
  fi
  echo "demo: sandbox ready; next reset in ${NETPLAN_RESET_HOURS:-24}h"

  sleep "$RESET_SECONDS" &
  sleeper_pid=$!
  wait -n "$server_pid" "$sleeper_pid"

  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "demo: server exited" >&2
    stop_all
    exit 1
  fi
  echo "demo: scheduled reset"
  stop_all
done
