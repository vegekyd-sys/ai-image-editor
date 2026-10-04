#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIMULATOR_ID="${MAKARON_E2E_SIMULATOR_ID:-A475951A-846B-4EAD-99C2-D84F509EE716}"
SIMULATOR_NAME="Makaron iOS Subscription E2E"
SUPABASE_WORKDIR="e2e/ios-subscription"
SUPABASE_CONTAINER="supabase_db_makaron-ios-subscription-e2e"
APP_BUNDLE_ID="app.makaron.ios"
E2E_ORIGIN="http://127.0.0.1:3002"
PHOTO_FIXTURE="public/landing/trial-selfie-poster.jpg"
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT_DIR=".artifacts/ios-e2e/${RUN_STAMP}"
SERVER_PID=""
SIMULATOR_VERIFIED=false
# Keep one DerivedData location across worktrees instead of letting Xcode create
# a multi-GB cache for every absolute checkout path.
E2E_TMP_ROOT="${TMPDIR:-/tmp}"
E2E_DERIVED_DATA="${MAKARON_E2E_DERIVED_DATA:-${E2E_TMP_ROOT%/}/makaron-ios-subscription-e2e-derived-data}"

cd "$REPO_ROOT"
mkdir -p "$ARTIFACT_DIR"

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  # This simulator is disposable by contract and every run starts by erasing it.
  # Erase on both success and failure so interrupted E2E runs do not retain app,
  # WebView, Photos, and StoreKit data. Set the escape hatch only for debugging.
  if [[ "$SIMULATOR_VERIFIED" == true && "${MAKARON_E2E_KEEP_SIMULATOR_STATE:-0}" != 1 ]]; then
    xcrun simctl shutdown "$SIMULATOR_ID" >/dev/null 2>&1 || true
    xcrun simctl erase "$SIMULATOR_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

prime_photo_library() {
  # simctl addmedia returns before Photos has necessarily indexed the asset.
  # Opening Photos once makes the subsequent PHPicker grid deterministic.
  xcrun simctl launch "$SIMULATOR_ID" com.apple.mobileslideshow >/dev/null 2>&1 || true
  sleep 2
  xcrun simctl terminate "$SIMULATOR_ID" com.apple.mobileslideshow >/dev/null 2>&1 || true
}

for command_name in curl docker npx npm rg xcodebuild xcrun; do
  command -v "$command_name" >/dev/null || {
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  }
done

if ! xcrun simctl list devices | rg -F "$SIMULATOR_NAME" | rg -q -F "$SIMULATOR_ID"; then
  printf 'Refusing to erase simulator %s: it is not the dedicated %s device.\n' "$SIMULATOR_ID" "$SIMULATOR_NAME" >&2
  exit 1
fi
SIMULATOR_VERIFIED=true
mkdir -p "$E2E_DERIVED_DATA"

if ! npx supabase status --workdir "$SUPABASE_WORKDIR" >/dev/null 2>&1; then
  npx supabase start --workdir "$SUPABASE_WORKDIR"
fi

# Supabase CLI emits shell-safe local environment assignments.
eval "$(npx supabase status --workdir "$SUPABASE_WORKDIR" -o env 2>/dev/null)"

if ! curl -fsS "$E2E_ORIGIN/api/e2e/skill-fixture" >/dev/null 2>&1; then
  MAKARON_E2E=1 \
  MOCK_AI=true \
  APPLE_IAP_ENVIRONMENTS=xcode,localtesting \
  NEXT_PUBLIC_SUPABASE_URL="$API_URL" \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  npm run dev -- -H 127.0.0.1 -p 3002 >"$ARTIFACT_DIR/next-server.log" 2>&1 &
  SERVER_PID=$!
elif ! curl -fsS "$E2E_ORIGIN/api/home-skills" | rg -q 'E2E Ending Spirit'; then
  printf 'Port 3002 is occupied by a server that is not using the isolated E2E Supabase project.\n' >&2
  exit 1
fi

xcrun simctl shutdown "$SIMULATOR_ID" 2>/dev/null || true
xcrun simctl erase "$SIMULATOR_ID"
xcrun simctl boot "$SIMULATOR_ID"
open -a Simulator --args -CurrentDeviceUDID "$SIMULATOR_ID"
xcrun simctl bootstatus "$SIMULATOR_ID" -b
xcrun simctl addmedia "$SIMULATOR_ID" "$PHOTO_FIXTURE"
prime_photo_library

npx supabase db reset --workdir "$SUPABASE_WORKDIR" --local

backend_ready=false
for _attempt in $(seq 1 45); do
  if curl -fsS "$API_URL/auth/v1/health" >/dev/null \
    && curl -fsS "$E2E_ORIGIN/api/home-skills" | rg -q 'E2E Ending Spirit'; then
    backend_ready=true
    break
  fi
  sleep 1
done
if [[ "$backend_ready" != true ]]; then
  printf 'The isolated E2E backend did not become ready.\n' >&2
  exit 1
fi

# Make the test entry self-contained. A prior real-device build may point the
# WebView at a Preview deployment; E2E must always compile against loopback.
npm run ios:local -- --url "$E2E_ORIGIN"
if ! rg -q -F "\"url\": \"$E2E_ORIGIN\"" ios/App/App/capacitor.config.json; then
  printf 'The iOS E2E WebView URL was not written correctly.\n' >&2
  exit 1
fi

set -o pipefail
xcodebuild test \
  -parallel-testing-enabled NO \
  -derivedDataPath "$E2E_DERIVED_DATA" \
  -project ios/App/App.xcodeproj \
  -scheme App-E2E \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
  -only-testing:MakaronStoreKitUITests/MakaronStoreKitUITests/testSubscriptionBeforeRegistrationWithoutPhotoReturnsToSkill \
  -resultBundlePath "$ARTIFACT_DIR/subscription-no-photo.xcresult" \
  2>&1 | tee "$ARTIFACT_DIR/xcodebuild-no-photo.log"

docker exec "$SUPABASE_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -P pager=off -c '
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO STRICT v_user_id
  FROM auth.users
  WHERE email LIKE $q$ios-e2e+%@e2e.makaron.test$q$ AND email_confirmed_at IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM public.credit_balances
    WHERE user_id = v_user_id
      AND balance = 1500
      AND trial_balance = 1500
      AND trial_expires_at > now() + interval $q$2 days$q$
  ) THEN RAISE EXCEPTION $q$missing durable 1500 Apple trial credits$q$; END IF;

  IF EXISTS (SELECT 1 FROM public.projects WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION $q$registration without a photo created an empty project$q$;
  END IF;

  IF (SELECT count(*) FROM public.apple_trial_credit_claims WHERE user_id = v_user_id) <> 1 THEN
    RAISE EXCEPTION $q$Apple trial claim was not exactly-once$q$;
  END IF;
END $$;'

# Xcode 26.5 can reject SKTestSession mutations before the host app is marked
# as a development install. Erasing the dedicated simulator is slower but is
# deterministic: it resets WebView/Auth and StoreKit eligibility together.
xcrun simctl shutdown "$SIMULATOR_ID" 2>/dev/null || true
xcrun simctl erase "$SIMULATOR_ID"
xcrun simctl boot "$SIMULATOR_ID"
open -a Simulator --args -CurrentDeviceUDID "$SIMULATOR_ID"
xcrun simctl bootstatus "$SIMULATOR_ID" -b
xcrun simctl addmedia "$SIMULATOR_ID" "$PHOTO_FIXTURE"
prime_photo_library
npx supabase db reset --workdir "$SUPABASE_WORKDIR" --local

set -o pipefail
xcodebuild test \
  -parallel-testing-enabled NO \
  -derivedDataPath "$E2E_DERIVED_DATA" \
  -project ios/App/App.xcodeproj \
  -scheme App-E2E \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
  -only-testing:MakaronStoreKitUITests/MakaronStoreKitUITests/testSubscriptionBeforeRegistrationWithPhotoCarriesSkillAndCredits \
  -resultBundlePath "$ARTIFACT_DIR/subscription-flow.xcresult" \
  2>&1 | tee "$ARTIFACT_DIR/xcodebuild.log"

docker exec "$SUPABASE_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -P pager=off -c '
DO $$
DECLARE
  v_user_id uuid;
  v_project_id uuid;
BEGIN
  SELECT id INTO STRICT v_user_id
  FROM auth.users
  WHERE email LIKE $q$ios-e2e+%@e2e.makaron.test$q$ AND email_confirmed_at IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM public.credit_balances
    WHERE user_id = v_user_id
      AND balance = 1500
      AND trial_balance = 1500
      AND trial_expires_at > now() + interval $q$2 days$q$
  ) THEN RAISE EXCEPTION $q$missing durable 1500 Apple trial credits$q$; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = v_user_id AND provider = $q$apple$q$ AND plan_id = $q$basic$q$ AND status = $q$trialing$q$
  ) THEN RAISE EXCEPTION $q$missing trialing Apple Basic subscription$q$; END IF;

  IF (SELECT count(*) FROM public.apple_trial_credit_claims WHERE user_id = v_user_id) <> 1 THEN
    RAISE EXCEPTION $q$Apple trial claim was not exactly-once$q$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pending_apple_trial_claims
    WHERE claimed_by = v_user_id AND claimed_at IS NOT NULL AND apple_environment = $q$Xcode$q$
  ) THEN RAISE EXCEPTION $q$pending Apple transaction was not linked$q$; END IF;

  SELECT id INTO STRICT v_project_id FROM public.projects WHERE user_id = v_user_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.snapshots
    WHERE project_id = v_project_id AND image_url LIKE $q$%/anonymous-source-0.jpg$q$
  ) THEN RAISE EXCEPTION $q$selected photo was not persisted as the initial snapshot$q$; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_files
    WHERE user_id = v_user_id AND path = $q$skills/e2e-ending-spirit/SKILL.md$q$
  ) THEN RAISE EXCEPTION $q$selected Skill was not installed$q$; END IF;
END $$;'

mkdir -p "$ARTIFACT_DIR/attachments"
xcrun xcresulttool export attachments \
  --path "$ARTIFACT_DIR/subscription-flow.xcresult" \
  --output-path "$ARTIFACT_DIR/attachments" >/dev/null

mkdir -p "$ARTIFACT_DIR/no-photo-attachments"
xcrun xcresulttool export attachments \
  --path "$ARTIFACT_DIR/subscription-no-photo.xcresult" \
  --output-path "$ARTIFACT_DIR/no-photo-attachments" >/dev/null

printf 'PASS: iOS subscription E2E completed. Artifacts: %s/%s\n' "$REPO_ROOT" "$ARTIFACT_DIR"
