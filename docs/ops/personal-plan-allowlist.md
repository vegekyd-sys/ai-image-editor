# Personal-plan membership administration

## Scope

`/admin` → **个人套餐 / Personal plans** manages one registered Makaron-user
roster for both the owner's Codex plan and Grok plan. Default Agent remains
Terra; explicit Grok Agent and Imagine video selections use Grok. Credentials,
quota windows, model choices, API fallback rules, and zero-cost usage records
remain provider-specific.

The existing `app_settings.codex_subscription_allowed_user_ids` key is retained
as the shared source of truth. No table migration or credential copy is needed.
Once this setting exists, static Codex/Grok environment allowlists no longer
override it. A failed membership read allows only configured owners; mutation
requests refuse to proceed on a failed or malformed read.

## Synchronization contract

- New API: `/api/admin/personal-subscription-allowlist`; the old Codex URL is a
  compatibility alias with the same admin-only behavior.
- GET returns registered account information plus independent Codex/Grok roster
  synchronization states. These states are **not** quota or OAuth health checks.
- POST adds a registered email; DELETE removes a user ID; PUT synchronizes the
  existing roster without adding a user. Neither configured owner is removable.
- A mutation reads each relay's actual roster, writes both relays, then saves
  membership. On error it attempts to restore each actual relay snapshot, not a
  guessed DB-derived list. Failed compensation is surfaced as incomplete sync.
- This is best-effort compensation across three stores, not a distributed
  transaction. Mutations are queued within an app instance only. During this
  internal rollout, use one administrator/session at a time; do not submit
  concurrent edits from multiple deployments. After timeout, process interruption,
  or incomplete synchronization, reload and explicitly synchronize before treating
  access as granted/revoked. Multi-admin support needs a distributed coordinator.
- Both relays expose owner-only, HMAC-signed GET/POST `/v1/allowlist`. Ordinary
  members cannot use these control endpoints. Writes persist atomically to 0600
  files; corrupt state fails closed to the owner rather than reviving env entries.

## Release order (requires deployment approval)

1. Through the existing VLab access path, inspect service names, running jobs,
   state paths, and current allowlists. Back up the two server files and
   allowlist state separately. Do not copy or print OAuth credentials.
2. Upgrade **both** relay server files before deploying the new admin API. Preserve
   each service's Unix user, HMAC secret, owner, port, and OAuth state directory.
   Grok needs a writable `GROK_SUBSCRIPTION_ALLOWLIST_PATH`, normally
   `/srv/vlab/makaron-grok-relay/state/allowed-users.json`; if unset, the server
   infers the sibling of `GROK_SUBSCRIPTION_OAUTH_PATH`. Preserve the Codex path.
3. Verify signed GET `/v1/allowlist` against both services and confirm existing
   owner/member traffic still works. An old relay returns 404; the new admin
   reports “无法确认 / Unavailable” and aborts edits before writing either relay.
4. Deploy the application to Preview. GET should report which roster needs sync.
   Preview and Production share a database **and live relay services**: clicking
   add/remove/sync changes real access, even from local development or Preview.
5. With approval for the actual accounts, click **同步两个套餐** once to bring the
   historical Grok subset up to the shared list. Verify both states are synced,
   then exercise Grok Agent and Imagine for a formerly Codex-only member and verify
   provider identity and zero-cost usage. Use test doubles for removal/failure
   checks unless a disposable real account was explicitly approved.
6. Only then merge/deploy according to the normal release gate. Check production
   alias/health and the real admin path; Vercel Ready alone is insufficient.

Do not roll back to the old static-env Grok app after revoking a member without
first reconciling that legacy env list; otherwise API selection may resurrect the
old membership. Preserve persisted relay allowlist files during rollback.

## Local verification

- `npx vitest run`: membership failures, both-owner protection, admin auth,
  compensation and repair, dynamic Grok routing, four-language UI, and real local
  HTTP control of both relays with temporary state files (no upstream generation).
- `npx tsc --noEmit` and `npm run lint`.
- Browser acceptance uses a signed-in admin at the worktree's local URL. Do not
  bypass sign-in or modify shared membership merely to obtain a screenshot.
