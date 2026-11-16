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

it('keeps the background unchanged and waits for its decode while highlighting only foreground', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const root = document.createElement('div'), identity = {}, backgroundDecode = deferred(), motion = deferred();
  const background = layer(() => backgroundDecode.promise), subject = layer(async () => {});
  background.dataset.editable = 'layer_0';
  background.style.filter = 'contrast(1.1)';
  const backgroundAnimate = vi.fn(), subjectAnimate = vi.fn(() => ({ finished: motion.promise, cancel: vi.fn() }));
  Object.defineProperty(background, 'animate', { value: backgroundAnimate });
  Object.defineProperty(subject, 'animate', { value: subjectAnimate });
  root.append(background, subject);
  const view = renderHook(() => useLayerReveal(identity, true, true, root,
    [{ ...fields[0], id: 'layer_0', propKey: 'layer_0' }, ...fields]));
  expect(view.result.current).toBe('loading');
  expect(subjectAnimate).not.toHaveBeenCalled();
  await act(async () => backgroundDecode.resolve());
  await waitFor(() => expect(view.result.current).toBe('revealing'));
  expect(backgroundAnimate).not.toHaveBeenCalled();
  expect(background.style.filter).toBe('contrast(1.1)');
  expect(subjectAnimate).toHaveBeenCalledWith(expect.any(Array), { duration: 1000 });
  await act(async () => motion.resolve());
  expect(view.result.current).toBe('ready');
  expect(background.style.filter).toBe('contrast(1.1)');
});

it('keeps editing closed on a failed image decode', async () => {
  const root = document.createElement('div'), identity = {};
  root.append(layer(async () => { throw new Error('Decode failed'); }));
  const view = renderHook(() => useLayerReveal(identity, true, true, root, fields));
  await waitFor(() => expect(view.result.current).toBe('error'));
});

it('ends loading when image decoding stalls and ignores its late completion', async () => {
  vi.useFakeTimers();
  try {
    const root = document.createElement('div'), identity = {}, decode = deferred();
    root.append(layer(() => decode.promise));
    const view = renderHook(() => useLayerReveal(identity, true, true, root, fields));
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(view.result.current).toBe('error');
    await act(async () => { decode.resolve(); });
    expect(view.result.current).toBe('error');
  } finally {
    vi.useRealTimers();
  }
});
