import { awaitPreviewOperation } from './remotion-preview-command';

/** Short-lived, owner-scoped reuse. The host must anchor idle work with after(). */
export interface PreviewSession<T> {
  value: Promise<T>;
  users: number;
  createdAt: number;
  retired: boolean;
  tail: Promise<void>;
  cancelIdle?: () => void;
}

export class PreviewSessionCache<T> {
  private entries = new Map<string, PreviewSession<T>>();
  constructor(
    private stop: (value: Promise<T>) => Promise<void>,
    private background: (work: Promise<void>) => void,
    private idleMs = 25_000,
    private lifetimeMs = 10 * 60_000,
  ) {}

  acquire(key: string, create: () => Promise<T>): { session: PreviewSession<T>; reused: boolean } {
    let session = this.entries.get(key);
    if (session && Date.now() - session.createdAt >= this.lifetimeMs - 60_000) {
      this.retire(key, session);
      if (!session.users) this.anchorStop(session);
      session = undefined;
    }
    const reused = Boolean(session);
    if (!session) {
      session = {value:create(), users:0, createdAt:Date.now(), retired:false, tail:Promise.resolve()};
      this.entries.set(key, session);
    }
    session.cancelIdle?.();
    session.users++;
    return {session, reused};
  }

  async run<R>(session: PreviewSession<T>, operation: (value: T) => Promise<R>, signal: AbortSignal): Promise<R> {
    const previous = session.tail;
    let unlock!: () => void;
    const finished = new Promise<void>(resolve => { unlock = resolve; });
    // A cancelled queued caller must not let its successor overtake the active
    // render. Leave its queue slot chained until the predecessor completes.
    session.tail = previous.then(() => finished);
    try {
      await awaitPreviewOperation(previous, signal);
      signal.throwIfAborted();
      return await operation(await awaitPreviewOperation(session.value, signal));
    } finally { unlock(); }
  }

  async release(key: string, session: PreviewSession<T>, reusable: boolean): Promise<void> {
    session.users--;
    if (!reusable) this.retire(key, session);
    if (session.users > 0) return;
    if (session.retired || this.entries.get(key) !== session) {
      await this.stop(session.value);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let cancel!: () => void;
    const idle = new Promise<void>(resolve => {
      cancel = () => { clearTimeout(timer); session.cancelIdle = undefined; resolve(); };
      timer = setTimeout(() => {
        session.cancelIdle = undefined;
        this.entries.delete(key);
        session.retired = true;
        void this.stop(session.value).catch(() => undefined).finally(resolve);
      }, this.idleMs);
    });
    session.cancelIdle = cancel;
    try {
      // after(Promise) keeps this timer alive after the response and during
      // nested Agent background work; a bare timer is insufficient on Vercel.
      this.background(idle);
    } catch {
      cancel();
      this.retire(key, session);
      await this.stop(session.value);
    }
  }

  private retire(key: string, session: PreviewSession<T>): void {
    session.cancelIdle?.();
    session.retired = true;
    if (this.entries.get(key) === session) this.entries.delete(key);
  }

  private anchorStop(session: PreviewSession<T>): void {
    const work = this.stop(session.value);
    try { this.background(work); } catch { void work.catch(() => undefined); }
  }
}
