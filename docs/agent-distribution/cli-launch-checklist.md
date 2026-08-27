# Makaron CLI Agent distribution launch checklist

## Positioning

Use one consistent category statement:

> Makaron CLI gives every AI agent a creative agent. Pass the complete request and source media to `makaron chat`; Makaron plans and produces the finished work in a persistent project that a human can continue editing in makaron.app.

Do not position Makaron as only a model aggregator or generic image generator.

## Implemented in this branch

- Open Agent Skills discovery index at `/.well-known/agent-skills/index.json`.
- Canonical `/skill.md` and one installable `makaron` Agent Skill.
- SHA-256 digest generation and stale-artifact checks.
- Public, cacheable, CORS-enabled discovery responses.
- `OAI-SearchBot` access and crawlable `/mcp` documentation.
- Rich `.codex-plugin/plugin.json` metadata and a repo-local marketplace.
- Claude plugin metadata aligned to CLI version.
- Five positive and three negative discovery evals; every positive case routes to the same `makaron` Skill and `makaron chat`.

## GEO deployment gate

The external source-range handoff is the approved CLI change for `0.13.5`. Keep the CLI package, bundled Skill, and plugin metadata on that version for this release.

Before deploying the website discovery surfaces:

1. Run `npm run build:agent-discovery`.
2. Run `npm run check:agent-discovery`.
3. Run `npm run lint:agent-docs`.
4. Run `npm run test:cli` and `npm test`.
5. Run `npm run lint` and `npm run build`.
6. On a preview deployment, verify `GET` and `HEAD` return `200` for `/llms.txt`, `/skill.md`, the discovery index, and the canonical Makaron Skill URL without cookies.
7. Install from the preview origin in a clean temporary agent environment and run one real image workflow before production release.

## OpenAI first submission

Submit a skills-only plugin containing only the canonical `makaron` Skill. This gets Makaron into the universal directory shared by ChatGPT and Codex without waiting for MCP OAuth work.

Required human or external steps:

- Deploy these endpoints. No npm publish is required for this GEO rollout.
- Create a public distribution repository or omit the repository URL until it exists.
- Add public Terms of Service reviewed by the publisher.
- Prepare logo, category, support, privacy, starter prompts, regions, and release notes.
- Use `evals/agent-discovery.json` as the required five positive and three negative test cases.
- Complete OpenAI developer or business identity verification and submit through the plugin portal.

Official requirements: <https://developers.openai.com/plugins/deploy/submission>

## Claude follow-up submission

Claude Suggested Connectors requires a Directory-listed remote MCP server. Before submission:

- Add OAuth 2.0 to the remote MCP service.
- Add `title`, `readOnlyHint`, and applicable `destructiveHint` annotations to every tool.
- Review tool output for secrets, internal identifiers, and unnecessary personal data.
- Add a public Terms of Service and complete connector documentation.
- Run a real image, video, music, status, and insufficient-credit acceptance suite.
- Submit from a Claude Team or Enterprise organization with Directory access.

Official requirements: <https://claude.com/docs/connectors/building/submission>

## Future CLI release

Create a new CLI version only when the executable, bundled Skill, or npm package metadata actually changes. Treat private repository metadata cleanup and any npm packaging changes as a separate CLI release with its own tests and release notes.

## Do not claim completion until visible

- A deploy is complete only after public endpoints return the expected content without authentication.
- An npm release is complete only after the registry reports the new version and a clean `npx` invocation works.
- A directory submission is not an approved listing.
- GEO success requires repeated category-prompt measurement, not only exact-brand searches.
