import { useEffect, useId, useRef, useState } from 'react';
import { EDITABLE_RUNTIME_SELECTOR, readEditableRuntimeId } from '@/lib/editor/scene-registry';
import type { EditableField } from '@/types';

type Phase = 'loading' | 'revealing' | 'ready' | 'error';

export function useLayerReveal(identity: object, enabled: boolean, playerReady: boolean, container: HTMLElement | null, fields?: EditableField[]) {
  const tintId = 'layer-ready-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [result, setResult] = useState<{ identity: object; phase: Phase } | null>(null);
  const completed = useRef<{ identity: object; container: HTMLElement } | null>(null);
  // The parent filters out deleted layers. A new array with the same IDs is a normal editor render.
  const ids = enabled ? JSON.stringify(fields?.map(field => field.id) ?? []) : '[]';
  useEffect(() => {
    if (!enabled || !playerReady || !container) return;
    if (completed.current?.identity === identity && completed.current.container === container) return;
    let cancelled = false;
    let animations: Animation[] = [];
    let tintFrame = 0;
    let tintSvg: SVGSVGElement | null = null;
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
      const foreground = elements.filter(element => readEditableRuntimeId(element) !== 'layer_0');
      if (foreground.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setResult({ identity, phase: 'revealing' });
        // Mix the selection pink into RGB while preserving each layer's alpha.
        // One shared matrix animates all layers without changing their image URLs.
        const ns = 'http://www.w3.org/2000/svg';
        tintSvg = document.createElementNS(ns, 'svg');
        tintSvg.setAttribute('width', '0');
        tintSvg.setAttribute('height', '0');
        tintSvg.setAttribute('aria-hidden', 'true');
        tintSvg.style.position = 'absolute';
        tintSvg.style.pointerEvents = 'none';
        const filter = document.createElementNS(ns, 'filter');
        filter.id = tintId;
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        const matrix = document.createElementNS(ns, 'feColorMatrix');
        const paint = (amount: number) => {
          const keep = 1 - amount;
          matrix.setAttribute('values', `${keep} 0 0 0 ${amount} 0 ${keep} 0 0 ${amount * 130 / 255} 0 0 ${keep} 0 ${amount * 185 / 255} 0 0 0 1 0`);
        };
        paint(0);
        filter.append(matrix);
        tintSvg.append(filter);
        document.body.append(tintSvg);
        const started = performance.now();
        const duration = 1000;
        const tick = (now: number) => {
          const elapsed = Math.min(duration, now - started);
          const fadeIn = 1 - (1 - Math.min(1, elapsed / 180)) ** 3;
          const fadeOut = (1 - Math.max(0, (elapsed - 480) / 520)) ** 2;
          paint(.28 * fadeIn * fadeOut);
          if (elapsed < duration && !cancelled) tintFrame = requestAnimationFrame(tick);
        };
        tintFrame = requestAnimationFrame(tick);
        animations = foreground.map(element => {
          const rest = getComputedStyle(element).filter;
          const highlight = (rest === 'none' ? '' : rest + ' ')
            + `url("#${tintId}")`;
          return element.animate(
            [{ filter: highlight }, { filter: highlight }],
            { duration },
          );
        });
        await Promise.allSettled(animations.map(animation => animation.finished));
        cancelAnimationFrame(tintFrame);
        tintSvg.remove();
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
      cancelAnimationFrame(tintFrame);
      tintSvg?.remove();
    };
  }, [identity, enabled, playerReady, container, ids, tintId]);
  return enabled && playerReady && result?.identity === identity ? result.phase : 'loading';
}
