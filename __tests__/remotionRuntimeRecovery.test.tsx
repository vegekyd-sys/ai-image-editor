import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ mounts: 0 }));
vi.mock('@remotion/player', async () => {
  const ReactRuntime = (await import('react')).default;
  type PlayerProps = { component: React.ComponentType; inputProps: Record<string, unknown>;
    errorFallback: (info: { error: Error }) => React.ReactNode };
  class InnerBoundary extends ReactRuntime.Component<{
    children: React.ReactNode; errorFallback: PlayerProps['errorFallback']
  }, { error: Error | null }> {
    state: { error: Error | null } = { error: null };
    static getDerivedStateFromError(error: Error) { return { error }; }
    render() { return this.state.error ? this.props.errorFallback({ error: this.state.error }) : this.props.children; }
  }
  return { Player: ({ component: Component, inputProps, errorFallback }: PlayerProps) => {
    ReactRuntime.useEffect(() => { state.mounts++; }, []);
    return <div data-testid="player"><InnerBoundary errorFallback={errorFallback}><Component {...inputProps} /></InnerBoundary></div>;
  } };
});
vi.mock('@remotion/web-renderer', () => ({ renderStillOnWeb: vi.fn(), renderMediaOnWeb: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/evalRemotionJSX', () => ({ preloadBabel: async () => {}, evalRemotionJSX: (code: string) =>
  function Composition(props: { items?: string[] }) {
    if (code.includes('broken-code')) throw new Error('Broken composition');
    return <div>{props.items!.map(item => <span key={item}>{item}</span>)}</div>;
  },
}));
vi.mock('@/remotion/font-catalog', async original => ({
  ...await original<typeof import('@/remotion/font-catalog')>(),
  prepareRemotionFontCodeFromBundledCatalog: ({ code }: { code: string }) => ({ code, defaultFontFamily: 'Inter' }),
  prepareAndLoadRemotionFontsWithTiming: async ({ code }: { code: string }) => ({ prepared: { code, defaultFontFamily: 'Inter' }, timing: {} }),
  validateRemotionFontManifest: (value: unknown) => value,
}));
import RemotionRenderer from '@/components/RemotionRenderer';
const base = { width: 160, height: 90, code: 'valid-code', props: {} };
beforeEach(() => {
  state.mounts = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ faces: [] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('recovers a runtime failure after corrected props arrive for the same draft', async () => {
  const view = render(<RemotionRenderer design={base} snapshotId="draft" />);
  await view.findByText('canvas.previewUnavailable');
  view.rerender(<RemotionRenderer design={{ ...base, props: { items: ['Corrected draft'] } }} snapshotId="draft" />);
  await view.findByText('Corrected draft');
  expect(view.queryByText('canvas.previewUnavailable')).toBeNull();
  view.unmount();
});

it('recovers when the source is repaired without a manual retry', async () => {
  const props = { items: ['Source repaired'] };
  const view = render(<RemotionRenderer design={{ ...base, code: 'broken-code', props }} snapshotId="draft" />);
  await view.findByText('canvas.previewUnavailable');
  view.rerender(<RemotionRenderer design={{ ...base, props }} snapshotId="draft" />);
  await view.findByText('Source repaired');
  view.unmount();
});

it('does not remount a healthy Player when editable props change', async () => {
  const view = render(<RemotionRenderer design={{ ...base, props: { items: ['Before edit'] } }} snapshotId="draft" />);
  await view.findByText('Before edit');
  const player = view.getByTestId('player');
  const mounts = state.mounts;
  view.rerender(<RemotionRenderer design={{ ...base, props: { items: ['After edit'] } }} snapshotId="draft" />);
  await view.findByText('After edit');
  expect(view.getByTestId('player')).toBe(player);
  expect(state.mounts).toBe(mounts);
  view.unmount();
});

it('does not repeatedly retry an unchanged broken draft', async () => {
  const onError = vi.fn();
  const view = render(<RemotionRenderer design={base} snapshotId="draft" onError={onError} />);
  await view.findByText('canvas.previewUnavailable');
  const errors = onError.mock.calls.length;
  view.rerender(<RemotionRenderer design={base} snapshotId="draft" onError={onError} />);
  await waitFor(() => expect(view.getByText('canvas.previewUnavailable')).toBeTruthy());
  expect(onError).toHaveBeenCalledTimes(errors);
  view.unmount();
});
