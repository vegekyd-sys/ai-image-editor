import type { Sandbox } from '@vercel/sandbox';

/** Bound SDK operations even if a lost log stream/remote wait ignores abort. */
export async function awaitPreviewOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => undefined); signal.throwIfAborted(); }
  let abort: () => void = () => undefined;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason ?? new Error('Preview operation cancelled'));
    signal.addEventListener('abort', abort, {once:true});
  });
  try { return await Promise.race([operation, interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
}

/** Wait directly for process exit; log streaming is not a completion signal. */
export async function runPreviewCommand(sandbox: Sandbox, args: string[], signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const started = sandbox.runCommand({cmd:'node',args,detached:true,signal});
  // A create-command RPC can settle after the client has cancelled its wait.
  void started.then(command => {
    if (signal.aborted) void command.kill('SIGTERM').catch(() => undefined);
  }, () => undefined);
  const command = await awaitPreviewOperation(started, signal);
  const cancel = () => { void command.kill('SIGTERM').catch(() => undefined); };
  signal.addEventListener('abort', cancel, {once:true});
  if (signal.aborted) cancel();
  try {
    const finished = await awaitPreviewOperation(command.wait({signal}), signal);
    signal.throwIfAborted();
    if (finished.exitCode !== 0) {
      // Provider diagnostics may contain access-bearing source URLs.
      const diagnosticSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      const diagnostic = await awaitPreviewOperation(finished.stderr({signal:diagnosticSignal}), diagnosticSignal)
        .catch(() => '')
        .then(value => value.replace(/https?:\/\/[^\s"'<>]+/g, '[URL]').slice(-1200));
      const phase = args[0].includes('prefetch') ? 'source caching' : 'frame rendering';
      throw new Error(`Preview command failed (${phase}, exit ${finished.exitCode}): ${diagnostic || 'check source access, rendering or the cache budget.'}`);
    }
  } finally { signal.removeEventListener('abort', cancel); }
}
