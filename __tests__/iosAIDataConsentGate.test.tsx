import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIDataConsentGate, {
  AI_DATA_CONSENT_STORAGE_KEY,
  shouldLeaveRedirectRootAfterConsent,
} from '@/components/AIDataConsentGate';

const appInfo = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/app', () => ({ App: { getInfo: appInfo } }));

const copy: Record<string, string> = {
  'aiConsent.title': 'Allow AI processing of your content?',
  'aiConsent.body': 'Consent body',
  'aiConsent.dataTitle': 'What is sent',
  'aiConsent.data': 'Photos and prompts',
  'aiConsent.providersTitle': 'Who receives it',
  'aiConsent.providers': 'Named providers',
  'aiConsent.accountData': 'Account data is not sent',
  'aiConsent.allow': 'Allow AI processing and continue',
  'aiConsent.notNow': 'Not now',
  'aiConsent.offTitle': 'AI processing is off',
  'aiConsent.offBody': 'Nothing is sent',
  'aiConsent.review': 'Review and choose again',
  'aiConsent.privacy': 'View Privacy Policy',
};

vi.mock('@/lib/i18n', () => ({
  useLocale: () => ({ t: (key: string) => copy[key] ?? key }),
}));

describe('iOS AI data consent gate', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    localStorage.clear();
    document.cookie = 'makaron_ai_data_consent=; path=/; max-age=0';
    appInfo.mockReset().mockResolvedValue({ id: 'app.makaron.ios', build: '17', version: '1.0.8' });
  });

  afterEach(() => cleanup());

  it('does not affect the web app', () => {
    render(<AIDataConsentGate required={false}><div>Creative app</div></AIDataConsentGate>);
    expect(screen.getByText('Creative app')).toBeTruthy();
  });

  it('blocks iOS application content until the user explicitly allows AI processing', async () => {
    render(<AIDataConsentGate required><div>Creative app</div></AIDataConsentGate>);

    expect(await screen.findByRole('heading', { name: 'Allow AI processing of your content?' })).toBeTruthy();
    expect(screen.queryByText('Creative app')).toBeNull();
    expect(localStorage.getItem(AI_DATA_CONSENT_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Allow AI processing and continue' }));

    expect(screen.getByText('Creative app')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(AI_DATA_CONSENT_STORAGE_KEY) || '{}')).toMatchObject({ version: 1 });
    expect(document.cookie).toContain('makaron_ai_data_consent=v1');
  });

  it('keeps application content blocked when the user chooses not now', async () => {
    render(<AIDataConsentGate required><div>Creative app</div></AIDataConsentGate>);

    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(screen.getByRole('heading', { name: 'AI processing is off' })).toBeTruthy();
    expect(screen.queryByText('Creative app')).toBeNull();
    expect(localStorage.getItem(AI_DATA_CONSENT_STORAGE_KEY)).toBeNull();
  });

  it('restores a previously granted consent without prompting again', async () => {
    localStorage.setItem(AI_DATA_CONSENT_STORAGE_KEY, JSON.stringify({
      version: 1,
      grantedAt: '2026-07-15T00:00:00.000Z',
    }));

    render(<AIDataConsentGate required><div>Creative app</div></AIDataConsentGate>);

    await waitFor(() => expect(screen.getByText('Creative app')).toBeTruthy());
    expect(screen.queryByTestId('ai-data-consent-gate')).toBeNull();
  });

  it('uses the server-visible consent cookie to mount native content on the first render', () => {
    render(
      <AIDataConsentGate required initiallyAccepted>
        <div>Creative app</div>
      </AIDataConsentGate>,
    );

    expect(screen.getByText('Creative app')).toBeTruthy();
    expect(screen.queryByTestId('ai-data-consent-gate')).toBeNull();
  });

  it('only leaves the server redirect root after consent', () => {
    expect(shouldLeaveRedirectRootAfterConsent('/')).toBe(true);
    expect(shouldLeaveRedirectRootAfterConsent('/home')).toBe(false);
    expect(shouldLeaveRedirectRootAfterConsent('/projects')).toBe(false);
  });

  it('omits the page on a known non-target build without recording consent', async () => {
    render(<AIDataConsentGate required requiredBuilds="18"><div>Creative app</div></AIDataConsentGate>);
    await screen.findByText('Creative app');
    expect(screen.queryByTestId('ai-data-consent-gate')).toBeNull();
    expect(appInfo).toHaveBeenCalledOnce();
    expect(localStorage.getItem(AI_DATA_CONSENT_STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain('makaron_ai_data_consent=v1');
  });

  it('still requires explicit permission on the configured build', async () => {
    appInfo.mockResolvedValue({ id: 'app.makaron.ios', build: '18', version: '1.0.9' });
    render(<AIDataConsentGate required requiredBuilds="18"><div>Creative app</div></AIDataConsentGate>);
    await screen.findByRole('heading', { name: 'Allow AI processing of your content?' });
    expect(screen.queryByText('Creative app')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Creative app')).toBeNull();
    expect(localStorage.getItem(AI_DATA_CONSENT_STORAGE_KEY)).toBeNull();
  });

  it('keeps the page if the native build cannot be read', async () => {
    appInfo.mockRejectedValue(new Error('Plugin unavailable'));
    render(<AIDataConsentGate required requiredBuilds="18"><div>Creative app</div></AIDataConsentGate>);
    await screen.findByRole('heading', { name: 'Allow AI processing of your content?' });
    expect(screen.queryByText('Creative app')).toBeNull();
  });

  it('allows the page to be disabled explicitly without recording consent', async () => {
    render(<AIDataConsentGate required requiredBuilds="none"><div>Creative app</div></AIDataConsentGate>);
    await screen.findByText('Creative app');
    expect(appInfo).not.toHaveBeenCalled();
    expect(localStorage.getItem(AI_DATA_CONSENT_STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain('makaron_ai_data_consent=v1');
  });
});
