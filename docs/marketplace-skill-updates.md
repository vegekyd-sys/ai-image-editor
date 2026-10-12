# Published marketplace Skill updates

`POST /api/skills` with `homeSkillId` resolves the current active marketplace row
on the server. `skillPath` from cached clients is advisory. Local ZIP uploads and
Skills without a marketplace relationship retain their normal independent lifecycle.

A SHA-256 source fingerprint covers the published `skill_path` and `updated_at`.
Publish ZIPs at a new immutable URL and update the marketplace row; republishing at
the same URL must advance `updated_at` and invalidate upstream storage/CDN caches.
The admin editor advances `updated_at` when saving. Cosmetic metadata saves may
cause one extra synchronization; unchanged launches avoid ZIP downloads entirely.

Legacy installations synchronize once. Their selected Skill name remains stable.
New assets, SKILL.md, and the discovery sidecar are uploaded to unique immutable
objects before `commit_marketplace_skill` replaces the associated workspace index
in one transaction. A per-user transaction advisory lock handles concurrent
installs; source row locking rejects a publication superseded during preparation.
Concurrent matching installs reuse the winner. Failed preparations remove only
their own unreferenced staged objects, checking references after ambiguous commits.
Old published objects remain available to in-flight readers; no unrelated files or
shares are removed. Assets from legacy installs without relationship metadata are
preserved; new assets use fingerprint-qualified logical paths. Reserved discovery
sidecars under an already linked Skill are replaced together with its content.

Custom or other-template destination collisions cannot be overwritten. New installs
allocate an unused name; conflicting updates fail before the transaction mutates
files. A failed update blocks that launch rather than executing the old version.
The trusted App/Run launch verifier checks publication freshness again, covering
updates between installation and start. Chat CLI already calls the same install
API before running a marketplace Skill.

Workspace reads of user Skills bypass the process-local content cache, and immutable
storage URLs identify local mirror files. This prevents separate workers, equal-size
edits, or a surviving local cache from executing an earlier SKILL.md.

Deployment order: apply the additive migration before deploying the API. Old app
versions ignore the new nullable column and RPC. Reverting the app leaves installed
files readable, but restores the old dedup behavior; source synchronization is not
accepted after such a rollback.
