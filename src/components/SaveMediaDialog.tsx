'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, LoaderCircle, Pause, Play, Sparkles, X } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { checkMediaDownload, savePreparedDownload, type DownloadAssetPreview, type PreparedDownload } from '@/lib/editor/download';
import { preloadWatermarkVideo, watermarkDataUrl, watermarkGeometry, watermarkImage, watermarkVideo } from '@/lib/editor/web-watermark';
import { isNativePhotoLibrarySaveAvailable, saveWatermarkedVideoToNativePhotoLibrary } from '@/lib/native-media';

interface Props {
  prepare: () => Promise<PreparedDownload>;
  preview?: DownloadAssetPreview;
  onClose: () => void;
  onUpgrade: () => void;
  onSaved: () => void;
  suspended: boolean;
  returningFromCheckout?: boolean;
}

export default function SaveMediaDialog({ prepare, preview, onClose, onUpgrade, onSaved, suspended, returningFromCheckout = false }: Props) {
  const { t } = useLocale();
  const [asset, setAsset] = useState<PreparedDownload | null>(null);
  const [previewUrl, setPreviewUrl] = useState(preview?.source || '');
  const [paid, setPaid] = useState(false);
  const [markVisible, setMarkVisible] = useState(returningFromCheckout);
  const [accessReady, setAccessReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [size, setSize] = useState({ width: preview?.width || 1, height: preview?.height || 1 });
  const [markUrl] = useState(() => watermarkDataUrl());
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const exportController = useRef<AbortController | null>(null);
  const wasSuspended = useRef(suspended);
  const preparedAsset = useRef<Promise<PreparedDownload> | null>(null);
  const kind = asset?.kind || preview?.kind;
  const loading = !previewUrl && !error;

  useEffect(() => {
    let cancelled = false;
    let url = '';
    let knownAccess: boolean | undefined;
    let preparedKind = preview?.kind;
    setError('');setAsset(null);setAccessReady(false);setPreviewUrl(preview?.source || '');
    const pending = prepare();
    preparedAsset.current = pending;
    pending.then(next => {
      if (cancelled) return;
      preparedKind = next.kind;
      setAsset(next);
      if (!preview?.source) {url = URL.createObjectURL(next.blob);setPreviewUrl(url);}
      if (next.kind === 'video' && knownAccess === false && !isNativePhotoLibrarySaveAvailable()) preloadWatermarkVideo();
    }).catch(() => {if (!cancelled) setError(t('editor.savePrepareFailed'));});
    checkMediaDownload().then(access => {
      if (cancelled) return;
      knownAccess = access;
      if (!access && preparedKind === 'video' && !isNativePhotoLibrarySaveAvailable()) preloadWatermarkVideo();
      setPaid(access);setAccessReady(true);
      setMarkVisible(!access || returningFromCheckout);
    }).catch(() => {if (!cancelled) setError(t('editor.savePrepareFailed'));});
    return () => {cancelled = true;if (url) URL.revokeObjectURL(url);exportController.current?.abort();};
  }, [prepare, preview, attempt, t, returningFromCheckout]);

  // Refresh entitlement when the existing checkout closes or the browser returns from Stripe.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      let attempts = 0;
      const poll = async () => {
        let access = false;
        try {access = await checkMediaDownload();} catch { /* Retry while checkout settles. */ }
        if (cancelled) return;
        if (access) {setPaid(true);setError('');}
        else if (++attempts < 30) timer = setTimeout(() => {void poll();}, 1000);
      };
      void poll();
    };
    if (!suspended && asset && (wasSuspended.current || returningFromCheckout)) refresh();
    wasSuspended.current = suspended;
    if (!suspended) window.addEventListener('focus', refresh);
    return () => {cancelled = true;clearTimeout(timer);window.removeEventListener('focus', refresh);};
  }, [suspended, asset, returningFromCheckout]);

  useEffect(() => {
    if (!paid || loading || suspended) return;
    const timer = setTimeout(() => setMarkVisible(false), 150);
    return () => clearTimeout(timer);
  }, [paid, loading, suspended]);

  useEffect(() => {
    if (suspended) {videoRef.current?.pause();return;}
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown', handleKey);
    return () => {document.removeEventListener('keydown', handleKey);previous?.focus();};
  }, [suspended, onClose]);

  const save = async () => {
    if (!preparedAsset.current || !accessReady || saving) return;
    setSaving(true);setError('');setProgress(0);
    videoRef.current?.pause();
    const controller = new AbortController();
    exportController.current = controller;
    try {
      const ready = asset || await preparedAsset.current;
      controller.signal.throwIfAborted();
      if (paid) {
        if (!(await checkMediaDownload())) {setPaid(false);setMarkVisible(true);throw new Error('Access changed');}
      }
      if (!paid && ready.kind === 'video' && isNativePhotoLibrarySaveAvailable()) {
        await saveWatermarkedVideoToNativePhotoLibrary(ready.blob, ready.filename, markUrl, setProgress, controller.signal);
      } else {
        const blob = paid ? ready.blob : ready.kind === 'image' ? await watermarkImage(ready.blob)
          : await watermarkVideo(ready.blob, setProgress, controller.signal);
        controller.signal.throwIfAborted();
        await savePreparedDownload({ ...ready, blob, filename: !paid && ready.kind === 'image'
          ? ready.filename.replace(/\.[^.]+$/, '.png') : ready.filename });
      }
      controller.signal.throwIfAborted();
      onSaved();onClose();
    } catch {
      if (!controller.signal.aborted) setError(t(kind === 'video' ? 'editor.saveVideoFailed' : 'editor.saveFailed'));
    } finally {setSaving(false);}
  };

  if (suspended) return null;
  const geometry = watermarkGeometry(size.width, size.height);
  const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  return (
    <div className="fixed inset-0 z-[290] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="save-media-title"
        data-testid="save-media-dialog" className="w-full max-w-[440px] max-h-[90dvh] overflow-y-auto rounded-[20px] border border-white/[0.08] bg-[#151518] shadow-2xl"
        onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <h2 id="save-media-title" className="text-base font-semibold text-white">{t('editor.saveWork')}</h2>
          <button type="button" onClick={onClose} aria-label={t('billing.close')} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="px-5">
          {loading ? <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-white/60" role="status">
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t('editor.savePreparing')}
          </div> : previewUrl && kind ? <>
            <div className="mx-auto relative overflow-hidden bg-black" data-testid="save-media-preview"
              style={{ width: `min(100%, ${42 * size.width / size.height}dvh)`, aspectRatio: `${size.width} / ${size.height}` }}>
              {kind === 'image' ? <img src={previewUrl} alt={t('editor.savePreview')}
                className="block w-full h-full object-contain" onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
                : <video ref={videoRef} src={previewUrl} playsInline preload="auto" className="block w-full h-full"
                  onLoadedMetadata={event => {const v = event.currentTarget;setSize({width:v.videoWidth,height:v.videoHeight});setDuration(v.duration);}}
                  onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />}
              <img src={markUrl} alt="" aria-hidden="true" data-testid="save-watermark" data-visible={markVisible}
                className="absolute pointer-events-none transition-[opacity,filter,transform] duration-700 ease-out motion-reduce:transition-none"
                style={{opacity:markVisible ? 1 : 0,filter:markVisible ? 'blur(0)' : 'blur(3px)',transform:markVisible ? 'scale(1)' : 'scale(1.04)',width:`${geometry.width / size.width * 100}%`,height:`${geometry.height / size.height * 100}%`,left:`${geometry.left / size.width * 100}%`,top:`${geometry.top / size.height * 100}%`}} />
            </div>
            {kind === 'video' && <div className="flex items-center gap-3 pt-2 text-white/60">
              <button type="button" aria-label={t(playing ? 'editor.pausePreview' : 'editor.playPreview')}
                className="flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-white/5" onClick={() => {
                  const video = videoRef.current;if (!video) return;
                  if (video.paused) void video.play().catch(() => setError(t('editor.saveVideoFailed')));else video.pause();
                }}>{playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}</button>
              <input type="range" min={0} max={duration || 1} step={0.05} value={time} aria-label={t('editor.videoPosition')}
                className="min-w-0 flex-1 accent-fuchsia-400" onChange={event => {if(videoRef.current) videoRef.current.currentTime = Number(event.target.value);}} />
              <span className="shrink-0 text-xs tabular-nums">{formatTime(time)} / {formatTime(duration)}</span>
            </div>}
            <p className="pt-3 pb-1 text-center text-xs text-white/50" style={{ visibility: accessReady ? 'visible' : 'hidden' }}>
              {t(paid ? 'editor.saveCleanCaption' : 'editor.saveWatermarkedCaption')}
            </p>
          </> : null}
          {error && <div className="py-3 text-sm text-red-300" role="alert">{error}
            {(!asset || !accessReady) && <button type="button" className="ml-2 underline" onClick={() => setAttempt(value => value + 1)}>{t('misc.retry')}</button>}
          </div>}
        </div>
        <div className="px-5 pt-3 pb-5">
          <button type="button" disabled={loading || saving || !accessReady || (!asset && !preview)} onClick={() => void save()}
            data-testid={paid ? 'save-clean' : 'save-free'} className="mkr-liquid-pill flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-fuchsia-400/25 bg-fuchsia-500/20 px-5 text-sm font-medium text-white transition hover:bg-fuchsia-500/30 disabled:opacity-40">
            {saving ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}
            {saving ? t('editor.saveProcessing', Math.round(progress * 100)) : t('project.save')}
          </button>
          {!paid && <button type="button" disabled={loading || saving || !accessReady || (!asset && !preview)} onClick={onUpgrade}
            data-testid="save-upgrade" className="mt-1 flex min-h-12 w-full items-center justify-center gap-2 text-sm text-white/65 transition hover:text-white disabled:opacity-40">
            <Sparkles size={16} aria-hidden="true" />{t('editor.removeWatermark')}
          </button>}
        </div>
      </div>
    </div>
  );
}
