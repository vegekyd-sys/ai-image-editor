#!/usr/bin/env bash
set -Eeuo pipefail

INSTANCE_ID=${MAKARON_QWEN_INSTANCE_ID:-48270326}
PROTECTED_LABEL=${MAKARON_QWEN_LABEL:-makaron-qwen-a6000-prod-20260821}
VAST=${VASTAI_BIN:-/Users/tianyicai/.local/bin/vastai}
APP_HEALTH_URL=${MAKARON_APP_HEALTH_URL:-https://www.makaron.app/api/health}
DIRECT_HEALTH_URL=${MAKARON_COMFY_HEALTH_URL:-https://comfyui.makaron.app/system_stats}
REMOTE_ONSTART=${MAKARON_REMOTE_ONSTART:-/workspace/makaron-qwen-onstart.sh}
STOP_EXTRA_RUNNING=${MAKARON_STOP_EXTRA_VAST_RUNNING:-false}

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

vast_call() {
  "$VAST" "$@" 2> >(
    sed -E 's/(api_key=)[^& )]+/\1[REDACTED]/g' >&2
  )
}

wait_for_instance_running() {
  local attempt offline_checks=0 reboot_attempted=false
  for attempt in $(seq 1 60); do
    instance_json=$(vast_call show instance "$INSTANCE_ID" --raw)
    actual_status=$(printf '%s' "$instance_json" | json_get '.actual_status')
    cur_state=$(printf '%s' "$instance_json" | json_get '.cur_state')
    intended_status=$(printf '%s' "$instance_json" | json_get '.intended_status')
    ssh_host=$(printf '%s' "$instance_json" | json_get '.ssh_host')
    ssh_port=$(printf '%s' "$instance_json" | json_get '.ssh_port')
    log "instance actual=$actual_status cur=$cur_state intended=$intended_status ssh=${ssh_host:-?}:${ssh_port:-?}"
    if [ "$actual_status" = "running" ] && [ "$cur_state" = "running" ] && [ -n "$ssh_host" ] && [ -n "$ssh_port" ]; then
      return 0
    fi
    if [ "$actual_status" = "offline" ]; then
      offline_checks=$((offline_checks + 1))
      if [ "$offline_checks" -ge 3 ] && [ "$reboot_attempted" = "false" ]; then
        log "instance remains offline; requesting one Vast reboot"
        vast_call reboot instance "$INSTANCE_ID" || log "Vast reboot request failed"
        reboot_attempted=true
      fi
    else
      offline_checks=0
    fi
    sleep 10
  done
  return 1
}

remote_exec() {
  ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p "$ssh_port" "root@$ssh_host" "$@"
}

[ -x "$VAST" ] || die "Vast CLI not found at $VAST"

stop_extra_running_instances() {
  [ "$STOP_EXTRA_RUNNING" = "true" ] || return 0

  local instances extra_ids id
  instances=$(vast_call show instances --raw)
  extra_ids=$(
    printf '%s' "$instances" | jq -r --argjson protected "$INSTANCE_ID" '
      .[]
      | select(.id != $protected)
      | select(.actual_status == "running" or .cur_state == "running" or .intended_status == "running")
      | .id
    '
  )

  for id in $extra_ids; do
    [ -n "$id" ] || continue
    log "stopping extra running Vast instance $id"
    vast_call stop instance "$id" || log "failed to stop extra instance $id"
  done
}

stop_extra_running_instances

instance_json=$(vast_call show instance "$INSTANCE_ID" --raw)
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
  vast_call start instance "$INSTANCE_ID"
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
  app_health=$(curl -fsS --max-time 20 "$APP_HEALTH_URL" || true)
  qwen_status=$(printf '%s' "$app_health" | jq -r '.services.comfyui_qwen.status // empty' 2>/dev/null || true)
  overall_status=$(printf '%s' "$app_health" | jq -r '.status // empty' 2>/dev/null || true)
  log "app health attempt=$attempt overall=${overall_status:-failed} comfyui_qwen=${qwen_status:-failed}"
  if [ "$qwen_status" = "healthy" ]; then
    log "Makaron Qwen ComfyUI healthy"
    exit 0
  fi
  sleep 15
done

die "Makaron app Qwen health did not become healthy"
