import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPage from '@/app/admin/page';
import { LocaleProvider } from '@/lib/i18n';
import { translate, type Locale } from '@/lib/locales';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/native-navigation', () => ({ navigateBackInIOSApp: () => false }));

const roster = {
  users: [
    { userId: 'owner', email: 'owner@test.invalid', isOwner: true },
    { userId: 'member', email: 'member@test.invalid', isOwner: false },
  ],
  providers: { codex: 'synced', grok: 'pending' },
};
let mutate: (init: RequestInit) => Promise<Response>;

beforeEach(() => {
  mutate = async () => Response.json({ ...roster, providers: { codex: 'synced', grok: 'synced' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/personal-subscription-allowlist') {
      if (init?.method) return mutate(init);
      return Response.json(roster);
    }
    if (url === '/api/admin/meta/status') return Response.json({}, { status: 503 });
    if (url === '/api/admin/billing-toggle') return Response.json({ enabled: false });
    return Response.json([]);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

async function mount(locale: Locale = 'zh') {
  localStorage.setItem('locale', locale);
  render(<LocaleProvider initialLocale={locale}><AdminPage /></LocaleProvider>);
  await screen.findByText('owner@test.invalid');
}

describe('personal plan management UI', () => {
  it.each(['zh', 'zh-Hant', 'en', 'ja'] as const)('renders one roster and two translated states in %s', async locale => {
    await mount(locale);
    expect(screen.getByRole('button', { name: `${translate(locale, 'admin.personalAllowlist.tab')} (2)` })).toBeTruthy();
    const statuses = screen.getByTestId('personal-plan-sync').textContent;
    expect(statuses).toContain(translate(locale, 'admin.personalAllowlist.codexStatus', translate(locale, 'admin.personalAllowlist.synced')));
    expect(statuses).toContain(translate(locale, 'admin.personalAllowlist.grokStatus', translate(locale, 'admin.personalAllowlist.pending')));
    expect(screen.getAllByRole('button', { name: translate(locale, 'admin.personalAllowlist.remove') })).toHaveLength(1);
  });

  it('syncs both providers without adding a member and refreshes their visible status', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: '同步两个套餐' }));
    await screen.findByText('Codex 与 Grok 名单已同步');
    expect(screen.getByTestId('personal-plan-sync').textContent).toContain('Grok · 已同步');
    expect(fetch).toHaveBeenCalledWith('/api/admin/personal-subscription-allowlist', expect.objectContaining({ method: 'PUT', body: undefined }));
  });

  it('disables mutations while pending and recovers from a network failure with an honest error', async () => {
    let reject!: (reason: Error) => void;
    mutate = () => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
    await mount();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new@test.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: '添加账号' }));
    expect((screen.getByRole('button', { name: '同步两个套餐' }) as HTMLButtonElement).disabled).toBe(true);
    reject(new Error('network offline'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('两个套餐未能全部同步'));
    expect((screen.getByRole('button', { name: '添加账号' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('textbox').getAttribute('value')).toBe('new@test.invalid');
    expect(screen.getByTestId('personal-plan-sync').textContent).toContain('Grok · 待同步');
  });
});
