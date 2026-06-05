#!/usr/bin/env bash
set -Eeuo pipefail

COMFY_DIR=${COMFY_DIR:-/workspace/ComfyUI}
QWEN_DIR=${QWEN_DIR:-/workspace/makaron-vast-qwen-serverless}
LOG_DIR=${LOG_DIR:-/var/log/makaron-qwen}
CLOUDFLARE_TOKEN=${CLOUDFLARE_TOKEN:-/root/.cloudflared/comfyui-a6000.token}

COMFY_LOG="$LOG_DIR/comfyui.log"
QWEN_LOG="$LOG_DIR/qwen-server.log"
WATCHDOG_LOG="$LOG_DIR/watchdog.log"
CLOUDFLARE_LOG=/var/log/cloudflared-comfyui.log

COMFY_HEALTH=http://127.0.0.1:8188/system_stats
QWEN_HEALTH=http://127.0.0.1:18000/health
COMFY_PATTERN="python /workspace/ComfyUI/main.py --listen 0.0.0.0 --port 8188"
QWEN_PATTERN="/opt/conda/bin/python /opt/conda/bin/uvicorn qwen_server:app --host 127.0.0.1 --port 18000"

mkdir -p "$LOG_DIR"

comfy_failures=0
qwen_failures=0

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*" >> "$WATCHDOG_LOG"
}

process_running() {
  ps -eo command= | grep -F -x "$1" >/dev/null
}

process_pids() {
  local pattern=$1
  ps -eo pid=,command= | awk -v pattern="$pattern" '
    {
      pid=$1
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "")
      if ($0 == pattern) {
        print pid
      }
    }
  '
}

start_comfy() {
  log "starting ComfyUI"
  nohup python "$COMFY_DIR/main.py" --listen 0.0.0.0 --port 8188 >> "$COMFY_LOG" 2>&1 &
  comfy_failures=0
}

start_qwen() {
  log "starting qwen server"
  local old_pwd
  old_pwd=$(pwd)
  cd "$QWEN_DIR"
  nohup /opt/conda/bin/uvicorn qwen_server:app --host 127.0.0.1 --port 18000 >> "$QWEN_LOG" 2>&1 &
  cd "$old_pwd"
  qwen_failures=0
}

restart_comfy() {
  log "restarting ComfyUI after health failures"
  process_pids "$COMFY_PATTERN" | xargs -r kill 2>/dev/null || true
  sleep 5
  start_comfy
}

restart_qwen() {
  log "restarting qwen server after health failures"
  process_pids "$QWEN_PATTERN" | xargs -r kill 2>/dev/null || true
  sleep 5
  start_qwen
}

start_cloudflared() {
  if [ -f "$CLOUDFLARE_TOKEN" ]; then
    log "starting cloudflared"
    nohup cloudflared tunnel --no-autoupdate run --token-file "$CLOUDFLARE_TOKEN" >> "$CLOUDFLARE_LOG" 2>&1 &
  else
    log "cloudflared token missing: $CLOUDFLARE_TOKEN"
  fi
}

log "watchdog booted"

while true; do
  if ! process_running "$COMFY_PATTERN"; then
    start_comfy
  elif curl -fsS --max-time 8 "$COMFY_HEALTH" >/dev/null; then
    comfy_failures=0
  else
    comfy_failures=$((comfy_failures + 1))
    log "ComfyUI health failure count=$comfy_failures"
    if [ "$comfy_failures" -ge 3 ]; then
      restart_comfy
    fi
  fi

  if ! process_running "$QWEN_PATTERN"; then
    start_qwen
  elif curl -fsS --max-time 5 "$QWEN_HEALTH" >/dev/null; then
    qwen_failures=0
  else
    qwen_failures=$((qwen_failures + 1))
    log "qwen server health failure count=$qwen_failures"
    if [ "$qwen_failures" -ge 3 ]; then
      restart_qwen
    fi
  fi

  if ! pgrep -x cloudflared >/dev/null; then
    start_cloudflared
  fi

  sleep 30
done
