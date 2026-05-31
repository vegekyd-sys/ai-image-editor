import { describe, expect, it, vi } from 'vitest';
import { navigateBackInIOSApp } from '@/lib/native-navigation';

function makeEnv(options: { historyLength: number; isIOSApp: boolean }) {
  return {
    history: {
      length: options.historyLength,
      back: vi.fn(),
    },
    isIOSApp: vi.fn(() => options.isIOSApp),
    location: {
      assign: vi.fn(),
    },
  };
}

describe('native iOS navigation helper', () => {
  it('lets Web/H5 keep normal route behavior', () => {
    const env = makeEnv({ historyLength: 3, isIOSApp: false });

    expect(navigateBackInIOSApp('/projects', env)).toBe(false);
    expect(env.history.back).not.toHaveBeenCalled();
    expect(env.location.assign).not.toHaveBeenCalled();
  });

  it('goes back through native-feeling history inside the iOS app', () => {
    const env = makeEnv({ historyLength: 3, isIOSApp: true });

    expect(navigateBackInIOSApp('/projects', env)).toBe(true);
    expect(env.history.back).toHaveBeenCalledTimes(1);
    expect(env.location.assign).not.toHaveBeenCalled();
  });

  it('falls back to the app route when a direct-opened iOS page has no history', () => {
    const env = makeEnv({ historyLength: 1, isIOSApp: true });

    expect(navigateBackInIOSApp('/projects', env)).toBe(true);
    expect(env.history.back).not.toHaveBeenCalled();
    expect(env.location.assign).toHaveBeenCalledWith('/projects');
  });
});
