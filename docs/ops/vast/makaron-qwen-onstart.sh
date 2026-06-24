#!/usr/bin/env bash
set -Eeuo pipefail

LOG_DIR=/var/log/makaron-qwen
WATCHDOG=${MAKARON_QWEN_WATCHDOG:-/workspace/makaron-qwen-watchdog.sh}
RUNNER=${MAKARON_QWEN_WATCHDOG_RUNNER:-/workspace/makaron-qwen-watchdog-runner.sh}
RUNNER_LOG="$LOG_DIR/watchdog-runner.nohup.log"
PID_FILE=/var/run/makaron-watchdog.pid

mkdir -p "$LOG_DIR"
exec >> /var/log/onstart.log 2>&1

echo "[$(date -Is)] makaron qwen onstart"

if [ ! -x "$WATCHDOG" ] && [ -x /workspace/makaron-watchdog.sh ]; then
  WATCHDOG=/workspace/makaron-watchdog.sh
fi

if [ ! -x "$RUNNER" ]; then
  echo "[$(date -Is)] watchdog runner missing or not executable: $RUNNER"
  exit 1
fi

if [ ! -x "$WATCHDOG" ]; then
  echo "[$(date -Is)] watchdog missing or not executable: $WATCHDOG"
  exit 1
fi

running_pid=$(pgrep -f "^bash $RUNNER$|^$RUNNER$" | head -1 || true)
if [ -n "$running_pid" ]; then
  printf '%s\n' "$running_pid" > "$PID_FILE"
  echo "[$(date -Is)] watchdog runner already running pid=$running_pid"
  exit 0
fi

setsid -f bash "$RUNNER" >> "$RUNNER_LOG" 2>&1 < /dev/null
sleep 1
pid=$(pgrep -f "^bash $RUNNER$|^$RUNNER$" | head -1 || true)
if [ -n "$pid" ]; then
  printf '%s\n' "$pid" > "$PID_FILE"
  echo "[$(date -Is)] watchdog runner launched pid=$pid"
else
  echo "[$(date -Is)] watchdog runner launch failed"
  exit 1
fi
