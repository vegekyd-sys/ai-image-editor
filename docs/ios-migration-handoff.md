# iOS Migration Handoff

Last updated: 2026-05-31

Branch: `codex/ios-migration-success`

## Goal

Makaron iOS App uses a Capacitor native shell around the existing Next.js app.
The product code should stay shared across Web/H5 and iOS wherever possible.
iOS-only behavior must be gated by native app detection, usually the
`MakaronIOS` appended user agent via `src/lib/native-app.ts`.

The current target is a stable iOS app experience that keeps Web/H5 behavior
unchanged.

## Recent Commit Trail

- `fa90eee Stabilize iOS project navigation`
  - Stabilized the iOS native shell, safe area, keyboard, status bar, launch
    screen, CUI pan close, and project editor overlay boundaries.
- `8a44b5d Refresh iOS project cards after return`
  - Kept the iOS projects list visually alive during editor return while
    refreshing changed project card data after edits.
- `4b9da9d Add iOS home skill swipe back`
  - Added local iOS left-edge swipe to close `/home` skill detail overlays,
    without reusing project navigation logic or changing Web/H5 history.

## Architecture Decisions

1. One codebase, two release surfaces.
   - Web/H5 deploys through Vercel.
   - iOS ships a Capacitor shell through Xcode/App Store.
   - Most feature updates should land once in the shared Next app.

2. Native shell should not own Web state.
   - Native/Capacitor detects app context and initializes keyboard, safe area,
     status bar, splash screen, and limited bridge behavior.
   - Route state, editor state, CUI state, project list state, and home skill
     overlays remain in React.

3. Project editor navigation on iOS is inline, not real route switching.
   - `/projects` keeps the list DOM alive.
   - Opening a project in iOS app renders `ProjectEditorContainer` as a full
     screen overlay.
   - Returning should not reload `/projects`, should not flash black/white, and
     should still refresh changed project card data.
   - Direct `/projects/:id` deep links still use the standalone route.

4. CUI close and route back are separate.
   - CUI has its own pan-to-close behavior.
   - Project editor close does not own CUI close.
   - If CUI is open, CUI close should win before project detail exit.

5. Home skill detail uses a local overlay gesture.
   - H5/Safari already gets back behavior through browser history.
   - iOS app needs a scoped left-edge gesture on the skill detail overlay.
   - It must not use body transforms, cloned screenshots, or global back
     handlers.

## Important Files

- `capacitor.config.ts`
  - Production Capacitor config.
  - Must not ship with local `server.url`.

- `ios/App/App/capacitor.config.json`
  - Generated/synced iOS config.
  - During local device testing it may point to `http://192.168.1.10:3001`.
  - Before Archive/TestFlight/App Store, run `npm run ios:prod` and sync.

- `src/lib/native-app.ts`
  - Source of truth for detecting Makaron iOS app shell.

- `src/components/NativeAppBootstrap.tsx`
  - Native app bootstrapping only.
  - Do not add project route-back logic here.

- `src/app/projects/page.tsx`
  - iOS inline project navigation lives here.
  - Keep `/projects` DOM alive while the editor overlay is open.

- `src/components/ProjectEditorContainer.tsx`
  - Shared editor data-loading container for inline iOS overlay and direct
    `/projects/:id` route.

- `src/components/Editor.tsx`
  - CUI history and CUI pan-to-close behavior.

- `src/app/home/page.tsx`
  - Home skill detail overlay and iOS local left-edge close gesture.

- `__tests__/iosAppStoreReadiness.test.ts`
  - Static guardrails for the iOS migration.

## Do Not Reintroduce

- Global `document.body.style.transform` for iOS back gestures.
- Screenshot/clone overlays for project back animation.
- NativeAppBootstrap project route-back handlers.
- Real `/projects/:id` route handoff when tapping a project card inside iOS app.
- `window.history.back()` for iOS project overlay close.
- Local dev server URL in production Capacitor config.
- App-wide gesture handlers that can steal CUI or home skill overlay gestures.

## Local iOS Testing Setup

Use the iOS migration worktree:

```bash
cd /Users/tianyicai/ai-image-editor-ios-migration
```

Build the web app and serve it on the LAN for the iPhone:

```bash
npm run build
npm run start:ios
```

Local iPhone URL currently expected by the debug app:

```text
http://192.168.1.10:3001
```

If `ios/App/App/capacitor.config.json` needs to be pointed back to the local
server:

```bash
IOS_DEV_SERVER_URL=http://192.168.1.10:3001 npm run ios:local
npx cap sync ios
```

Before production archive:

```bash
npm run ios:prod
npx cap sync ios
```

## Verification Commands

Run these before committing iOS navigation or shell changes:

```bash
npm run test:ios
npx eslint src/app/home/page.tsx src/app/projects/page.tsx src/components/Editor.tsx src/components/ProjectEditorContainer.tsx __tests__/iosAppStoreReadiness.test.ts
git diff --check
npm run build
```

Expected note: `src/app/home/page.tsx` currently has pre-existing lint warnings.
Treat lint errors as blockers; warnings should be reviewed but are not new
failures unless the change introduces them.

## Manual Device Checklist

Projects:

- `/projects` opens from home without layout jumping.
- Tap a project card: editor opens as iOS inline overlay.
- Top-left editor back returns to list without black/white flashing.
- Left-edge slow swipe returns to list with live projects list behind it.
- After creating/committing a new snapshot, returning updates card cover/snap
  count without full list reload.
- If CUI is open, left-edge swipe closes CUI first.

Home and skills:

- `/home` skill card opens detail overlay.
- H5/Safari back still closes the skill detail.
- iOS app left-edge slow swipe closes skill detail.
- iOS skill detail close should not show the Web/H5 hero shrink animation.
- Vertical swipe between skill detail slides still works.

Keyboard/CUI:

- CUI input moves above keyboard on real iPhone.
- CUI pan-to-close remains smooth.

Shell:

- Launch screen is dark and uses Makaron branding.
- Top bar/safe area does not overlap Dynamic Island/status bar.
- Upload image and CUI chat still work.

## Release Model

Web release:

- Merge shared code to the release branch.
- Deploy Vercel production.
- iOS app will pick up shared web changes when it loads production web content.

iOS binary release:

- Required for native shell, icon, launch screen, permission strings, Capacitor
  plugin/config, or App Store metadata changes.
- Run `npm run ios:prod && npx cap sync ios`.
- Open Xcode, build on device once, then Archive and upload to TestFlight.

The correct mental model is: one shared product codebase, separate Web and iOS
release artifacts.
