# Internal table access

`agent_challenges`, `credit_pricing`, `health_alerts`, `subscriptions`, and `token_rates` are server-only tables. Product endpoints authorize requests before using the service-role client; browser/anonymous roles do not need direct access. Enable RLS without browser policies and revoke their table grants. The service-role privileges remain unchanged.

Deploy the health-check cron client change before applying migration `20261022091148_lock_down_internal_public_tables.sql`. Do not batch unrelated historical migrations. The migration aborts on unexpected policy or column-grant drift.

Validation: `python3 scripts/test-internal-tables-rls.py` creates a disposable socket-only PostgreSQL instance and verifies denied browser operations, server CRUD, ownership-filtered reads, idempotence, and policy-drift refusal. Set `LOCAL_PG_BIN` to the installed PostgreSQL binaries if necessary. All rows are synthetic. `npx vitest run __tests__/healthCheckRls.test.ts` covers cron authentication and persistence failures.

After release, verify the security advisor, anon/authenticated rejection, service reads, real registration and billing API paths, and health alert persistence. A healthy response alone does not test the fault-recording branch. Preserve RLS when resolving regressions rather than reopening anonymous access.
