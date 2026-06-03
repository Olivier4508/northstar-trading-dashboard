#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="/Users/olivedf/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
PID_FILE="$SCRIPT_DIR/.northstar.pid"
LOG_FILE="$SCRIPT_DIR/.northstar.log"

cd "$SCRIPT_DIR"

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  kill -0 "$pid" 2>/dev/null
}

if ! is_running; then
  HOST="$HOST" PORT="$PORT" nohup "$NODE_BIN" server.js >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 1
fi

open "http://$HOST:$PORT"
