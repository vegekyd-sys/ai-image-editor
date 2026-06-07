#!/usr/bin/env bash
set -Eeuo pipefail

LOG_DIR=/var/log/makaron-qwen
WATCHDOG=/workspace/makaron-watchdog.sh
RUNNER_LOG="$LOG_DIR/watchdog-runner.log"
PID_FILE=/var/run/makaron-watchdog.pid

mkdir -p "$LOG_DIR"
exec >> /var/log/onstart.log 2>&1

echo "[$(date -Is)] makaron qwen onstart"

if [ ! -x "$WATCHDOG" ]; then
  echo "[$(date -Is)] watchdog missing or not executable: $WATCHDOG"
  exit 1
fi

running_pid=$(pgrep -f "^bash $WATCHDOG$" | head -1 || true)
if [ -n "$running_pid" ]; then
  printf '%s\n' "$running_pid" > "$PID_FILE"
  echo "[$(date -Is)] watchdog already running pid=$running_pid"
  exit 0
fi

setsid -f bash "$WATCHDOG" >> "$RUNNER_LOG" 2>&1 < /dev/null
sleep 1
pid=$(pgrep -f "^bash $WATCHDOG$" | head -1 || true)
if [ -n "$pid" ]; then
  printf '%s\n' "$pid" > "$PID_FILE"
  echo "[$(date -Is)] watchdog launched pid=$pid"
else
  echo "[$(date -Is)] watchdog launch failed"
  exit 1
fi
