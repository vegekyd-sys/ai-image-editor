# app_settings server-only access repair

## Scope and approval boundary

The owner requested an isolated repair, merge to dev, then production release and
first-visible-text regression acceptance. Applying production SQL requires a
separate confirmation after reviewing this change. A dev merge alone does not
apply this migration. Preview and Production share this database.

## Read-only findings (2026-09-06 Shanghai)

Production is PostgreSQL 17.6. `public.app_settings` is owned by `postgres`, RLS is
disabled, and `anon` / `authenticated` have all table privileges, including
INSERT, UPDATE, DELETE and TRUNCATE. No policies, referencing function bodies,
views or user triggers were found by the catalog query. Five existing settings
cover billing, welcome credits, iOS trial credits, registration and personal-plan
membership. A private baseline records value fingerprints and timestamps.
No production write was used to reproduce this finding.

All repository application callers use the server-side service-role client:
`billing/credits`, `billing/welcome-credits`, `billing/ios-trial`,
`codex-subscription-allowlist`, agent registration and admin billing settings.
Browser users reach authorized server routes; they do not need direct table access.

The settings table does not provide a change-history ledger. Current timestamps
and fingerprints are a baseline, not evidence that no historical unauthorized
change occurred. In particular, historical personal-plan membership changes need
separate attribution against available application/platform logs if investigated.

## Repair

Apply only `supabase/migrations/20260905165832_protect_app_settings.sql`:

1. In one transaction, enable RLS and revoke all table and explicit column
   privileges from PUBLIC, anon and authenticated.
2. Preserve service_role reads/writes and the table owner. No new client policies.
3. Do not change any setting value, user balance, membership or Core Prompt mode.
4. Limit lock wait to 5 seconds and statement execution to 30 seconds.

The admin Billing PUT route additionally checks errors, validates the whole request
before writing, and batches settings into one atomic upsert. Cache invalidation
happens only after success. Authorization still requires a verified administrator.

## Isolated verification

`scripts/security/test-app-settings-permissions.mjs` runs synthetic fixtures in
PGlite 0.3.14 (PostgreSQL 17.5), entirely in memory, without credentials/network.
It reproduces the old anonymous write locally, tests a failed migration rollback,
repeat application, PUBLIC and column grants, deliberately permissive policies,
anonymous/authenticated SELECT/INSERT/UPSERT/UPDATE/DELETE/TRUNCATE rejection,
unchanged values/timestamps and successful service-role CRUD.

The database test is actual PostgreSQL privilege execution, not a mocked client;
it does not simulate production PostgREST or its connection pool. Post-release
catalog and HTTP rejection checks cover that boundary separately.

Admin-route tests cover unauthorized callers, database denial, no false success,
no premature cache invalidation, atomic saves, validation and omitted fields.

## Production sequence (pending owner confirmation)

1. Re-run `scripts/security/audit-app-settings.sql` using the management API's
   read-only mode. Keep its output private; compare against the baseline. If the
   schema/callers/permissions changed, review the difference first.
2. Apply the single reviewed migration through the management connection. Do not
   use a broad `db push` that may apply unrelated pending migrations.
3. Run the read-only audit again: RLS true; PUBLIC/anon/authenticated table and
   column grants gone; service_role SELECT/INSERT/UPDATE/DELETE allowed; all five
   settings fingerprints and timestamps unchanged.
4. Verify unauthenticated REST SELECT is denied; verify ordinary-user access if a
   test-user credential is available. Do not insert probe rows in production.
5. Verify existing authenticated admin GETs for Billing, personal-plan membership
   and Core Prompt; verify non-admin routes remain forbidden.
6. Deploy the reviewed dev commit through the project's production release flow.
   Check both canonical domains, deployed revision, health and application flow.

## Rollback

- SQL error or lock timeout: roll back the entire uncommitted transaction; do not
  retry through public credentials. The local test exercises this rollback.
- Application regression after commit: roll back the web deployment to the
  captured pre-release deployment and verify both canonical domains. The old code
  already uses service_role and is compatible with the restricted table.
- Keep the permission repair during application rollback. Do not restore the old
  public grants or disable RLS: that would reopen the reported exposure.
- If service-role access fails, stop rollout and inspect role identity and grants;
  restore only its intended SELECT/INSERT/UPDATE/DELETE permission, with the
  owner's production approval. Leave values and customer balances untouched.

## First-visible-text acceptance prepared for after release

Use fresh empty projects and the same provider/model on each comparison; capture
send to first non-empty rendered assistant text, first text SSE, completion,
errors, model/provider, cold/warm and cache information when available. A spinner,
HTTP headers or status event is not first assistant text.

Repeat ordinary greeting, short rewrite and capability explanation (at least five
runs per case), retain failures, report P50/P75/P90 and individual results. Confirm
layered mode from the authorized read-only admin route and request evidence; do
not toggle the global prompt switch for benchmarking.

Historical `docs/core-prompt-refactor/acceptance-speed.json` contains provider-level
baseline/candidate data for greeting and rewriting. Show it as historical context
with its measurement boundary, not a directly equivalent browser-to-production
A/B. Preserve the distinction between a permission regression check and a causal
claim that the prompt refactor improved every scenario.

## Verification completed before production approval

- Tested implementation revision: `ae11802b` in a dedicated clean runner (the
  shared runner was dirty and was not changed).
- PostgreSQL isolation: 20 assertions passed, including transaction rollback.
- Full suite: 274 test files, 1,669 tests passed; 1 existing test skipped.
- TypeScript, CLI smoke, lint/i18n/startup/video-reference guards and optimized
  Webpack production build passed. Existing libheif dynamic-require build warning
  also occurs on the unchanged baseline.
- Supabase read-only Security Advisors independently reports
  `rls_disabled_in_public` for `public.app_settings`. Other advisor findings are
  outside this table repair; this is not a claim that the entire project is clean.
- Production SQL, deployment and live latency regression remain pending the
  owner's requested production confirmation.
