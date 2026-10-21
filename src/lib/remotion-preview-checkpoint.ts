import {createHash} from 'node:crypto';
import {getSupabaseAdmin} from './supabase/service';
import {retryIdempotentStorage} from './idempotent-storage-retry';
import {awaitPreviewOperation} from './remotion-preview-command';

export const PREVIEW_CHECKPOINT_BUCKET='remotion-preview-cache';
export interface PreviewCheckpoint {
  version:1;key:string;snapshotId:string;expiresAt:number;sizeBytes:number;
}
// Private bucket, service role only. Never put these pointers in user-writable
// workspace files: a caller must not be able to substitute another VM snapshot.
function objectPath(key:string):string {
  if(!/^media:[a-f0-9]{64}$/.test(key))throw new Error('Invalid preview cache key');
  const namespace=process.env.VERCEL_ENV==='preview'
    ? process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || 'local-preview'
    : 'production';
  return `v1/${createHash('sha256').update(namespace).digest('hex')}/${key.slice(6)}.json`;
}

export async function readPreviewCheckpoint(key:string,signal?:AbortSignal):Promise<PreviewCheckpoint|undefined>{
  const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(10_000)]);
  const result=await awaitPreviewOperation(retryIdempotentStorage(
    ()=>getSupabaseAdmin().storage.from(PREVIEW_CHECKPOINT_BUCKET).download(objectPath(key)), 'preview-cache-read'),deadline);
  if(result.error){
    if(!/not found/i.test(result.error.message)&&![400,404].includes(Number(result.error.status)))console.warn('[preview-cache] read unavailable');
    return undefined;
  }
  if(result.data.size>16_384)return undefined;
  const value=JSON.parse(await result.data.text()) as PreviewCheckpoint;
  if(value.version!==1||value.key!==key||!/^snap_[a-zA-Z0-9]+$/.test(value.snapshotId)||
    !Number.isFinite(value.expiresAt)||value.expiresAt<=Date.now()+60_000||!Number.isFinite(value.sizeBytes))return undefined;
  return value;
}

export async function writePreviewCheckpoint(value:PreviewCheckpoint):Promise<void>{
  const result=await awaitPreviewOperation(retryIdempotentStorage(
    ()=>getSupabaseAdmin().storage.from(PREVIEW_CHECKPOINT_BUCKET).upload(objectPath(value.key),JSON.stringify(value),{upsert:true,contentType:'application/json'}),
    'preview-cache-write'),AbortSignal.timeout(10_000));
  if(result.error)throw new Error('Preview checkpoint persistence failed');
}
