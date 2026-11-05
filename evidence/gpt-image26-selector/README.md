# GPT Image 2.6 selector and CLI review — 2026-11-05

- Flare and Sunburst are adjacent in the model picker. A display-only priority leaves Sunburst excluded from automatic routing.
- Removed SVG from all four locale model subtitles. Real SVG generation remains blocked by the provider; existing transport stays experimental.
- Added the 2026-11-05 four-language entry in `src/components/Changelog.tsx`.
- CLI chat/edit help, README and bundled Skill identify GPT Image 2.6 Flare as the go-to for new GIF artwork, mascot loops and animated memes. `animated-gif` stays for existing-frame assembly or explicit timing/export controls.
- Updated generated public Skill copies. CLI 0.17.9 tarball is prepared and fresh-installed locally; all nine packaged files match. npm latest observed at 0.17.8; no npm publication or production deployment performed in this change.

## Validation

- 112 tests across selector, Image 2.6 provider, capability/MCP and existing changelog checks passed.
- Additional prompt-policy, original-format transport, legacy routing and transparency checks passed; see `routing-tests.log`.
- TypeScript (`npx tsc --noEmit --incremental false`) and UI i18n guard passed.
- CLI release preparation: Skill sync/routing receipt, seven sync tests, CLI smoke/upload suite and agent-docs lint passed.
- Codex in-app browser: real ModelSelector/LocaleProvider/Changelog components, four locales, Flare/Sunburst first and second, no SVG subtitle, Flare selection returned matching ID, newest changelog visible, no console warnings/errors.
- Desktop and 390×844 screenshots inspected; adjacent choices and descriptions render without clipping. Browser viewport override was reset.
- Component harness only; this UI check does not repeat full editor/media acceptance. Earlier real GIF GUI/CLI/save/reopen evidence remains in `evidence/gpt-image26-gif-fix` and `evidence/gpt-image26-upgrade`.
- No new paid media calls. Preview remains the previous deployment until a new Preview is deployed.

Browser evidence: `browser-checks.json`, `selector-desktop-zh.png`, `selector-mobile-zh.png`, `changelog-zh.png`.
