#!/usr/bin/env bash
set -Eeuo pipefail

INSTANCE_ID=${MAKARON_QWEN_INSTANCE_ID:-38953964}
PROTECTED_LABEL=${MAKARON_QWEN_LABEL:-makaron-qwen-a6000-prod-v2-20260601}
VAST=${VASTAI_BIN:-/Users/tianyicai/.local/bin/vastai}
APP_HEALTH_URL=${MAKARON_APP_HEALTH_URL:-https://www.makaron.app/api/health}
DIRECT_HEALTH_URL=${MAKARON_COMFY_HEALTH_URL:-https://comfyui.makaron.app/system_stats}
REMOTE_ONSTART=${MAKARON_REMOTE_ONSTART:-/workspace/makaron-qwen-onstart.sh}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

json_get() {
  jq -r "$1 // empty"
}

wait_for_instance_running() {
  local attempt
  for attempt in $(seq 1 60); do
    instance_json=$("$VAST" show instance "$INSTANCE_ID" --raw)
    actual_status=$(printf '%s' "$instance_json" | json_get '.actual_status')
    cur_state=$(printf '%s' "$instance_json" | json_get '.cur_state')
    intended_status=$(printf '%s' "$instance_json" | json_get '.intended_status')
    ssh_host=$(printf '%s' "$instance_json" | json_get '.ssh_host')
    ssh_port=$(printf '%s' "$instance_json" | json_get '.ssh_port')
    log "instance actual=$actual_status cur=$cur_state intended=$intended_status ssh=${ssh_host:-?}:${ssh_port:-?}"
    if [ "$actual_status" = "running" ] && [ "$cur_state" = "running" ] && [ -n "$ssh_host" ] && [ -n "$ssh_port" ]; then
      return 0
    fi
    sleep 10
  done
  return 1
}

remote_exec() {
  ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p "$ssh_port" "root@$ssh_host" "$@"
}

[ -x "$VAST" ] || die "Vast CLI not found at $VAST"

instance_json=$("$VAST" show instance "$INSTANCE_ID" --raw)
label=$(printf '%s' "$instance_json" | json_get '.label')
actual_status=$(printf '%s' "$instance_json" | json_get '.actual_status')
cur_state=$(printf '%s' "$instance_json" | json_get '.cur_state')
intended_status=$(printf '%s' "$instance_json" | json_get '.intended_status')
ssh_host=$(printf '%s' "$instance_json" | json_get '.ssh_host')
ssh_port=$(printf '%s' "$instance_json" | json_get '.ssh_port')

if [ "$label" != "$PROTECTED_LABEL" ]; then
  die "instance $INSTANCE_ID label mismatch: got '$label', expected '$PROTECTED_LABEL'"
fi

log "protected instance $INSTANCE_ID label=$label actual=$actual_status cur=$cur_state intended=$intended_status"

if [ "$actual_status" != "running" ] || [ "$cur_state" != "running" ]; then
  log "starting protected instance $INSTANCE_ID"
  "$VAST" start instance "$INSTANCE_ID"
  wait_for_instance_running || die "instance did not become running"
fi

remote_exec "bash '$REMOTE_ONSTART'"

if curl -fsS --max-time 12 "$DIRECT_HEALTH_URL" >/dev/null; then
  log "direct ComfyUI health OK: $DIRECT_HEALTH_URL"
else
  log "direct ComfyUI health failed once, re-running remote onstart"
  remote_exec "bash '$REMOTE_ONSTART'"
fi

for attempt in $(seq 1 20); do
  app_status=$(curl -fsS --max-time 20 "$APP_HEALTH_URL" | jq -r '.status // empty' || true)
  log "app health attempt=$attempt status=${app_status:-failed}"
  if [ "$app_status" = "healthy" ]; then
    log "Makaron Qwen Vast worker healthy"
    exit 0
  fi
  sleep 15
done

die "Makaron app health did not become healthy"
