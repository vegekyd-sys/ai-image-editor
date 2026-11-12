# Lightweight Worktrees And The Fixed Runtime Runner

Makaron separates code isolation from runtime state:

```text
lightweight feature worktree
  -> committed ref
  -> fixed runtime runner for local UI, build, and Preview
  -> merge into canonical dev
  -> Production from canonical dev only
```

Git-tracked files in this repository are small compared with generated Next.js
state. Feature worktrees therefore share the canonical dependency tree and do
not run Next.js themselves. The fixed runner owns the reusable `.next` cache,
local environment links, and Vercel project identity.

## Create A Feature Worktree

```bash
pnpm run worktree:create -- my-feature --branch codex/my-feature --base dev
```

Creation uses the local base ref and does not fetch by default. Add `--fetch`
only when the worktree must start from freshly updated remote refs.

Feature worktrees are intended for editing, diff review, commits, and lightweight
checks. Do not start Next.js or create `.next` in them.

The repository uses pnpm (version pinned by `packageManager` in `package.json`).
A worktree that needs its own dependencies (for example, a branch that changes
`package.json`) can run `pnpm install --frozen-lockfile` instead of linking;
pnpm hard-links or clones packages from its global store instead of copying a
full `node_modules` per worktree.

## Set Up The Fixed Runner

```bash
pnpm run runner:setup
pnpm run runner:status
```

The default runner lives beside the main repository at
`/Users/tianyicai/ai-image-editor-runner`.

The runner:

- checks out committed refs in detached mode, so the feature branch can remain
  checked out in its own worktree;
- links `.env.local` and `.env.production` from the canonical `dev` worktree;
- copies `.vercel/project.json`;
- shares canonical `node_modules` when `pnpm-lock.yaml` matches;
- installs a disposable local `node_modules` only when the target lockfile
  differs (`pnpm install --frozen-lockfile`; refs from before the pnpm
  migration still use `npm ci`). pnpm links packages from its global store, so
  a disposable install costs little disk;
- keeps one `.next` cache across tested commits.

The runner is machine-managed. Do not make source edits in it.

## Test Or Run A Commit

```bash
pnpm run runner:test -- <commit>
pnpm run runner:dev -- <commit>
pnpm run runner:dev -- <commit> --port 3042
```

`runner:test` runs the repository-native local release gates. With shared
dependencies, the existing release check selects Webpack because Next.js
Turbopack rejects `node_modules` links outside the worktree root.

## Deploy A Preview

```bash
pnpm run runner:preview -- <commit>
```

Preview runs local release gates first, then deploys from the fixed runner.
Use `--skip-check` only when the same commit already passed the complete runner
gate.

## Deploy Production

Production has one exit:

```bash
cd /Users/tianyicai/ai-image-editor
pnpm run release:prod
```

The command refuses to deploy unless:

- the current directory is the worktree that owns `dev`;
- the current branch is `dev`;
- the worktree is clean;
- `.vercel/project.json` exists.

It then runs the full local release gate, deploys with `vercel --prod`, and
checks the canonical production health endpoint.

Use `pnpm run release:prod -- --check-only` to verify the guard without testing
or deploying.
