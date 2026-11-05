#!/usr/bin/env bash
# Live acceptance for the R2 pull-through Worker on its TEST hostname.
# Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PURGE_SECRET=... scripts/acceptance.sh
# Writes and deletes only objects under images/r2c-acceptance/.
set -uo pipefail

TEST_HOST="${TEST_HOST:-https://cdn-r2-test.makaron.app}"
ORIGIN="${SUPABASE_URL:?}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:?}"
SECRET="${PURGE_SECRET:?}"
PUB="/storage/v1/object/public/images"
TMP="$(mktemp -d)"
PASS=0; FAIL=0
ok()   { echo "PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL  $1"; FAIL=$((FAIL+1)); }
sha()  { shasum -a 256 "$1" | cut -d' ' -f1; }
status() { curl -s -o /dev/null -D - "$@" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-makaron-cache"{print $2}'; }
upload() { # path file mime
  curl -s -o /dev/null -w '%{http_code}' -X POST "$ORIGIN/storage/v1/object/images/$1" \
    -H "authorization: Bearer $KEY" -H "x-upsert: true" -H "content-type: $3" --data-binary "@$2"; }
purge() { curl -s -X POST "$TEST_HOST/__r2c/purge" -H "authorization: Bearer $SECRET" \
    -H 'content-type: application/json' -d "{\"paths\":[\"images/$1\"]}"; }
wait_hit() { # url -> echoes final status
  local s=""; for _ in $(seq 1 20); do s="$(status "$1")"; [[ "$s" == HIT-* ]] && break; sleep 1.5; done; echo "$s"; }

RUN="r2c-acceptance/$(date +%s)"
IMG="$RUN/a.jpg"; BIG="$RUN/big.mp4"
head -c 300000 /dev/urandom > "$TMP/a1"; head -c 300000 /dev/urandom > "$TMP/a2"
head -c $((48*1024*1024)) /dev/urandom > "$TMP/big"
[[ "$(upload "$IMG" "$TMP/a1" image/jpeg)" == 200 ]] && ok "upload image v1" || bad "upload image v1"
[[ "$(upload "$BIG" "$TMP/big" video/mp4)" == 200 ]] && ok "upload 48MiB video" || bad "upload video"

# 1. Cold range on the big file: correct bytes immediately, then promoted to R2.
curl -s -H 'range: bytes=1000-1999' "$TEST_HOST$PUB/$BIG" -o "$TMP/r1" -D "$TMP/h1"
dd if="$TMP/big" of="$TMP/r1x" bs=1 skip=1000 count=1000 2>/dev/null
grep -qi '^HTTP/[0-9.]* 206' "$TMP/h1" && cmp -s "$TMP/r1" "$TMP/r1x" && ok "cold range 206 bytes match" || bad "cold range"
s="$(wait_hit "$TEST_HOST$PUB/$BIG")"; [[ "$s" == HIT-* ]] && ok "video promoted ($s)" || bad "video not promoted ($s)"

# 2. Full body integrity from cache.
curl -s "$TEST_HOST$PUB/$BIG" -o "$TMP/big.dl"
[[ "$(sha "$TMP/big.dl")" == "$(sha "$TMP/big")" ]] && ok "full video sha256 matches" || bad "video sha mismatch"

# 3. Warm ranges (prefix, middle, suffix) from cache.
for r in 0-0 25000000-25000999 -777; do
  curl -s -H "range: bytes=$r" "$TEST_HOST$PUB/$BIG" -o "$TMP/rw" -D "$TMP/hw"
  curl -s -H "range: bytes=$r" "$ORIGIN$PUB/$BIG" -o "$TMP/ro"
  st="$(tr -d '\r' < "$TMP/hw" | awk -F': ' 'tolower($1)=="x-makaron-cache"{print $2}')"
  cmp -s "$TMP/rw" "$TMP/ro" && [[ "$st" == HIT-* ]] && ok "warm range $r ($st)" || bad "warm range $r ($st)"
done

# 4. HEAD and conditional request.
etag="$(curl -sI "$TEST_HOST$PUB/$BIG" | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')"
code="$(curl -s -o /dev/null -w '%{http_code}' -H "if-none-match: $etag" "$TEST_HOST$PUB/$BIG")"
[[ -n "$etag" && "$code" == 304 ]] && ok "HEAD etag + 304" || bad "etag/304 ($etag $code)"

# 5. Query strings other than ?download pass through untouched.
[[ -z "$(status "$TEST_HOST$PUB/$IMG?t=1")" ]] && ok "?t= passthrough" || bad "?t= not passthrough"

# 6. Overwrite + purge (what the Storage trigger will do in production).
curl -s "$TEST_HOST$PUB/$IMG" -o /dev/null; s="$(wait_hit "$TEST_HOST$PUB/$IMG")"
[[ "$s" == HIT-* ]] && ok "image cached ($s)" || bad "image not cached ($s)"
upload "$IMG" "$TMP/a2" image/jpeg >/dev/null
out="$(purge "$IMG")"; echo "      purge -> $out"
# R2 is global: right after purge no colo may serve v1 from R2. Per-colo edge
# copies (without CF_PURGE_TOKEN) and Supabase's own CDN may lag up to ~60s.
v2="$(sha "$TMP/a2")"; r2stale=0; conv=""
for i in $(seq 1 45); do
  st="$(curl -s -o "$TMP/a.dl" -D - "$TEST_HOST$PUB/$IMG" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-makaron-cache"{print $2}')"
  if [[ "$(sha "$TMP/a.dl")" == "$v2" ]]; then conv="${conv:-$((i*2))}"; else conv=""; [[ "$st" == HIT-R2 ]] && r2stale=1; fi
  [[ -n "$conv" && $i -ge 38 ]] && break; sleep 2
done
[[ $r2stale == 0 ]] && ok "no stale R2 hit after purge" || bad "stale R2 hit after purge"
[[ -n "$conv" ]] && ok "overwrite converged everywhere (~${conv}s)" || bad "overwrite not converged in 90s"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$TEST_HOST/__r2c/purge" -H 'authorization: Bearer wrong' -d '{"paths":["images/x.jpg"]}')"
[[ "$code" == 401 || "$code" == 403 ]] && ok "purge rejects bad secret ($code)" || bad "purge auth ($code)"

# 7. 404 is not cached.
code="$(curl -s -o /dev/null -w '%{http_code}' "$TEST_HOST$PUB/$RUN/missing.jpg")"
[[ "$code" == 400 || "$code" == 404 ]] && ok "missing object passes through ($code)" || bad "missing ($code)"

# Cleanup: storage objects and cache copies.
curl -s -o /dev/null -X DELETE "$ORIGIN/storage/v1/object/images" -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d "{\"prefixes\":[\"$IMG\",\"$BIG\"]}"
curl -s -o /dev/null -X POST "$TEST_HOST/__r2c/purge" -H "authorization: Bearer $SECRET" \
  -H 'content-type: application/json' -d "{\"paths\":[\"images/$IMG\",\"images/$BIG\"]}"
rm -rf "$TMP"
echo "---- $PASS passed, $FAIL failed"
[[ $FAIL == 0 ]]
