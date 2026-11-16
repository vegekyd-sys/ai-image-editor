import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLayerReveal } from '@/hooks/useLayerReveal';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const fields = [{ id: 'layer_1', type: 'image' as const, propKey: 'layer_1', label: 'Layer' }];
function layer(decode: () => Promise<void>) {
  const image = document.createElement('img');
  image.dataset.editable = fields[0].id;
  image.decode = decode;
  return image;
}
afterEach(() => vi.unstubAllGlobals());

it('waits for mount, image decode and the end of the pink reveal before enabling edits', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const identity = {}, root = document.createElement('div'), decode = deferred(), motion = deferred();
  const image = layer(() => decode.promise);
  const animate = vi.fn(() => ({ finished: motion.promise, cancel: vi.fn() }));
  Object.defineProperty(image, 'animate', { value: animate });
  const view = renderHook(({ visible }) => useLayerReveal(identity, true, true, root, visible), { initialProps: { visible: fields } });
  expect(view.result.current).toBe('loading');
  act(() => { root.append(image); });
  await act(async () => { decode.resolve(); });
  await waitFor(() => expect(view.result.current).toBe('revealing'));
  await act(async () => { motion.resolve(); });
  expect(view.result.current).toBe('ready');
  view.rerender({ visible: [] });
  expect(animate).toHaveBeenCalledTimes(1);
});

it('ignores a previous snapshot finishing late and honors reduced motion on the active one', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const first = deferred(), next = deferred(), firstRoot = document.createElement('div'), nextRoot = document.createElement('div');
  firstRoot.append(layer(() => first.promise));
  nextRoot.append(layer(() => next.promise));
  const view = renderHook(({ identity, root }) => useLayerReveal(identity, true, true, root, fields), {
    initialProps: { identity: {}, root: firstRoot },
  });
  view.rerender({ identity: {}, root: nextRoot });
  await act(async () => { first.resolve(); });
  expect(view.result.current).toBe('loading');
  await act(async () => { next.resolve(); });
  expect(view.result.current).toBe('ready');
});

it('keeps editing closed on a failed image decode', async () => {
  const root = document.createElement('div'), identity = {};
  root.append(layer(async () => { throw new Error('Decode failed'); }));
  const view = renderHook(() => useLayerReveal(identity, true, true, root, fields));
  await waitFor(() => expect(view.result.current).toBe('error'));
});
