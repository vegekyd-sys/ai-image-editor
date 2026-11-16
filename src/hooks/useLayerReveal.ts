import { useEffect, useRef, useState } from 'react';
import { EDITABLE_RUNTIME_SELECTOR, readEditableRuntimeId } from '@/lib/editor/scene-registry';
import type { EditableField } from '@/types';

type Phase = 'loading' | 'revealing' | 'ready' | 'error';

export function useLayerReveal(identity: object, enabled: boolean, playerReady: boolean, container: HTMLElement | null, fields?: EditableField[]) {
  const [result, setResult] = useState<{ identity: object; phase: Phase } | null>(null);
  const completed = useRef<{ identity: object; container: HTMLElement } | null>(null);
  // The parent filters out deleted layers. A new array with the same IDs is a normal editor render.
  const ids = enabled ? JSON.stringify(fields?.map(field => field.id) ?? []) : '[]';
  useEffect(() => {
    if (!enabled || !playerReady || !container) return;
    if (completed.current?.identity === identity && completed.current.container === container) return;
    let cancelled = false;
    let animations: Animation[] = [];
    const expected: string[] = JSON.parse(ids);
    let decodeTimeout: number | undefined;
    const reveal = async (elements: HTMLElement[]) => {
      decodeTimeout = window.setTimeout(() => {
        cancelled = true;
        setResult({ identity, phase: 'error' });
      }, 20_000);
      try {
        await Promise.all(Array.from(container.querySelectorAll('img'), image => image.decode()));
      } catch {
        if (!cancelled) setResult({ identity, phase: 'error' });
        return;
      } finally {
        clearTimeout(decodeTimeout);
      }
      if (cancelled) return;
      if (elements.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setResult({ identity, phase: 'revealing' });
        animations = elements.map(element => {
          const rest = getComputedStyle(element).filter;
          const highlight = (rest === 'none' ? '' : rest + ' ')
            + 'sepia(.65) saturate(2.2) hue-rotate(286deg) brightness(1.08)'
            + ' drop-shadow(0 0 2px rgba(244, 114, 182, .4))';
          return element.animate(
            [
              { filter: rest },
              { filter: highlight, offset: .22 },
              { filter: highlight, offset: .4 },
              { filter: rest },
            ],
            { duration: 480, easing: 'ease-in-out' },
          );
        });
        await Promise.allSettled(animations.map(animation => animation.finished));
      }
      if (!cancelled) {
        completed.current = { identity, container };
        setResult({ identity, phase: 'ready' });
      }
    };
    // The Player ref can arrive before the composition's own DOM commit.
    const check = () => {
      const elements = Array.from(container.querySelectorAll<HTMLElement>(EDITABLE_RUNTIME_SELECTOR));
      const mounted = new Set(elements.map(readEditableRuntimeId));
      if (!expected.every(id => mounted.has(id))) return;
      observer.disconnect();
      clearTimeout(timeout);
      void reveal(elements);
    };
    const observer = new MutationObserver(check);
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      setResult({ identity, phase: 'error' });
    }, 5000);
    observer.observe(container, { childList: true, subtree: true });
    check();
    return () => {
      cancelled = true;
      observer.disconnect();
      clearTimeout(timeout);
      clearTimeout(decodeTimeout);
      animations.forEach(animation => animation.cancel());
    };
  }, [identity, enabled, playerReady, container, ids]);
  return enabled && playerReady && result?.identity === identity ? result.phase : 'loading';
}
