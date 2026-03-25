'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';

const ModelViewer = dynamic(() => import('./ModelViewer'), { ssr: false });

type TaskStatus = 'idle' | 'uploading' | 'pending' | 'in_progress' | 'succeeded' | 'failed';

interface ModelUrls {
  glb?: string;
  usdz?: string;
}

interface HistoryItem {
  id: string;
  thumbnailUrl: string;
  modelUrls: ModelUrls;
  createdAt: number;
}

const HISTORY_KEY = 'makaron-3d-history';

function loadHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}

function saveHistory(items: HistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 20)));
}

/** Proxy Meshy CDN URL through our server to avoid CORS */
function proxyUrl(url: string): string {
  return `/api/generate-3d/proxy?url=${encodeURIComponent(url)}`;
}

export default function Demo3DPage() {
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [modelUrls, setModelUrls] = useState<ModelUrls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [viewing, setViewing] = useState<HistoryItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result as string);
      setViewing(null);
    };
    reader.readAsDataURL(file);
    setModelUrls(null);
    setError(null);
    setStatus('idle');
    setProgress(0);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const addToHistory = useCallback((modelUrls: ModelUrls, thumbnailUrl: string) => {
    const item: HistoryItem = {
      id: Date.now().toString(),
      thumbnailUrl,
      modelUrls,
      createdAt: Date.now(),
    };
    const updated = [item, ...loadHistory().filter(h => h.id !== item.id)];
    saveHistory(updated);
    setHistory(updated);
  }, []);

  const startPolling = useCallback((taskId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/generate-3d?taskId=${taskId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setProgress(data.progress || 0);

        if (data.status === 'SUCCEEDED') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setStatus('succeeded');
          setModelUrls(data.modelUrls);
          if (data.thumbnailUrl && data.modelUrls) {
            addToHistory(data.modelUrls, data.thumbnailUrl);
          }
        } else if (data.status === 'FAILED' || data.status === 'CANCELED') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setStatus('failed');
          setError(`Task ${data.status.toLowerCase()}`);
        } else {
          setStatus(data.status === 'IN_PROGRESS' ? 'in_progress' : 'pending');
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    }, 4000);
  }, [addToHistory]);

  const handleGenerate = useCallback(async () => {
    if (!image) return;
    setStatus('uploading');
    setError(null);
    setProgress(0);
    setModelUrls(null);

    try {
      const res = await fetch('/api/generate-3d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: image }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStatus('pending');
      startPolling(data.taskId);
    } catch (e) {
      setStatus('failed');
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }, [image, startPolling]);

  const viewHistoryItem = useCallback((item: HistoryItem) => {
    setViewing(item);
    setModelUrls(item.modelUrls);
    setStatus('succeeded');
    setImage(null);
    setError(null);
  }, []);

  const resetToUpload = useCallback(() => {
    setImage(null);
    setModelUrls(null);
    setViewing(null);
    setStatus('idle');
    setProgress(0);
    setError(null);
  }, []);

  const isGenerating = status === 'uploading' || status === 'pending' || status === 'in_progress';
  const showViewer = status === 'succeeded' && modelUrls?.glb;

  return (
    <div className="min-h-dvh bg-black text-white flex flex-col items-center p-6 gap-6">
      {/* Header */}
      <div className="text-center mt-8">
        <h1 className="text-2xl font-bold">Image → 3D Model</h1>
        <p className="text-text-secondary text-sm mt-1">
          Upload a photo, get a 3D model (USDZ for Vision Pro)
        </p>
      </div>

      {/* Upload area */}
      {!image && !showViewer && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="w-full max-w-md aspect-square rounded-2xl border-2 border-dashed border-border
            flex flex-col items-center justify-center gap-3 cursor-pointer
            hover:border-primary transition-colors"
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-secondary">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <p className="text-text-secondary text-sm">Drop image here or click to upload</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>
      )}

      {/* Image preview (idle) */}
      {image && status === 'idle' && (
        <div className="w-full max-w-md">
          <div className="relative">
            <img src={image} alt="Upload" className="w-full rounded-2xl object-contain max-h-[400px] bg-surface" />
            <button
              onClick={resetToUpload}
              className="absolute top-3 right-3 bg-black/60 backdrop-blur rounded-full px-3 py-1 text-xs"
            >
              Change
            </button>
          </div>
        </div>
      )}

      {/* Generating state */}
      {isGenerating && (
        <div className="w-full max-w-md flex flex-col items-center gap-4 py-12">
          <div className="relative w-20 h-20">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="36" stroke="#1f1f1f" strokeWidth="6" fill="none" />
              <circle
                cx="40" cy="40" r="36" stroke="#d946ef" strokeWidth="6" fill="none"
                strokeLinecap="round"
                strokeDasharray={`${progress * 2.26} 226`}
                className="transition-all duration-500"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-medium">
              {progress}%
            </span>
          </div>
          <p className="text-text-secondary text-sm">
            {status === 'uploading' ? 'Submitting...' :
             status === 'pending' ? 'Queued, waiting...' :
             'Generating 3D model...'}
          </p>
          <p className="text-text-secondary text-xs">Usually takes 1-3 minutes</p>
        </div>
      )}

      {/* Error */}
      {status === 'failed' && (
        <div className="text-center py-8">
          <p className="text-red-400 text-sm">{error || 'Generation failed'}</p>
          <button
            onClick={image ? handleGenerate : resetToUpload}
            className="mt-4 px-6 py-2 rounded-full bg-surface text-sm hover:bg-surface-secondary transition"
          >
            {image ? 'Retry' : 'Try again'}
          </button>
        </div>
      )}

      {/* 3D Model viewer */}
      {showViewer && (
        <div className="w-full max-w-md flex flex-col gap-4">
          <div className="w-full aspect-square rounded-2xl overflow-hidden bg-surface border border-border">
            <ModelViewer glbUrl={proxyUrl(modelUrls!.glb!)} />
          </div>

          <div className="flex gap-3">
            {modelUrls!.usdz && (
              <a
                href={proxyUrl(modelUrls!.usdz!)}
                rel="ar"
                download="model.usdz"
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                  bg-primary text-white font-medium text-sm hover:bg-primary-light transition"
              >
                <DownloadIcon />
                USDZ (Vision Pro)
              </a>
            )}
            {modelUrls!.glb && (
              <a
                href={proxyUrl(modelUrls!.glb!)}
                download="model.glb"
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                  bg-surface border border-border text-sm hover:bg-surface-secondary transition"
              >
                <DownloadIcon />
                GLB
              </a>
            )}
          </div>

          <button onClick={resetToUpload} className="text-text-secondary text-sm underline">
            Try another image
          </button>
        </div>
      )}

      {/* Generate button */}
      {image && status === 'idle' && (
        <button
          onClick={handleGenerate}
          className="px-8 py-3 rounded-full bg-primary text-white font-medium
            hover:bg-primary-light transition text-base"
        >
          Generate 3D Model
        </button>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="w-full max-w-md mt-4">
          <h2 className="text-sm text-text-secondary mb-3">History</h2>
          <div className="grid grid-cols-4 gap-2">
            {history.map((item) => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className={`aspect-square rounded-xl overflow-hidden border transition
                  ${viewing?.id === item.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-text-secondary'}`}
              >
                <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}
