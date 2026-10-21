/** Only for upserts of the same bytes/row. Never use for paid submissions. */
export async function retryIdempotentStorage<T extends {error: unknown}>(
  operation: () => PromiseLike<T>,
  phase: string,
): Promise<T> {
  for (let attempt=0;;attempt++) {
    try {
      const result=await operation();
      if (!result.error || attempt>=2 || !isTransientStorageError(result.error)) return result;
    } catch(error) {
      if (attempt>=2 || !isTransientStorageError(error)) throw error;
    }
    console.warn('[storage-retry]',{phase,attempt:attempt+1});
    await new Promise(resolve=>setTimeout(resolve,[250,1000][attempt]));
  }
}

export function isTransientStorageError(error: unknown): boolean {
  if (!error || typeof error!=='object') return false;
  const e=error as {status?:number;statusCode?:number|string;message?:string;details?:string;code?:string;cause?:unknown};
  const status=Number(e.status||e.statusCode);
  if ([401,403,404,409,413,422].includes(status)) return false;
  return status===408 || status===429 || status>=500 ||
    /fetch failed|network|timed?\s*out|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR/i.test(`${e.message||''} ${e.details||''} ${e.code||''}`) ||
    Boolean(e.cause && isTransientStorageError(e.cause));
}
