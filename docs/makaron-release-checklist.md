# Makaron Release Checklist

Use this for Makaron app releases, model launches, production deploys, and CLI publishes. The goal is to keep code, Vercel, production health, npm, changelog, and memory in one release loop instead of treating them as separate tasks.

## Release Surface

Before changing or shipping anything, write down:

- Repo and worktree: `pwd`, branch, and whether this is the main repo or an isolated worktree.
- Product surface: app only, CLI only, model/provider, marketing page, billing, iOS, or ops.
- Target environment: local, preview, production, npm, or all of them.
- New external dependencies: API keys, Vercel env vars, webhook secrets, model/provider routes, hosted workers.
- Required smoke evidence: browser flow, HTTP smoke, provider smoke, `/api/health`, or npm install/help.

## Pre-Merge Gates

Run the narrowest reliable gate first, then broaden only as needed:

```bash
npx tsc --noEmit
npm run test
npm run test:cli
npm run build
```

`npm run lint` is useful for new errors, but this repo can have existing warnings. Do not let unrelated lint noise replace targeted tests, build, and smoke evidence.

For new model/provider work, add these checks:

- Dedicated task id namespace or route prefix when the provider has distinct polling/status behavior.
- Capability block updated before UI copy, model selector, skill routing, and loading copy.
- Provider smoke script or HTTP smoke that proves the model path is not falling back to another provider.
- Cost and speed noted when the model is user-visible.

## Environment Parity

Before production deploy, explicitly verify new required env vars exist in both Preview and Production. Use `printf`, not `echo`, when writing Vercel env values:

```bash
printf 'value' | npx vercel env add NAME preview --force
printf 'value' | npx vercel env add NAME production --force
```

For model launches, the common production failure is a missing live env var, not a code merge issue.

## Deploy

Preview:

```bash
npx vercel
```

Production:

```bash
npx vercel --prod
```

After production deploy, verify the canonical alias and health endpoint:

```bash
curl -sSI https://www.makaron.app | sed -n '1,20p'
curl -sS https://www.makaron.app/api/health
```

Expected: alias resolves, app loads, and `/api/health` reports all critical services healthy or has a known, scoped exception.

## CLI Publish

If the release touches `packages/makaron-cli`, or the user asks to bump/publish npm, keep CLI release in the same release loop.

```bash
npm --prefix packages/makaron-cli test
npm publish --prefix packages/makaron-cli --dry-run
npm publish --prefix packages/makaron-cli
npm view makaron-cli version
npm dist-tag ls makaron-cli
npx -y makaron-cli@latest --help
```

Confirm package version and docs match the shipped product behavior.

## Public Copy

Release copy should be short and product-facing:

- What users can now do.
- Why it is better or faster.
- Which model/tool is the right default, only when that helps product clarity.

Avoid implementation-only wording in changelog and README updates.

## Memory Writeback

After an important release, update the smallest matching memory surface:

- Makaron project facts: `~/.codex/wiki/projects/makaron/memory/`.
- Cross-project Codex behavior: `~/.codex/memories/extensions/ad_hoc/notes/`.
- Do not update global index/log files unless the structure or routing changed.

The release is not closed until code, production, CLI surface if applicable, user-facing copy, and durable memory are consistent.

