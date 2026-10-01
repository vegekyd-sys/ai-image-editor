# iOS AI Consent Page Build Policy

The web layout passes the server-side `IOS_AI_CONSENT_REQUIRED_BUILDS` setting
to the consent gate. It reads the installed build through the existing Capacitor
App plugin, so old shells do not need a new native release for this policy.

- Unset, empty, or `all`: preserve the existing consent page on every iOS build.
- `18`: show it on build 18 only. A comma-separated list supports multiple builds.
- `none`: omit the page on all builds.
- Invalid policy or unreadable build: retain the page.
- Existing explicit consent continues to suppress repeat prompts.

Omitting the page never writes a consent cookie or a localStorage grant. It does
not represent user permission. The policy is identical for everyone using the
same build; there is no reviewer, account, location, or device classification.
Changing it takes a new web deployment, not an App Store binary update.

## Candidate Phone Configuration

For the 2026-10-01 phone Preview, the user requested the launch page removed.
The test shell remains version 1.0.8 build 17 with the unchanged old native media
implementation. The per-deployment setting is `18`: build 17 omits the page,
while build 18 retains it. Build 18 is a provisional next-build target, not a
claim that this build has been submitted or approved.

App Store Connect read-only inspection was blocked by a required-agreement
error, so the latest submitted build could not be confirmed. Confirm the exact
target before production rollout. Shared Preview configuration and production
are not changed by this deployment.

## Review Boundary

The previous 1.0.2 rejection required clearer disclosure and explicit permission
before sharing user content with third-party AI. Omitting this page without an
equivalent permission flow removes that remediation for the affected builds.
This change is a user-requested candidate behavior, not a claim of App Review
compliance or an approved production privacy-policy change. Do not publish it
as production without the separate production acceptance decision.
