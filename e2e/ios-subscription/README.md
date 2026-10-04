# iOS subscription E2E

Runs the subscribe-before-register flow against an isolated local stack:

- dedicated iOS Simulator and `MakaronE2E.storekit`
- local Supabase on ports 55321-55324
- Mailpit OTP delivery and retrieval
- local Next.js E2E server on port 3002

Run from the repository root:

```bash
npm run e2e:ios-subscription
```

The command erases only the Simulator named `Makaron iOS Subscription E2E`,
resets only the local E2E database, clears local StoreKit transactions, drives
the full UI flow, asserts the resulting database state, and exports screenshots
and `.xcresult` bundles under `.artifacts/ios-e2e/`.

## Safety boundary

The E2E backend sets `MAKARON_E2E=1` and accepts `Xcode` / `LocalTesting`
transactions only while `NEXT_PUBLIC_SUPABASE_URL` is loopback. Production and
TestFlight must not set `MAKARON_E2E` and must accept only `Sandbox` /
`Production` Apple environments. Never point this scheme at Preview or
Production Supabase.
