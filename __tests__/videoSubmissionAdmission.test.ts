import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
const request = { script: 'A purple ghost dances', images: [], videoModel: 'seedance-2.5-flash', duration: 4 };

describe('video submission admission boundary', () => {
  it.each(['Insufficient credits', 'Could not confirm credit reservation'])(
    'does not claim an unknown provider submission when admission rejects: %s', async message => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const admission = vi.fn().mockRejectedValue(new Error(message));
      const { createVideo } = await import('@/lib/skills/create-video');
      expect(await createVideo({ ...request, onBeforeProviderSubmit: admission }))
        .toMatchObject({ success: false, submissionUncertain: false, message });
      expect(admission).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('preserves unknown outcome protection when a POST fails after admission', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'test');
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('socket disconnected'));
    vi.stubGlobal('fetch', fetchMock);
    const admission = vi.fn().mockResolvedValue(undefined);
    const { createVideo } = await import('@/lib/skills/create-video');
    expect(await createVideo({ ...request, onBeforeProviderSubmit: admission }))
      .toMatchObject({ success: false, submissionUncertain: true });
    expect(admission).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('submits once and returns the provider receipt after admission succeeds', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'test');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'accepted-fixture' })));
    vi.stubGlobal('fetch', fetchMock);
    const admission = vi.fn().mockResolvedValue(undefined);
    const { createVideo } = await import('@/lib/skills/create-video');
    expect(await createVideo({ ...request, onBeforeProviderSubmit: admission }))
      .toMatchObject({ success: true, taskId: 'accepted-fixture' });
    expect(admission).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
