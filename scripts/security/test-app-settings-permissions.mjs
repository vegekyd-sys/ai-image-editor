// Local PostgreSQL WASM only: no credentials, URLs, production data or network.
// npm install --prefix <scratch> --save-exact @electric-sql/pglite@0.3.14
// PGLITE_MODULE=<scratch>/node_modules/@electric-sql/pglite/dist/index.js node scripts/security/test-app-settings-permissions.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const modulePath = process.env.PGLITE_MODULE;
if (!modulePath) throw new Error('Set PGLITE_MODULE to a locally installed PGlite module');
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
const migration = readFileSync(new URL('../../supabase/migrations/20260905165832_protect_app_settings.sql', import.meta.url), 'utf8');
let checks = 0;
async function denied(role, sql) {
  await db.exec(`SET ROLE ${role}`);
  try {
    await assert.rejects(() => db.exec(sql), error => error.code === '42501');
    checks++;
  } finally { await db.exec('RESET ROLE'); }
}
try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE public.app_settings (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz DEFAULT now());
    GRANT ALL ON public.app_settings TO anon, authenticated, service_role;
    INSERT INTO public.app_settings (key,value) VALUES
      ('billing_enabled','true'), ('welcome_credits','500'),
      ('ios_trial_credits','1500'), ('agent_registration_enabled','true'),
      ('codex_subscription_allowed_user_ids','["fixture-only"]');
  `);
  // Reproduce the old permission defect only in disposable, synthetic data.
  await db.exec("SET ROLE anon; INSERT INTO public.app_settings (key,value) VALUES ('local_probe','true'); RESET ROLE;");
  await db.exec("DELETE FROM public.app_settings WHERE key='local_probe'");
  const before = (await db.query('SELECT * FROM public.app_settings ORDER BY key')).rows;
  // Test PUBLIC inheritance and independent column grants as well as the
  // currently observed table grants. A future policy must not reopen the API.
  await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON public.app_settings TO PUBLIC;
    GRANT SELECT(key,value),UPDATE(value),INSERT(key,value) ON public.app_settings TO PUBLIC,anon,authenticated;
    CREATE POLICY deliberately_permissive_fixture ON public.app_settings FOR ALL TO PUBLIC USING (true) WITH CHECK (true);`);
  // Simulate a failed transaction: all DDL must roll back together.
  await assert.rejects(() => db.exec(migration.replace('COMMIT;', 'SELECT 1/0; COMMIT;')));
  await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.app_settings'::regclass")).rows[0].relrowsecurity, false);
  checks++;
  await db.exec(migration);
  await db.exec(migration); // Repeat application remains safe.
  for (const role of ['anon', 'authenticated']) {
    for (const sql of [
      'SELECT * FROM public.app_settings',
      'SELECT value FROM public.app_settings',
      "INSERT INTO public.app_settings(key,value) VALUES ('local_probe','false')",
      "INSERT INTO public.app_settings(key,value) VALUES ('billing_enabled','false') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
      "UPDATE public.app_settings SET value='false' WHERE key='billing_enabled'",
      "DELETE FROM public.app_settings WHERE key='billing_enabled'",
      'TRUNCATE public.app_settings',
    ]) await denied(role, sql);
  }
  assert.deepEqual((await db.query('SELECT * FROM public.app_settings ORDER BY key')).rows, before);
  checks++;
  await db.exec('SET ROLE service_role');
  assert.deepEqual((await db.query('SELECT * FROM public.app_settings ORDER BY key')).rows, before);
  checks++;
  await db.exec(`INSERT INTO public.app_settings(key,value) VALUES ('service_fixture','1');
    INSERT INTO public.app_settings(key,value) VALUES ('service_fixture','2') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;`);
  assert.equal((await db.query("SELECT value FROM public.app_settings WHERE key='service_fixture'")).rows[0].value, '2');
  checks++;
  await db.exec("DELETE FROM public.app_settings WHERE key='service_fixture'; RESET ROLE;");
  assert.deepEqual((await db.query('SELECT * FROM public.app_settings ORDER BY key')).rows, before);
  assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.app_settings'::regclass")).rows[0].relrowsecurity, true);
  checks += 2;
  console.log(JSON.stringify({ passed: checks, engine: (await db.query('SELECT version()')).rows[0].version, isolation: 'in-memory PostgreSQL, synthetic rows, no network' }, null, 2));
} finally { await db.close(); }
