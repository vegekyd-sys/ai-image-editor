import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

describe('Admin Codex subscription management', () => {
  it('replaces the invite-era tabs with the runtime allowlist manager', () => {
    const source = fs.readFileSync(path.join(root, 'src/app/admin/page.tsx'), 'utf8');
    expect(source).toContain("setTab('codex')");
    expect(source).toContain('/api/admin/personal-subscription-allowlist');
    expect(source).toContain('admin.personalAllowlist.tab');
    expect(source).toContain('personal-plan-sync');
    expect(source).not.toContain('/api/admin/invite-codes');
    expect(source).not.toContain('/api/admin/waitlist');
    expect(source).not.toContain('Invite Codes');
  });

  it('keeps both owners immutable and delegates mutations to the shared coordinator', () => {
    const source = fs.readFileSync(
      path.join(root, 'src/app/api/admin/codex-subscription-allowlist/route.ts'),
      'utf8',
    );
    expect(source).toContain('The subscription owner cannot be removed');
    expect(source).toContain('getPersonalSubscriptionOwnerUserIds().includes(normalizedUserId)');
    expect(source).toContain('await updatePersonalSubscriptionAllowlist(');
  });
});
