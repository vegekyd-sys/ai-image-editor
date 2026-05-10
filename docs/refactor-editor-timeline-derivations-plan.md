# Editor refactor plan — timeline derivations

## Chosen slice
Extract pure Editor timeline derivation helpers into `src/lib/editor/timeline-derivations.ts`, with focused tests. Keep React state/effects and all side effects in `Editor.tsx`.

## Allowed files
- `src/lib/editor/timeline-derivations.ts` (new pure helper module)
- `src/components/Editor.tsx` (replace inline derivation logic with helper calls only)
- `__tests__/timelineDerivations.test.ts` (new focused tests)
- this plan doc

## Forbidden files / areas
- Agent runtime and callbacks (`src/lib/agent*`, `src/hooks/useAgentRun.ts`)
- Video/animation generation behavior and polling
- Snapshot persistence/upload/save flows
- API routes, providers, billing, auth
- React state/effect ownership and callback wiring beyond the helper call sites

## Behavior constraints
- Preserve timeline order, virtual draft insertion, and video sentinel semantics.
- Preserve thumbnail/optimized URL selection for current/neighbor/distant snapshots.
- Preserve design timeline index shifting when a draft is active.
- Do not touch snapshotsRef freshness, `makeAgentCallbacks`, draft/view auto-jump logic, `setSnapshots` side effects, iOS GUI/CUI mutual exclusion, `flushSync` popstate, or tips semaphore behavior.
- Helpers must be pure and reversible; no DOM, fetch, state setters, timers, or persistence.

## Validation checklist
- Review diff manually for forbidden areas and behavior drift.
- Run focused unit tests for timeline helpers.
- Run TypeScript check (`npx tsc --noEmit`).
- Run lint for touched files or full lint if practical.
- Build if TypeScript/lint pass within reasonable time.
