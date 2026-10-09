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

`npm run build` runs `scripts/check-server-runtime.mjs` in its `postbuild` gate.
It checks the actual Next API file traces for the executable CRC32C entry, not
just its package.json. This covers Agent, video polling, materialize, Remotion,
and their cron handlers. A missing runtime blocks both local and Vercel builds.
After release, probe the affected API routes as well as `/api/health`: health
can pass while a different function fails to load its server dependencies.

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

Feature worktrees stay lightweight and do not create their own Next.js runtime
cache. Test committed feature refs and deploy Preview from the fixed runner:

```bash
npm run runner:test -- <commit>
npm run runner:preview -- <commit>
```

Production is only released from the clean canonical `dev` worktree:

```bash
npm run release:prod
```

See `docs/worktree-runtime-runner.md` for setup, dependency-lock behavior, and
the complete worktree-to-release contract.

After production deploy, verify the canonical alias and health endpoint:

```bash
curl -sSI https://www.makaron.app | sed -n '1,20p'
curl -sS https://www.makaron.app/api/health
```

Expected: alias resolves, app loads, and `/api/health` reports all critical services healthy or has a known, scoped exception.

## CLI Publish

Every release must assess CLI and npm parity, including model/provider and API changes that do not directly touch `packages/makaron-cli`. Check whether the shipped capabilities, parameters, help, README, and bundled Skill need an update. If they do, update and publish the CLI in the same release loop; a website deployment does not complete a CLI release. If no package update is needed, record that conclusion in the release result.

Before publishing:

- Compare the npm package contents with the accepted repository package. Equal version numbers alone do not prove parity.
- Update CLI behavior, help, README, and canonical `packages/makaron-cli/skills/makaron/SKILL.md` as applicable. Keep unaccepted feature branches out of the package.
- Bump and align `package.json`, `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, and `evals/agent-discovery.json`.
- Run `npm run build:agent-discovery` and `npm run check:agent-discovery` when Skill contents change; inspect the actual tarball, including references and plugin metadata.
- Release any required production API before the npm package that depends on it. Reuse authorization for the agreed release scope; a request to prepare without publishing still takes precedence.

```bash
npm --prefix packages/makaron-cli test
cd packages/makaron-cli
npm publish --dry-run
npm publish
npm view makaron-cli version dist.shasum
npm dist-tag ls makaron-cli
npm exec --yes --package=makaron-cli@<published-version> -- makaron --version
npm exec --yes --package=makaron-cli@<published-version> -- makaron --help
```

Wait for the registry to expose the published version and `latest` tag, then install into a fresh temporary directory and check the affected commands and bundled Skill. Verify the published tarball hash matches the inspected artifact. A successful `npm publish` response alone is not completion evidence.

The release result must state the app deployment status, CLI version, npm `latest`, and fresh-install verification separately. Do not leave npm publishing as an untracked follow-up after announcing the feature is released.

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
