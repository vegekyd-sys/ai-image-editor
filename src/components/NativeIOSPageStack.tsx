'use client';

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { isMakaronIOSApp } from '@/lib/native-app';
import {
  NATIVE_PAGE_STACK_BACK_EVENT,
  NATIVE_PAGE_STACK_PUSH_EVENT,
} from '@/lib/native-page-stack';

const EDGE_PX = 32;
const LOCK_PX = 10;
const COMMIT_PX = 88;
const SETTLE_MS = 210;
const MAX_RETAINED_ENTRIES = 3;

type StackPhase = 'base' | 'entering' | 'active' | 'exiting';

interface StackEntry {
  id: string;
  path: string;
  node: ReactNode;
  phase: StackPhase;
  pending: boolean;
  x: number;
  frozen?: boolean;
}

function normalizePath(path: string): string {
  if (!path) return '/';
  try {
    const url = new URL(path, window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return path;
  }
}

function pathTitle(path: string): string {
  const pathname = path.split('?')[0];
  if (pathname === '/dashboard') return 'Dashboard';
  if (pathname === '/profile') return 'Account';
  if (pathname === '/skills') return 'Skills';
  if (pathname === '/admin') return 'Admin';
  if (pathname === '/projects') return 'Projects';
  if (pathname === '/home') return 'Makaron';
  return 'Makaron';
}

function shouldUseNativeStack(path: string): boolean {
  const pathname = path.split('?')[0];
  if (pathname === '/' || pathname === '/home' || pathname === '/projects') return true;
  if (pathname.startsWith('/home/') || pathname.startsWith('/projects/')) return false;
  return true;
}

function makeEntry(path: string, node: ReactNode, phase: StackPhase, pending = false): StackEntry {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    path,
    node,
    phase,
    pending,
    x: phase === 'entering' ? 100 : 0,
  };
}

export function sanitizeFrozenHTMLForIOSStack(html: string): string {
  if (!html) return '';
  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll('script, iframe').forEach((node) => node.remove());
  template.content.querySelectorAll('video, audio').forEach((node) => {
    const replacement = document.createElement('div');
    replacement.className = (node as HTMLElement).className;
    replacement.setAttribute('data-makaron-ios-frozen-media', 'true');
    const style = (node as HTMLElement).getAttribute('style');
    replacement.setAttribute('style', [
      style ?? '',
      'background:#050505',
      'pointer-events:none',
    ].filter(Boolean).join(';'));
    node.replaceWith(replacement);
  });
  template.content.querySelectorAll('source, [autoplay]').forEach((node) => {
    if (node.nodeName.toLowerCase() === 'source') {
      node.remove();
      return;
    }
    (node as HTMLElement).removeAttribute('autoplay');
  });

  return template.innerHTML;
}

function PendingPageShell({ path, fallbackPath }: { path: string; fallbackPath: string }) {
  const goBack = () => {
    window.dispatchEvent(new CustomEvent(NATIVE_PAGE_STACK_BACK_EVENT, {
      cancelable: true,
      detail: { fallbackPath },
    }));
  };

  return (
    <div className="makaron-ios-page makaron-ios-page-x min-h-dvh bg-black text-white p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <button
            type="button"
            data-makaron-ios-page-stack-back-button="true"
            onClick={goBack}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/60"
          >
            <span className="text-lg leading-none">‹</span>
            <span>Back</span>
          </button>
          <div className="h-5 w-16 rounded-md bg-white/5" />
        </div>
        <div className="mb-8">
          <div className="text-xs uppercase tracking-[0.16em] text-white/25 mb-3">Loading</div>
          <h1 className="text-3xl font-bold">{pathTitle(path)}</h1>
        </div>
        <div className="space-y-4">
          <div className="h-28 rounded-2xl border border-white/8 bg-white/[0.04]" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 rounded-xl border border-white/8 bg-white/[0.035]" />
            <div className="h-24 rounded-xl border border-white/8 bg-white/[0.035]" />
          </div>
          <div className="h-40 rounded-2xl border border-white/8 bg-white/[0.025]" />
        </div>
      </div>
    </div>
  );
}

function FrozenPage({ html }: { html: string }) {
  return (
    <div
      className="min-h-dvh bg-black"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function NativeIOSPageStack({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const search = searchParams.toString();
  const path = `${pathname || '/'}${search ? `?${search}` : ''}`;
  const [isIOSApp, setIsIOSApp] = useState(false);
  const [entries, setEntries] = useState<StackEntry[]>(() => [makeEntry(path, children, 'base')]);
  const panRef = useRef({ tracking: false, locked: false, startX: 0, startY: 0, lastX: 0, startTime: 0 });
  const backInFlightRef = useRef(false);
  const entriesRef = useRef(entries);
  const latestPathRef = useRef(path);
  const activeEntryRef = useRef<HTMLDivElement | null>(null);
  const pathKey = useMemo(() => normalizePath(path), [path]);

  const shouldRunAsIOSApp = useCallback(() => (
    isMakaronIOSApp() || document.documentElement.dataset.nativePlatform === 'ios'
  ), []);

  useEffect(() => {
    const detect = () => setIsIOSApp(shouldRunAsIOSApp());
    detect();
    const timer = window.setTimeout(detect, 250);
    return () => window.clearTimeout(timer);
  }, [shouldRunAsIOSApp]);

  useEffect(() => {
    latestPathRef.current = pathKey;
  }, [pathKey]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    if (!isIOSApp || !shouldUseNativeStack(pathKey)) return;
    setEntries((current) => {
      const top = current[current.length - 1];
      if (top?.path === pathKey) {
        return current.map((entry, index) => (
          index === current.length - 1
            ? { ...entry, node: children, pending: false, frozen: false, phase: entry.phase === 'entering' ? 'entering' : 'active', x: entry.phase === 'entering' ? entry.x : 0 }
            : entry
        ));
      }

      const previousIndex = current.findIndex((entry) => entry.path === pathKey);
      if (previousIndex >= 0) {
        return current.slice(0, previousIndex + 1).map((entry, index, list) => (
          index === list.length - 1 ? { ...entry, node: children, pending: false, frozen: false, phase: 'active', x: 0 } : entry
        ));
      }

      return [...current, makeEntry(pathKey, children, 'entering')].slice(-MAX_RETAINED_ENTRIES);
    });
  }, [children, isIOSApp, pathKey]);

  useEffect(() => {
    if (!isIOSApp) return;
    const timer = window.setTimeout(() => {
      setEntries((current) => current.map((entry, index) => (
        index === current.length - 1 && entry.phase === 'entering'
          ? { ...entry, phase: 'active', x: 0 }
          : entry
      )));
    }, 20);
    return () => window.clearTimeout(timer);
  }, [entries.length, isIOSApp]);

  useEffect(() => {
    if (!isIOSApp) return;
    document.documentElement.dataset.makaronIOSPageStackDepth = String(entries.length);
    return () => {
      delete document.documentElement.dataset.makaronIOSPageStackDepth;
    };
  }, [entries.length, isIOSApp]);

  useEffect(() => {
    const onPush = (event: Event) => {
      if (!isIOSApp && !shouldRunAsIOSApp()) return;
      if (!isIOSApp) setIsIOSApp(true);
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      const nextPath = normalizePath(detail?.path ?? '');
      if (!nextPath || !shouldUseNativeStack(nextPath) || nextPath === latestPathRef.current) return;
      const frozenHtml = sanitizeFrozenHTMLForIOSStack(activeEntryRef.current?.innerHTML ?? '');
      setEntries((current) => {
        const top = current[current.length - 1];
        if (top?.path === nextPath) return current;
        const frozenCurrent = current.map((entry, index) => (
          index === current.length - 1 && frozenHtml
            ? { ...entry, node: <FrozenPage html={frozenHtml} />, frozen: true, pending: false, phase: 'active' as const, x: 0 }
            : entry
        ));
        const fallbackPath = top?.path ?? '/projects';
        return [...frozenCurrent, makeEntry(nextPath, <PendingPageShell path={nextPath} fallbackPath={fallbackPath} />, 'entering', true)].slice(-MAX_RETAINED_ENTRIES);
      });
    };
    window.addEventListener(NATIVE_PAGE_STACK_PUSH_EVENT, onPush);
    return () => window.removeEventListener(NATIVE_PAGE_STACK_PUSH_EVENT, onPush);
  }, [isIOSApp, shouldRunAsIOSApp]);

  const closeTopEntry = (fallbackPath = '/projects') => {
    if (backInFlightRef.current) return;
    const currentEntries = entriesRef.current;
    const canCloseStack = currentEntries.length > 1;
    if (!canCloseStack) {
      if (window.history.length > 1) window.history.back();
      else window.location.assign(fallbackPath);
      return;
    }
    backInFlightRef.current = true;
    setEntries((current) => current.map((entry, index) => (
      index === current.length - 1 ? { ...entry, phase: 'exiting', x: 100 } : entry
    )));
    window.setTimeout(() => {
      setEntries((current) => current.slice(0, -1).map((entry, index, list) => (
        index === list.length - 1 ? { ...entry, phase: 'active', x: 0 } : entry
      )));
      const previousPath = entriesRef.current[entriesRef.current.length - 2]?.path ?? fallbackPath;
      if (window.history.length > 1) {
        window.history.back();
      } else {
        router.replace(previousPath);
      }
      backInFlightRef.current = false;
    }, SETTLE_MS);
  };

  useEffect(() => {
    if (!isIOSApp) return;
    const onBack = (event: Event) => {
      event.preventDefault();
      closeTopEntry((event as CustomEvent<{ fallbackPath?: string }>).detail?.fallbackPath ?? '/projects');
    };
    window.addEventListener(NATIVE_PAGE_STACK_BACK_EVENT, onBack);
    return () => window.removeEventListener(NATIVE_PAGE_STACK_BACK_EVENT, onBack);
  });

  if (!isIOSApp) return <>{children}</>;

  const topEntry = entries[entries.length - 1];
  const canPanBack = entries.length > 1 && topEntry && shouldUseNativeStack(topEntry.path);

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!canPanBack || event.touches.length !== 1) return;
    if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"], [data-makaron-cui-pan]')) return;
    const touch = event.touches[0];
    if (!touch || touch.clientX > EDGE_PX) return;
    panRef.current = { tracking: true, locked: false, startX: touch.clientX, startY: touch.clientY, lastX: touch.clientX, startTime: performance.now() };
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!panRef.current.tracking) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - panRef.current.startX;
    const dy = touch.clientY - panRef.current.startY;
    if (!panRef.current.locked) {
      if (dx < -LOCK_PX || (Math.abs(dy) > LOCK_PX && Math.abs(dy) > dx)) {
        panRef.current.tracking = false;
        return;
      }
      if (dx < LOCK_PX || dx < Math.abs(dy) * 1.15) return;
      panRef.current.locked = true;
    }
    event.preventDefault();
    panRef.current.lastX = touch.clientX;
    const x = Math.max(0, Math.min(100, (dx / window.innerWidth) * 100));
    setEntries((current) => current.map((entry, index) => (
      index === current.length - 1 ? { ...entry, x } : entry
    )));
  };

  const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!panRef.current.tracking) return;
    const touch = event.changedTouches[0];
    const dx = Math.max(0, (touch?.clientX ?? panRef.current.lastX) - panRef.current.startX);
    const elapsed = Math.max(1, performance.now() - panRef.current.startTime);
    const velocity = dx / elapsed;
    const shouldClose = panRef.current.locked && (dx >= COMMIT_PX || velocity > 0.55);
    panRef.current.tracking = false;
    panRef.current.locked = false;
    if (shouldClose) {
      event.preventDefault();
      const currentEntries = entriesRef.current;
      closeTopEntry(currentEntries[currentEntries.length - 2]?.path ?? '/projects');
      return;
    }
    setEntries((current) => current.map((entry, index) => (
      index === current.length - 1 ? { ...entry, phase: 'active', x: 0 } : entry
    )));
  };

  return (
    <div data-makaron-ios-page-stack="true">
      {entries.map((entry, index) => {
        const isOnly = entries.length === 1;
        const isTop = index === entries.length - 1;
        const isUnderTop = index === entries.length - 2;
        if (isOnly) return <div key={entry.id} ref={isTop ? activeEntryRef : undefined}>{entry.node}</div>;
        return (
          <div
            key={entry.id}
            ref={isTop ? activeEntryRef : undefined}
            data-makaron-ios-stack-entry={isTop ? 'top' : 'under'}
            data-makaron-ios-stack-path={entry.path}
            data-makaron-ios-stack-pending={entry.pending ? 'true' : undefined}
            data-makaron-ios-stack-frozen={entry.frozen ? 'true' : undefined}
            className="makaron-ios-stack-entry"
            style={{
              transform: `translate3d(${entry.x}%, 0, 0)`,
              transition: panRef.current.tracking ? 'none' : `transform ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
              zIndex: index + 1,
              pointerEvents: isTop ? 'auto' : 'none',
              visibility: isTop || isUnderTop ? 'visible' : 'hidden',
              boxShadow: isTop && entry.x > 1 ? '-18px 0 44px rgba(0,0,0,0.35)' : undefined,
            }}
            onTouchStart={isTop ? onTouchStart : undefined}
            onTouchMove={isTop ? onTouchMove : undefined}
            onTouchEnd={isTop ? onTouchEnd : undefined}
            onTouchCancel={isTop ? onTouchEnd : undefined}
          >
            {entry.node}
          </div>
        );
      })}
    </div>
  );
}
