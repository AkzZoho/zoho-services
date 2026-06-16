#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# start-local.sh — one-shot local launcher for Zoho Services Tools
# ---------------------------------------------------------------------------
# Boots:
#   • DS Analyzer API   →  http://localhost:3001   (Express, hot-reload via nodemon)
#   • React/Vite client →  http://localhost:8080   (proxies /api + /health → :3001)
#
# Usage:
#   ./start-local.sh            # start both (default)
#   ./start-local.sh server     # API only
#   ./start-local.sh client     # client only
#   ./start-local.sh --install  # force reinstall of all workspaces, then start
#
# Press Ctrl+C once to gracefully stop both processes.
# ---------------------------------------------------------------------------

set -euo pipefail

# Resolve script directory so the launcher works from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------- pretty logging ----------
c_reset="\033[0m"; c_dim="\033[2m"; c_red="\033[31m"
c_green="\033[32m"; c_yellow="\033[33m"; c_blue="\033[34m"; c_bold="\033[1m"
log()  { printf "${c_blue}▶${c_reset} %s\n" "$*"; }
ok()   { printf "${c_green}✓${c_reset} %s\n" "$*"; }
warn() { printf "${c_yellow}!${c_reset} %s\n" "$*"; }
err()  { printf "${c_red}✗${c_reset} %s\n" "$*" >&2; }

# ---------- arg parsing ----------
MODE="all"
FORCE_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    server|api)       MODE="server" ;;
    client|web|ui)    MODE="client" ;;
    all|both|"")      MODE="all" ;;
    --install|-i)     FORCE_INSTALL=1 ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      err "Unknown argument: $arg"
      err "Run: $0 --help"
      exit 1
      ;;
  esac
done

# ---------- node version check ----------
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is not installed. Install Node 18+ and retry."
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node 18+ required (found $(node -v))."
  exit 1
fi
ok "Node $(node -v) detected"

# ---------- dependency install (lazy) ----------
need_install=0
if [ "$FORCE_INSTALL" -eq 1 ]; then
  need_install=1
elif [ ! -d "node_modules" ] \
  || [ ! -d "client/node_modules" ] \
  || [ ! -d "functions/ds-analyzer/node_modules" ]; then
  need_install=1
fi

if [ "$need_install" -eq 1 ]; then
  log "Installing workspace dependencies (root + client + function)…"
  npm run install:all
  ok "Dependencies installed"
else
  ok "Dependencies already present (use --install to force reinstall)"
fi

# ---------- env file warnings ----------
if [ ! -f "functions/ds-analyzer/.env" ] && [ ! -f ".env" ]; then
  warn "No .env file found. The function will run in stub LLM mode."
  warn "Copy .env.example → .env and fill in API keys for real LLM calls."
fi

# ---------- process management ----------
PIDS=()
cleanup() {
  echo
  log "Shutting down…"
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  # give children a moment, then force-kill survivors
  sleep 1
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  ok "All processes stopped"
  exit 0
}
trap cleanup INT TERM

start_server() {
  log "Starting API server on http://localhost:3001 …"
  ( npm run dev:server ) &
  PIDS+=($!)
}

start_client() {
  log "Starting Vite client on http://localhost:8080 …"
  ( npm run dev:client ) &
  PIDS+=($!)
}

case "$MODE" in
  server) start_server ;;
  client) start_client ;;
  all)    start_server; sleep 2; start_client ;;
esac

echo
printf "${c_bold}Local environment ready.${c_reset}\n"
[ "$MODE" != "client" ] && printf "  ${c_dim}API   :${c_reset} http://localhost:3001/health\n"
[ "$MODE" != "server" ] && printf "  ${c_dim}Client:${c_reset} http://localhost:8080\n"
printf "${c_dim}Press Ctrl+C to stop.${c_reset}\n\n"

# Wait on all child PIDs. If any one exits non-zero, propagate.
wait -n "${PIDS[@]}" || true
cleanup
