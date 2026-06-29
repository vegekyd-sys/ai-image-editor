#!/usr/bin/env bash
set -u

LOG_DIR=${LOG_DIR:-/var/log/makaron-qwen}
WATCHDOG=${MAKARON_QWEN_WATCHDOG:-/workspace/makaron-qwen-watchdog.sh}
RUNNER_LOG="$LOG_DIR/watchdog-runner.log"

mkdir -p "$LOG_DIR"

while true; do
  if [ ! -x "$WATCHDOG" ]; then
    printf '[%s] missing watchdog: %s\n' "$(date -Is)" "$WATCHDOG" >> "$RUNNER_LOG"
    sleep 10
    continue
  fi

  printf '[%s] launching watchdog: %s\n' "$(date -Is)" "$WATCHDOG" >> "$RUNNER_LOG"
  bash "$WATCHDOG" >> "$RUNNER_LOG" 2>&1
  printf '[%s] watchdog exited code=%s; restarting in 5s\n' "$(date -Is)" "$?" >> "$RUNNER_LOG"
  sleep 5
done
