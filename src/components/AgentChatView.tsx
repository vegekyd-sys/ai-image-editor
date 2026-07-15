'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message } from '@/types';
import { compressImageFile } from '@/lib/imageUtils';
import { useLocale } from '@/lib/i18n';
import { getDefaultVideoModelId } from '@/lib/video-model-capabilities';
import { getThumbnailUrl } from '@/lib/supabase/storage';
import { Snapshot } from '@/types';
import ImageRefChip from '@/components/ImageRefChip';
import FileRefChip from '@/components/FileRefChip';
import FileViewer from '@/components/FileViewer';
import ModelSelector from '@/components/ModelSelector';
import type { AgentModelPreference } from '@/lib/agent-models';
import SkillSelector, { type SkillItem } from '@/components/SkillSelector';
import { splitCompletionActions } from '@/lib/artifact-actions';
import { removeAllInlineVideoUrls, removeInlineMediaNavigationMarkers, removeRenderableInlineVideoUrls, resolveInlineVideoCandidate } from '@/lib/cui-video-url';
import type { ArtifactCompletionAction as CompletionAction } from '@/types';

/** Inline video in CUI — natural AR, play/pause, @N badge, tap to navigate with time sync */
const videoArCache = new Map<string, string>();

function InlineCuiVideo({ url, aspectRatio, posterUrl, snapIndex, isDesktop, onNavigate }: {
  url: string; aspectRatio: string; posterUrl?: string; snapIndex?: number; isDesktop?: boolean;
  onNavigate: (e: React.MouseEvent, currentTime: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ar, setAr] = useState(videoArCache.get(url) || aspectRatio);
  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); } else { v.muted = false; v.play(); }
  };
  return (
    <div
      className="mt-2.5 relative overflow-hidden rounded-2xl cursor-pointer active:opacity-75 transition-opacity"
      style={{ maxWidth: 308, border: '1px solid rgba(255,255,255,0.08)' }}
      onClick={(e) => onNavigate(e, videoRef.current?.currentTime || 0)}
    >
      <video
        ref={videoRef}
        src={`${url}#t=0.001`}
        poster={posterUrl}
        playsInline
        preload="metadata"
        style={{ width: '100%', aspectRatio: ar, objectFit: 'cover', display: 'block' }}
        onLoadedMetadata={() => { const v = videoRef.current; if (v?.videoWidth && v.videoHeight) { const r = `${v.videoWidth}/${v.videoHeight}`; videoArCache.set(url, r); setAr(r); } }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); if (videoRef.current) videoRef.current.currentTime = 0; }}
        onTimeUpdate={() => { const v = videoRef.current; if (v?.duration) setProgress(v.currentTime / v.duration); }}
      />
      {/* Play/Pause button — above badge, same style as canvas (mobile only) */}
      {!isDesktop && (
        <button
          onClick={togglePlay}
          className="absolute bottom-10 left-2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform"
        >
          {playing
            ? <svg width="14" height="14" viewBox="0 0 10 10" fill="white"><rect x="1" y="0.5" width="2.8" height="9" rx="0.7" /><rect x="6.2" y="0.5" width="2.8" height="9" rx="0.7" /></svg>
            : <svg width="14" height="14" viewBox="0 0 10 10" fill="white"><polygon points="3.5,1.5 8.5,5 3.5,8.5" /></svg>
          }
        </button>
      )}
      {/* @N badge — bottom-left, matches image style */}
      {snapIndex && (
        <span className="absolute bottom-2 left-2 bg-black/60 backdrop-blur text-white text-sm font-medium px-2 py-0.5 rounded-md pointer-events-none">
          @{snapIndex}
        </span>
      )}
      {/* Progress bar — bottom edge, fuchsia like MusicCard */}
      <div className="absolute bottom-0 left-0 right-0" style={{ height: 2, background: 'rgba(255,255,255,0.1)' }}>
        <div className="h-full" style={{ width: `${progress * 100}%`, background: 'rgba(192,38,211,0.8)', transition: 'width 0.1s linear' }} />
      </div>
    </div>
  );
}

/** Collapsible card showing the English editPrompt sent to Gemini, with optional input images */
function EditPromptCard({ prompt, inputImages, editModel }: { prompt: string; inputImages?: string[]; editModel?: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const inputImageLabels = [t('chat.currentImage'), t('chat.referenceImage')];
  const modelLabels: Record<string, string> = { gemini: 'nano banana 2', 'gemini-lite': 'nano banana 2 lite', qwen: 'qwen edit', pony: 'pony anime', wai: 'wai illustrious', openai: 'OpenAI Image 2' };
  const modelLabel = modelLabels[editModel || ''] || editModel || 'model';
  return (
    <div className="mt-2 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', maxWidth: 308 }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left active:opacity-70 transition-opacity"
      >
        {/* Reference image thumbnail in collapsed header */}
        {!open && inputImages?.[0] && inputImages[0].length > 10 && (

          <img
            src={inputImages[0]}
            alt=""
            className="w-7 h-7 rounded-md object-cover flex-shrink-0"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
          />
        )}
        <span className="text-[11px] font-medium flex-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {t('chat.promptCard').replace(/nano banana 2|qwen edit|OpenAI Image 2/gi, modelLabel)}
        </span>
        <span className="text-[11px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>{open ? t('chat.collapse') : t('chat.expand')}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5">
          {inputImages && inputImages.filter(img => img && img.length > 10).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.25)' }}>
                {t('chat.inputImages')}{inputImages.length > 1 ? `（${inputImages.length}）` : ''}
              </span>
              <div className="flex gap-2 flex-wrap">
                {inputImages.filter(img => img && img.length > 10).map((img, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    { }
                    <img
                      src={img}
                      alt={`Input ${i + 1} to Gemini`}
                      className="rounded-lg object-cover"
                      style={{
                        width: inputImages.length > 1 ? 100 : 'auto',
                        height: inputImages.length > 1 ? 100 : 140,
                        maxHeight: 140,
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    />
                    {inputImages.length > 1 && (
                      <span className="text-[9px] text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
                        {inputImageLabels[i] ?? `${t('chat.imageLabel')} ${i + 1}`}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace' }}>
            {prompt}
          </p>
        </div>
      )}
    </div>
  );
}

function CompletionActionCard({ actions, disabled, onAction }: {
  actions: CompletionAction[];
  disabled?: boolean;
  onAction?: (action: CompletionAction) => void;
}) {
  const { t } = useLocale();
  if (!actions.length) return null;
  return (
    <div className="mt-2 rounded-xl overflow-hidden" style={{ maxWidth: 308, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="px-3.5 py-3">
        <div className="text-[11px] font-medium mb-1" style={{ color: 'rgba(255,255,255,0.42)' }}>
          {t('artifact.nextSteps')}
        </div>
        <div className="flex flex-col gap-2">
          {actions.map((action, idx) => (
            <div key={`${action.label}-${idx}`} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.82)' }}>
                  {action.label}
                </div>
                {action.description && (
                  <div className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.34)' }}>
                    {action.description}
                  </div>
                )}
              </div>
              <button
                disabled={disabled}
                onClick={() => onAction?.(action)}
                className="px-3 py-1.5 rounded-full flex-shrink-0 active:scale-95 transition-transform text-[11px] font-semibold disabled:opacity-40"
                style={{ background: 'rgba(192,38,211,0.20)', color: '#f0abfc', border: '1px solid rgba(192,38,211,0.28)' }}
              >
                {t('artifact.continue')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Fix CommonMark strict closing-delimiter rules that break **text:**
/** Playable music track card for CUI */
function MusicCard({ track, onSelect }: {
  track: { playUrl: string; finalUrl: string; duration: number; title: string; tags: string; trackIndex: number };
  onSelect: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const loadedUrlRef = useRef(track.playUrl);

  // When finalUrl arrives and not playing, swap to final URL
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track.finalUrl || playing) return;
    if (loadedUrlRef.current !== track.finalUrl) {
      audio.src = track.finalUrl;
      loadedUrlRef.current = track.finalUrl;
    }
  }, [track.finalUrl, playing]);

  const bestUrl = track.finalUrl || track.playUrl;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause(); setPlaying(false);
    } else {
      // If final URL arrived, swap before playing
      if (track.finalUrl && loadedUrlRef.current !== track.finalUrl) {
        audio.src = track.finalUrl;
        loadedUrlRef.current = track.finalUrl;
      }
      document.dispatchEvent(new CustomEvent('music-play', { detail: bestUrl }));
      audio.play(); setPlaying(true);
    }
  };

  // Listen for other MusicCards starting — pause this one
  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent).detail;
      if (url !== bestUrl && audioRef.current) {
        audioRef.current.pause();
        setPlaying(false);
      }
    };
    document.addEventListener('music-play', handler);
    return () => document.removeEventListener('music-play', handler);
  }, [bestUrl]);

  // Progress + time update
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      const p = audio.duration ? audio.currentTime / audio.duration : 0;
      setProgress(p);
      setCurrentTime(audio.currentTime);
    };
    audio.addEventListener('timeupdate', onTime);
    return () => audio.removeEventListener('timeupdate', onTime);
  }, []);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = bestUrl;
    a.download = `${track.title || 'music'}.mp3`;
    a.click();
  };

  const isStreaming = !track.finalUrl;
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="mt-2 rounded-xl overflow-hidden" style={{ maxWidth: 308, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <audio ref={audioRef} src={track.playUrl} preload="metadata"
        onEnded={() => { setPlaying(false); setProgress(0); }} />

      <div className="flex items-center gap-3 px-3.5 py-3.5">
        {/* Play/pause */}
        <button onClick={toggle} onTouchEnd={(e) => { e.preventDefault(); toggle(); }}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
          style={{ background: playing ? 'rgba(192,38,211,0.3)' : 'rgba(255,255,255,0.1)' }}>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 12 12" fill="white"><rect x="1.5" y="1" width="3" height="10" rx="0.8" /><rect x="7.5" y="1" width="3" height="10" rx="0.8" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 12 12" fill="white"><path d="M2.5 1v10l8.5-5z" /></svg>
          )}
        </button>

        {/* Title + progress + tags */}
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.8)' }}>
            {track.title || `Track ${track.trackIndex + 1}`}{' '}
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>#{track.trackIndex + 1}</span>
          </div>
          <div className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {playing || currentTime > 0
              ? `${formatTime(currentTime)}${track.duration ? ` / ${formatTime(track.duration)}` : ''}`
              : track.duration ? formatTime(track.duration) : (isStreaming ? 'streaming...' : '--:--')
            } · {track.tags || 'instrumental'}
          </div>
        </div>

        {/* Download */}
        <button onClick={handleDownload} onTouchEnd={(e) => { e.preventDefault(); handleDownload(); }}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 active:opacity-70 transition-all"
          style={{ background: 'rgba(255,255,255,0.06)' }} title="Download">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>

        {/* Insert into design */}
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(); }}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 active:opacity-80 transition-all"
          style={{ background: 'rgba(192,38,211,0.2)', border: '1px solid rgba(192,38,211,0.3)' }} title="Add to design">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgb(192,38,211)" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Progress bar — fused with bottom edge, thickens on touch/drag */}
      <div className="relative w-full" style={{ height: 2 }}>
        {/* Visual bar */}
        <div className="absolute bottom-0 left-0 right-0" style={{ height: seeking ? 5 : 2, transition: 'height 0.15s ease', background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full" style={{ width: `${progress * 100}%`, background: 'rgba(192,38,211,0.8)' }} />
        </div>
        {/* Touch target: 40px centered on bar (20px up + 20px down), direct slide triggers seek */}
        <input
          type="range" min={0} max={1} step={0.001}
          value={progress}
          onChange={(e) => {
            setSeeking(true);
            const ratio = parseFloat(e.target.value);
            const audio = audioRef.current;
            if (audio && audio.duration) {
              audio.currentTime = ratio * audio.duration;
              setCurrentTime(audio.currentTime);
            }
            setProgress(ratio);
          }}
          onPointerUp={() => setSeeking(false)}
          onTouchEnd={() => setSeeking(false)}
          onMouseLeave={(e) => { if (!e.buttons) setSeeking(false); }}
          className="absolute left-0 right-0 opacity-0 cursor-pointer"
          style={{ touchAction: 'none', height: 40, top: -19 }}
        />
      </div>
    </div>
  );
}

/**
 * When closing ** is preceded by punctuation and followed by non-whitespace,
 * it's not recognized as right-flanking. Move the trailing punctuation outside.
 * e.g. "**下一步建议:**在" → "**下一步建议**:在"
 */
function fixMarkdownDelimiters(text: string): string {
  return text.replace(
    /\*\*([^*\n]+?)([;:,.!?，。！？；：、…]+)\*\*(?=[^\s*])/g,
    '**$1**$2'
  );
}

const CODE_COLLAPSE_LINE_THRESHOLD = 24;
const CODE_COLLAPSE_CHAR_THRESHOLD = 1800;

function getCodeLineCount(text: string): number {
  return text.replace(/\n$/, '').split('\n').length;
}

function shouldCollapseCodeBlock(text: string): boolean {
  return getCodeLineCount(text) > CODE_COLLAPSE_LINE_THRESHOLD
    || text.length > CODE_COLLAPSE_CHAR_THRESHOLD;
}

/** Collapsible code block — original markdown code style + toggle button */
function CollapsibleCode({ text, isPanel }: { text: string; isPanel: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = getCodeLineCount(text);

  return (
    <div className="my-2">
      <button
        className="flex items-center gap-1.5 mb-1"
        style={{ color: 'rgba(255,255,255,0.35)', fontSize: isPanel ? '12px' : '13px' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span>{expanded ? 'Hide code' : `Show code (${lineCount} lines)`}</span>
      </button>
      {expanded && (
        <code className={`block font-mono ${isPanel ? 'text-[14px] p-2' : 'text-[18px] p-3'} rounded-xl overflow-x-auto`} style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)' }}>
          {text}
        </code>
      )}
    </div>
  );
}

/** Shared Markdown renderer to avoid duplicating component overrides.
 *  <<<media_N>>> and <<<image_N>>> tokens are converted to `MEDIA_REF_N` inline code before parsing,
 *  then the `code` component renders ImageRefChip for matching tokens. */
function MarkdownBlock({ text, isPanel, snapshots, onNavigateToSnapshot, onPreviewSnapshot, onViewFile }: { text: string; isPanel: boolean; snapshots?: Snapshot[]; onNavigateToSnapshot?: (index: number) => void; onPreviewSnapshot?: (index: number, triggerEl?: HTMLElement | null) => void; onViewFile?: (path: string) => void }) {
  // Replace <<<media_N>>> and <<<image_N>>> with inline code `MEDIA_REF_N` so markdown structure stays intact
  let processed = snapshots
    ? text.replace(/<<<(?:image|media)_(\d+)>>>/g, '`MEDIA_REF_$1`')
    : text;
  // Replace `path/to/file.md` with FILE_REF token for clickable file chips
  processed = processed.replace(/`([^`]*\.md)`/g, '`FILE_REF_$1`');

  // Memoize components so ReactMarkdown keeps stable component types across re-renders.
  // Without this, streaming text causes parent re-renders → new function refs → ImageRefChip
  // unmounts/remounts on every chunk, resetting popover state and causing preview image flash.
  const components = useMemo(() => ({
    h1: ({ children }: { children?: React.ReactNode }) => <h1 className={`${isPanel ? 'text-[20px]' : 'text-[24px]'} font-bold mt-3 mb-1`}>{children}</h1>,
    h2: ({ children }: { children?: React.ReactNode }) => <h2 className={`${isPanel ? 'text-[18px]' : 'text-[22px]'} font-semibold mt-3 mb-1`}>{children}</h2>,
    h3: ({ children }: { children?: React.ReactNode }) => <h3 className={`${isPanel ? 'text-[17px]' : 'text-[21px]'} font-semibold mt-2 mb-0.5`}>{children}</h3>,
    p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-white/95">{children}</strong>,
    em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
    del: ({ children }: { children?: React.ReactNode }) => <del className="line-through opacity-50">{children}</del>,
    code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) => {
      // Intercept MEDIA_REF_N tokens → render ImageRefChip (check regardless of inline flag)
      if (snapshots) {
        const str = String(children);
        const m = str.match(/^MEDIA_REF_(\d+)$/);
        if (m) {
          const idx = parseInt(m[1]) - 1;
          return <ImageRefChip index={idx} snapshot={snapshots[idx]} onNavigate={onNavigateToSnapshot} onPreview={onPreviewSnapshot} />;
        }
      }
      // Intercept FILE_REF tokens → render FileRefChip
      {
        const str2 = String(children);
        const fileMatch = str2.match(/^FILE_REF_(.+)$/);
        if (fileMatch) {
          return <FileRefChip path={fileMatch[1]} onView={onViewFile} />;
        }
      }
      // Treat short single-line code as inline even if markdown parser says block
      const text = String(children);
      const isShort = !text.includes('\n') && text.length < 60;
      if (inline || isShort) {
        return <code className={`font-mono ${isPanel ? 'text-[14px]' : 'text-[18px]'} px-1.5 py-0.5 rounded`} style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)' }}>{children}</code>;
      }
      // Only truly long code blocks default to collapsed. Short fenced blocks
      // are often scripts, outlines, or structured notes rather than code dumps.
      if (shouldCollapseCodeBlock(text)) {
        return <CollapsibleCode text={text} isPanel={isPanel} />;
      }
      return <code className={`block font-mono ${isPanel ? 'text-[14px] p-2' : 'text-[18px] p-3'} rounded-xl my-2 overflow-x-auto`} style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)' }}>{children}</code>;
    },
    pre: ({ children }: { children?: React.ReactNode }) => <pre className="my-0">{children}</pre>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-none pl-3 my-1.5 space-y-0.5">{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-none pl-3 my-1.5 space-y-0.5 [counter-reset:item]">{children}</ol>,
    li: ({ children, ordered }: { children?: React.ReactNode; ordered?: boolean }) => (
      <li className={`flex gap-2 ${ordered ? '[counter-increment:item]' : ''}`}>
        <span className="flex-shrink-0 mt-[3px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
          {ordered ? <span className="font-mono text-[18px] before:content-[counter(item,decimal)_'.']" /> : '•'}
        </span>
        <span>{children}</span>
      </li>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="pl-3 my-2" style={{ borderLeft: '2px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)' }}>{children}</blockquote>
    ),
    hr: () => <hr className="my-3" style={{ borderColor: 'rgba(255,255,255,0.08)' }} />,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: 'rgba(192,38,211,0.85)' }}>{children}</a>
    ),
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="overflow-x-auto my-2">
        <table className={`${isPanel ? 'text-[16px]' : 'text-[20px]'} border-collapse w-full`}>{children}</table>
      </div>
    ),
    th: ({ children }: { children?: React.ReactNode }) => <th className="px-3 py-1.5 text-left font-semibold" style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)' }}>{children}</th>,
    td: ({ children }: { children?: React.ReactNode }) => <td className="px-3 py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{children}</td>,

  }), [snapshots, onNavigateToSnapshot, onPreviewSnapshot, onViewFile, isPanel]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
    >
      {processed}
    </ReactMarkdown>
  );
}

export type PreferredModel = 'auto' | 'gemini' | 'gemini-lite' | 'qwen' | 'pony' | 'wai' | 'openai';

export interface ComposerDraftAttachment {
  id: string;
  type: 'image';
  data: string;
  thumbnail?: string;
}

interface AgentChatViewProps {
  messages: Message[];
  isAgentActive: boolean;
  agentStatus: string;
  currentImage?: string;
  onSendMessage: (text: string, attachedImages?: string[], attachedVideos?: { url: string; duration: number; width: number; height: number; poster: string }[]) => void;
  onAbort?: () => void;
  onBack: () => void;
  onPipTap: (rect: DOMRect) => void;
  onImageTap: (messageId: string, rect?: DOMRect, imgSrc?: string) => void;
  focusOnOpen?: boolean;
  hidePip?: boolean;
  onInputBarHeight?: (h: number) => void;
  mode?: 'overlay' | 'panel';
  skipSlideIn?: boolean;
  messagesLoading?: boolean;
  snapshots?: Snapshot[];
  /** 1-based index of current snapshot for PiP @N badge */
  currentSnapshotIndex?: number;
  preferredModel?: PreferredModel;
  onModelChange?: (model: PreferredModel) => void;
  videoAuto?: boolean;
  onVideoAutoChange?: (auto: boolean) => void;
  videoModel?: import('@/types').VideoModel;
  onVideoModelChange?: (model: import('@/types').VideoModel) => void;
  videoResolution?: import('@/types').VideoResolution;
  onVideoResolutionChange?: (resolution: import('@/types').VideoResolution) => void;
  agentModel?: AgentModelPreference;
  onAgentModelChange?: (model: AgentModelPreference) => void;
  /** Navigate GUI canvas to snapshot by 0-based index */
  onNavigateToSnapshot?: (index: number) => void;
  /** Tap video in CUI → jump to GUI video entry */
  onVideoTap?: (rect?: DOMRect, posterSrc?: string, animId?: string, startTime?: number) => void;
  /** Design poster captured from visible Player — update snapshot.image */
  onDesignPoster?: (messageId: string, posterDataUrl: string) => void;
  /** User selected a music track from MusicCard */
  onMusicSelect?: (track: { audioUrl: string; duration: number; title: string; tags: string; trackIndex: number }) => void;
  /** User selected a next-step action from an artifact card */
  onArtifactAction?: (action: CompletionAction) => void;
  /** Background task running (music generation, video rendering) — show status even when agent is idle */
  hasBackgroundTask?: boolean;
  /** Open CreditPopup when credits are exhausted */
  onOpenCreditPopup?: () => void;
  /** Project ID for video upload storage path */
  projectId?: string;
  /** Skills for skill picker */
  skills?: SkillItem[];
  selectedSkill?: string | null;
  draftText?: string;
  draftAttachments?: ComposerDraftAttachment[];
  onSkillChange?: (skill: string | null) => void;
  onDeleteSkill?: (name: string) => void;
  onUploadSkill?: () => void;
  installingSkill?: boolean;
  onDropSkillFile?: (file: File) => void;
  readOnly?: boolean;
}

export default function AgentChatView({
  messages,
  isAgentActive,
  agentStatus,
  currentImage,
  onSendMessage,
  onAbort,
  onBack,
  onPipTap,
  onImageTap,
  focusOnOpen = false,
  hidePip = false,
  onInputBarHeight,
  mode = 'overlay',
  skipSlideIn = false,
  messagesLoading = false,
  snapshots = [],
  currentSnapshotIndex,
  preferredModel = 'auto',
  onModelChange,
  videoAuto = true,
  onVideoAutoChange,
  videoModel = getDefaultVideoModelId(),
  onVideoModelChange,
  videoResolution = 'auto',
  onVideoResolutionChange,
  agentModel = 'auto',
  onAgentModelChange,
  onNavigateToSnapshot,
  onVideoTap,
  onMusicSelect,
  onArtifactAction,
  hasBackgroundTask = false,
  onOpenCreditPopup,
  projectId,
  skills,
  selectedSkill,
  draftText,
  draftAttachments,
  onSkillChange,
  onDeleteSkill,
  onUploadSkill,
  installingSkill,
  onDropSkillFile,
  readOnly,
}: AgentChatViewProps) {
  const { t } = useLocale();

  // Find 1-based snapshot index by messageId (for @N badge on inline images)
  const getSnapshotIndex = useCallback((messageId: string): number | null => {
    const idx = snapshots.findIndex(s => s.messageId === messageId);
    return idx >= 0 ? idx + 1 : null;
  }, [snapshots]);

  const [input, setInput] = useState('');
  const lastDraftTextRef = useRef<string | undefined>(undefined);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  // Unified attachment system: images + videos in one array
  interface Attachment {
    id: string;
    type: 'image' | 'video';
    thumbnail: string;
    status: 'processing' | 'ready' | 'error';
    data?: string; // image: base64; video: storage URL
    duration?: number;
    width?: number;
    height?: number;
  }
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const processingCount = attachments.filter(a => a.status === 'processing').length;
  const allReady = attachments.length > 0 && attachments.every(a => a.status === 'ready' || a.status === 'error');
  const [isExiting, setIsExiting] = useState(false);
  const [inlineImagePreview, setInlineImagePreview] = useState<{
    src: string;
    snapIdx: number | null;
    style: React.CSSProperties;
  } | null>(null);
  const [inlineImagePreviewLoadedUrl, setInlineImagePreviewLoadedUrl] = useState<string | null>(null);
  const inlineImagePreviewRef = useRef<HTMLSpanElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCountRef = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const processingImageCount = processingCount; // legacy compat for any remaining references
  // Capture skipSlideIn at mount time — ignore prop changes after mount
  const [mountedWithSkip] = useState(skipSlideIn);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
  const scrollStartY = useRef<number | null>(null);
  const userScrolledUp = useRef(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(56);
  const [inputBarH, setInputBarH] = useState(96);

  // ── Keyboard inset (visualViewport) — no container resize, no jump ──
  const [kbInset, setKbInset] = useState(0);
  const [nativeKbInset, setNativeKbInset] = useState(0);
  const syncKeyboardInsetFromViewport = useCallback(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    setKbInset(Math.round(inset));
  }, []);
  const keepInputAboveKeyboard = useCallback(() => {
    syncKeyboardInsetFromViewport();
    window.setTimeout(syncKeyboardInsetFromViewport, 80);
    window.setTimeout(syncKeyboardInsetFromViewport, 220);
    window.setTimeout(() => {
      inputBarRef.current?.scrollIntoView({ block: 'end', inline: 'nearest' });
    }, 260);
  }, [syncKeyboardInsetFromViewport]);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    vv.addEventListener('resize', syncKeyboardInsetFromViewport);
    vv.addEventListener('scroll', syncKeyboardInsetFromViewport);
    return () => {
      vv.removeEventListener('resize', syncKeyboardInsetFromViewport);
      vv.removeEventListener('scroll', syncKeyboardInsetFromViewport);
    };
  }, [syncKeyboardInsetFromViewport]);
  useEffect(() => {
    const readNativeInset = () => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--makaron-native-keyboard-inset')
        .trim();
      const next = Number.parseFloat(raw);
      setNativeKbInset(Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0);
    };
    const onNativeInset = (event: Event) => {
      const inset = (event as CustomEvent<{ inset?: number }>).detail?.inset;
      if (typeof inset === 'number') {
        setNativeKbInset(Math.max(0, Math.round(inset)));
      } else {
        readNativeInset();
      }
    };
    readNativeInset();
    window.addEventListener('makaron-keyboard-inset-change', onNativeInset);
    return () => window.removeEventListener('makaron-keyboard-inset-change', onNativeInset);
  }, []);
  const effectiveKbInset = Math.max(kbInset, nativeKbInset);
  const keyboardInsetCss = `max(var(--makaron-native-keyboard-inset, 0px), ${kbInset}px)`;

  useEffect(() => {
    if (draftText === lastDraftTextRef.current) return;
    lastDraftTextRef.current = draftText;
    if (!draftText) return;
    setInput(draftText);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(draftText.length, draftText.length);
    });
  }, [draftText]);

  const lastDraftAttachmentsRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!draftAttachments?.length) return;
    const key = draftAttachments.map(a => `${a.id}:${a.data.length}`).join('|');
    if (key === lastDraftAttachmentsRef.current) return;
    lastDraftAttachmentsRef.current = key;
    setAttachments(prev => {
      const withoutDraftDuplicates = prev.filter(att => !draftAttachments.some(d => d.id === att.id));
      return [
        ...withoutDraftDuplicates,
        ...draftAttachments.map(att => ({
          id: att.id,
          type: att.type,
          thumbnail: att.thumbnail || att.data,
          status: 'ready' as const,
          data: att.data,
        })),
      ];
    });
    requestAnimationFrame(() => {
      const len = inputRef.current?.value.length ?? 0;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(len, len);
    });
  }, [draftAttachments]);

  // ── PiP drag state ──────────────────────────────────────────────
  type PipCorner = 'tl' | 'tr' | 'ml' | 'mr' | 'bl' | 'br';
  const PIP_SIZES = [116, 200] as const; // md / lg (small removed)
  const PIP_M = 14;
  const INPUT_GRADIENT_TOP = 32; // paddingTop on input bar wrapper (gradient zone)
  const PIP_BOTTOM_OFFSET = inputBarH - INPUT_GRADIENT_TOP + 4 + effectiveKbInset; // just above actual input box
  const PIP_PEEK = 28;        // px visible when hidden at right edge
  const PIP_EXTRA_PULL = 60;  // px past right margin needed to trigger tuck

  const [pipSizeIndex, setPipSizeIndex] = useState<number>(0); // default sm (116px)
  const PIP = PIP_SIZES[pipSizeIndex];
  const [pipCorner, setPipCorner] = useState<PipCorner>('br');
  const [pipFloatPos, setPipFloatPos] = useState<{ x: number; y: number } | null>(null);
  const [pipHidden, setPipHidden] = useState(false);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [skillSelectorOpen, setSkillSelectorOpen] = useState(false);
  const [pipHiddenEdge, setPipHiddenEdge] = useState<'left' | 'right'>('right');
  const [pipHiddenY, setPipHiddenY] = useState(0);
  const pipDragRef = useRef<{ sx: number; sy: number; ex: number; ey: number } | null>(null);
  const pipDidDrag = useRef(false);
  // Tuck only allowed when drag started from the matching edge corner (two-step UX)
  const pipStartedAtRightEdge = useRef(false);
  const pipStartedAtLeftEdge = useRef(false);

  function pipCornerStyle(corner: PipCorner): React.CSSProperties {
    const m = PIP_M;
    const b = PIP_BOTTOM_OFFSET;
    const topY = headerH + m;
    // Middle: vertically centred in the content area between header and input bar
    const midY = Math.round((headerH + (window.innerHeight - b)) / 2 - PIP / 2);
    if (corner === 'tl') return { top: topY, left: m };
    if (corner === 'tr') return { top: topY, right: m };
    if (corner === 'ml') return { top: midY, left: m };
    if (corner === 'mr') return { top: midY, right: m };
    if (corner === 'bl') return { bottom: b, left: m };
    return { bottom: b, right: m };
  }

  const handleBack = useCallback(() => setIsExiting(true), []);

  const onPipPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation(); // block touch from reaching scroll container (prevents screen jump when keyboard is up)
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    pipDragRef.current = { sx: e.clientX, sy: e.clientY, ex: rect.left, ey: rect.top };
    pipDidDrag.current = false;
    // Only drags starting from an edge corner can tuck that side (two-step UX)
    const W = window.innerWidth;
    pipStartedAtRightEdge.current = rect.right >= W - PIP_M - 8;
    pipStartedAtLeftEdge.current = rect.left <= PIP_M + 8;
  }, [PIP_M]);

  const onPipPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pipDragRef.current || pipHidden) return;
    const dx = e.clientX - pipDragRef.current.sx;
    const dy = e.clientY - pipDragRef.current.sy;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) pipDidDrag.current = true;
    if (!pipDidDrag.current) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    // Both edges: allow dragging into tuck zone past normal margin
    setPipFloatPos({
      x: Math.max(-(PIP - PIP_PEEK), Math.min(W - PIP_PEEK, pipDragRef.current.ex + dx)),
      y: Math.max(PIP_M, Math.min(H - PIP - PIP_BOTTOM_OFFSET, pipDragRef.current.ey + dy)),
    });
  }, [PIP, pipHidden, PIP_PEEK, PIP_M, PIP_BOTTOM_OFFSET]);

  const onPipPointerUp = useCallback((_e: React.PointerEvent) => {
    if (!pipDragRef.current) return;
    const wasDrag = pipDidDrag.current;
    const lastPos = pipFloatPos;
    pipDragRef.current = null;
    pipDidDrag.current = false;

    // Any interaction while hidden → reveal (tap or swipe both work)
    if (pipHidden) {
      setPipHidden(false);
      setPipFloatPos(null);
      return;
    }

    if (wasDrag && lastPos) {
      const W = window.innerWidth;
      const clampedY = Math.max(headerH + PIP_M, Math.min(window.innerHeight - PIP_BOTTOM_OFFSET - PIP, lastPos.y));

      const wasAtRightEdge = pipStartedAtRightEdge.current;
      const wasAtLeftEdge = pipStartedAtLeftEdge.current;
      pipStartedAtRightEdge.current = false;
      pipStartedAtLeftEdge.current = false;
      // Left tuck: must start from left-edge corner AND push past threshold
      if (wasAtLeftEdge && lastPos.x < -(PIP - PIP_PEEK - PIP_EXTRA_PULL)) {
        setPipHiddenEdge('left');
        setPipHiddenY(clampedY);
        setPipHidden(true);
        setPipFloatPos(null);
        return;
      }
      // Right tuck: from right-edge corner, push past right margin
      if (wasAtRightEdge && lastPos.x > W - PIP - PIP_M + PIP_EXTRA_PULL) {
        setPipHiddenEdge('right');
        setPipHiddenY(clampedY);
        setPipHidden(true);
        setPipFloatPos(null);
        return;
      }
      // Normal: snap to nearest corner
      const cx = lastPos.x + PIP / 2;
      const cy = lastPos.y + PIP / 2;
      const isLeft = cx < W / 2;
      const yTop = headerH;
      const yBot = window.innerHeight - PIP_BOTTOM_OFFSET;
      const zone1 = yTop + (yBot - yTop) / 3;
      const zone2 = yTop + (yBot - yTop) * 2 / 3;
      let corner: PipCorner;
      if (cy < zone1) corner = isLeft ? 'tl' : 'tr';
      else if (cy > zone2) corner = isLeft ? 'bl' : 'br';
      else corner = isLeft ? 'ml' : 'mr';
      setPipCorner(corner);
      setPipFloatPos(null);
    } else if (!wasDrag) {
      pipStartedAtRightEdge.current = false;
      pipStartedAtLeftEdge.current = false;
      // Tap PiP body → hero animation + return to GUI
      const pipEl = _e.currentTarget as HTMLElement;
      const kbOpen = effectiveKbInset > 50 || (window.visualViewport
        ? window.innerHeight - window.visualViewport.height > 50
        : false);
      if (kbOpen) {
        // Dismiss keyboard first; re-measure PiP rect after it closes, then animate
        inputRef.current?.blur();
        setTimeout(() => {
          const rect = pipEl.getBoundingClientRect();
          onPipTap?.(rect);
          handleBack();
        }, 300);
      } else {
        const rect = pipEl.getBoundingClientRect();
        onPipTap?.(rect);
        handleBack();
      }
    }
  }, [pipFloatPos, headerH, pipHidden, PIP, PIP_M, PIP_BOTTOM_OFFSET, PIP_EXTRA_PULL, effectiveKbInset, handleBack, onPipTap]);
  // ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (headerRef.current) setHeaderH(headerRef.current.offsetHeight);
  }, []);

  // Track input bar height so PiP moves up when textarea grows
  useEffect(() => {
    const el = inputBarRef.current;
    if (!el) return;
    const update = () => {
      setInputBarH(el.offsetHeight);
      onInputBarHeight?.(el.offsetHeight);
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [onInputBarHeight]);

  // On mount: keep scroll pinned to bottom until content stabilizes (images loading etc.)
  const mountRoRef = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    });
    mountRoRef.current = ro;
    const content = el.firstElementChild;
    if (content) ro.observe(content);
    const timer = setTimeout(() => { ro.disconnect(); mountRoRef.current = null; }, 5000); // Extended for reconnect replay
    return () => { ro.disconnect(); mountRoRef.current = null; clearTimeout(timer); cancelAnimationFrame(rafId); };

  }, []);

  // Auto-scroll ONLY when AI is actively streaming content (not on mount or status changes)
  const prevMsgCountRef = useRef(messages.length);
  const prevLastMsgLenRef = useRef(0);
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    const prevCount = prevMsgCountRef.current;
    const msgCountChanged = messages.length !== prevCount;
    const lastMsgGrew = lastMsg?.role === 'assistant' && lastMsg.content.length > prevLastMsgLenRef.current;
    const bigJump = msgCountChanged && (messages.length > prevCount + 2 || (prevCount === 0 && messages.length > 0)); // Supabase load / reconnect / first messages

    prevMsgCountRef.current = messages.length;
    prevLastMsgLenRef.current = lastMsg?.content?.length ?? 0;

    // Auto-scroll: during streaming, on big data loads (reconnect/Supabase), unless user scrolled up
    const shouldScroll = (isAgentActive && (msgCountChanged || lastMsgGrew)) || bigJump;
    if (shouldScroll && !userScrolledUp.current) {
      // Big data jump (reconnect/Supabase load): snap to bottom instantly, no animation
      // Streaming: smooth scroll
      messagesEndRef.current?.scrollIntoView({ behavior: bigJump ? 'instant' : 'smooth' });
    }
  }, [messages, isAgentActive]);

  useEffect(() => {
    if (!focusOnOpen) return;
    inputRef.current?.focus();
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [focusOnOpen]);

  // Track whether user has scrolled away from the bottom (suppress auto-scroll)
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledUp.current = distFromBottom > 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Dismiss keyboard when user scrolls the chat (iOS Safari: native listeners work more reliably)
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => { scrollStartY.current = e.touches[0].clientY; };
    const onTouchMove = (e: TouchEvent) => {
      if (scrollStartY.current === null) return;
      if (Math.abs(e.touches[0].clientY - scrollStartY.current) > 8) {
        inputRef.current?.blur();
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  // Auto-resize textarea on every input change
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    const hasContent = text || attachments.some(a => a.status === 'ready');
    const hasProcessing = attachments.some(a => a.status === 'processing');
    if (!hasContent || isAgentActive || hasProcessing) return;

    const finalText = selectedSkill && text ? `[Active skill: ${selectedSkill}]\n${text}` : text;
    const imageData = attachments.filter(a => a.type === 'image' && a.data).map(a => a.data!);
    const videoData = attachments.filter(a => a.type === 'video' && a.data).map(a => ({
      url: a.data!, duration: a.duration || 0, width: a.width || 1080, height: a.height || 1920, poster: a.thumbnail,
    }));

    onSendMessage(finalText, imageData.length > 0 ? imageData : undefined, videoData.length > 0 ? videoData : undefined);
    userScrolledUp.current = false;
    setInput('');
    setAttachments([]);
    if (selectedSkill) onSkillChange?.(null);
  }, [input, attachments, isAgentActive, onSendMessage, selectedSkill, onSkillChange]);

  const handleAnimationEnd = useCallback(() => {
    if (isExiting) onBack();
  }, [isExiting, onBack]);

  const openInlineImagePreview = useCallback((src: string, snapIdx: number | null, triggerEl?: HTMLElement | null) => {
    if (!src) return;
    const triggerRect = triggerEl?.getBoundingClientRect();
    const pw = Math.min(300, window.innerWidth * 0.6);
    let left = (window.innerWidth - pw) / 2;
    let top = Math.max(8, Math.min(96, window.innerHeight - pw - 8));
    if (triggerRect) {
      const triggerCenter = triggerRect.left + triggerRect.width / 2;
      left = triggerCenter - pw / 2;
      if (left < 8) left = 8;
      if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
      const spaceAbove = triggerRect.top - 8;
      const spaceBelow = window.innerHeight - triggerRect.bottom - 8;
      top = spaceAbove >= pw || spaceAbove >= spaceBelow
        ? triggerRect.top - pw - 4
        : triggerRect.bottom + 4;
      top = Math.max(8, Math.min(top, window.innerHeight - pw - 8));
    }
    setInlineImagePreview({
      src,
      snapIdx,
      style: {
        position: 'absolute',
        top,
        left,
        width: pw,
        height: pw,
        zIndex: 9999,
      },
    });
  }, []);

  const handleInlineImageClick = useCallback((messageId: string, e?: React.MouseEvent) => {
    const triggerEl = e?.currentTarget as HTMLElement | undefined;
    const imgEl = triggerEl?.querySelector('img') as HTMLImageElement | null;
    const msg = messages.find(m => m.id === messageId);
    const previewSrc = msg?.image || imgEl?.src || '';
    const snapIdx = getSnapshotIndex(messageId);
    if (!previewSrc) return;
    openInlineImagePreview(previewSrc, snapIdx, triggerEl);
  }, [getSnapshotIndex, messages, openInlineImagePreview]);

  const handleGeneratedImageClick = useCallback((messageId: string, e?: React.MouseEvent) => {
    const triggerEl = e?.currentTarget as HTMLElement | undefined;
    const imgEl = triggerEl?.querySelector('img') as HTMLImageElement | null;
    const msg = messages.find(m => m.id === messageId);
    const imgRect = imgEl?.getBoundingClientRect() || triggerEl?.getBoundingClientRect();
    const imgSrc = msg?.image || imgEl?.src || '';
    onImageTap(messageId, imgRect, imgSrc);
  }, [messages, onImageTap]);

  const handlePreviewSnapshot = useCallback((index: number, triggerEl?: HTMLElement | null) => {
    const snapshot = snapshots[index];
    const previewSrc = snapshot?.imageUrl || snapshot?.image || '';
    openInlineImagePreview(previewSrc, index + 1, triggerEl);
  }, [openInlineImagePreview, snapshots]);

  useEffect(() => {
    if (!inlineImagePreview) return;
    const close = () => setInlineImagePreview(null);
    const isOutside = (target: EventTarget | null) => {
      if (!target) return false;
      const node = target as Node;
      if (inlineImagePreviewRef.current?.contains(node)) return false;
      return true;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (isOutside(event.target)) close();
    };
    const onTouchStart = (event: TouchEvent) => {
      if (isOutside(event.target)) close();
    };
    document.addEventListener('scroll', close, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('touchstart', onTouchStart, true);
    return () => {
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('touchstart', onTouchStart, true);
    };
  }, [inlineImagePreview]);

  const handleInlineVideoClick = useCallback((e: React.MouseEvent, videoUrl: string, animId?: string, startTime?: number) => {
    if (!onVideoTap) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const videoSnap = animId ? snapshots.find(s => s.id === animId) : null;
    const posterSrc = videoSnap?.imageUrl || videoSnap?.image || snapshots[snapshots.length - 1]?.imageUrl || snapshots[snapshots.length - 1]?.image;
    setIsExiting(true);
    onVideoTap(rect ?? undefined, posterSrc, animId, startTime);
  }, [onVideoTap, snapshots]);


  const isPanel = mode === 'panel';

  return (
    <>
    <div
      className={isPanel
        ? 'flex flex-col h-full'
        : `fixed inset-0 z-40 flex flex-col ${isExiting ? 'animate-slide-out-right' : 'animate-slide-in-right'}`
      }
      style={{ background: '#0a0a0a' }}
      onAnimationEnd={isPanel ? undefined : handleAnimationEnd}
      onDragEnter={(e) => { e.preventDefault(); dragCountRef.current++; setIsDragOver(true); }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={() => { dragCountRef.current--; if (dragCountRef.current <= 0) { dragCountRef.current = 0; setIsDragOver(false); } }}
      onDrop={async (e) => {
        e.preventDefault();
        dragCountRef.current = 0;
        setIsDragOver(false);
        const allFiles = Array.from(e.dataTransfer.files);
        const zipFile = allFiles.find(f => f.name.endsWith('.zip') || f.type === 'application/zip');
        if (zipFile && onDropSkillFile) { onDropSkillFile(zipFile); return; }
        const files = allFiles.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(heic|heif)$/i.test(f.name));
        if (!files.length) return;
        // Trigger same logic as file input onChange — dispatch to input
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));
        const input = imageInputRef.current;
        if (input) { input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); }
      }}
    >
      {/* Drop zone overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center pointer-events-none" style={{ background: 'rgba(0,0,0,0.6)', border: '2px dashed rgba(217,70,239,0.5)', borderRadius: 12, margin: 8 }}>
          <span className="text-white/60 text-sm">Drop images here</span>
        </div>
      )}

      {/* ── Back button (overlay mode only) ── */}
      {!isPanel && (
        <div
          ref={headerRef}
          className="absolute top-0 left-0 z-50 px-3"
          style={{ paddingTop: 'var(--makaron-cui-header-top, max(0.75rem, env(safe-area-inset-top)))' }}
        >
          <button
            data-testid="chat-back"
            onClick={handleBack}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:bg-white/10 active:bg-white/15 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/80">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Floating PiP (overlay mode only) ── */}
      {!isPanel && currentImage && (
        <div
          data-testid="cui-pip"
          className="absolute z-50 rounded-2xl overflow-hidden select-none"
          style={{
            width: PIP,
            height: PIP,
            ...(pipHidden
              ? {
                  ...(pipHiddenEdge === 'left'
                    ? { left: -(PIP - PIP_PEEK) }
                    : { right: -(PIP - PIP_PEEK) }
                  ),
                  top: pipHiddenY,
                  transition: 'left 0.4s cubic-bezier(0.34,1.56,0.64,1), right 0.4s cubic-bezier(0.34,1.56,0.64,1), top 0.4s cubic-bezier(0.34,1.56,0.64,1)',
                }
              : pipFloatPos
                ? { left: pipFloatPos.x, top: pipFloatPos.y, transition: 'none' }
                : { ...pipCornerStyle(pipCorner), transition: (mountedWithSkip || hidePip) ? 'none' : 'left 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), right 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), bottom 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), height 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }
            ),
            boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
            border: '1.5px solid rgba(255,255,255,0.14)',
            touchAction: 'none',
            cursor: pipFloatPos ? 'grabbing' : 'grab',
            opacity: (hidePip || modelSelectorOpen || skillSelectorOpen) ? 0 : 1,
            pointerEvents: (modelSelectorOpen || skillSelectorOpen) ? 'none' as const : undefined,
          }}
          onPointerDown={onPipPointerDown}
          onPointerMove={onPipPointerMove}
          onPointerUp={onPipPointerUp}
          onPointerCancel={onPipPointerUp}
        >
          { }
          <img
            src={currentImage}
            alt="Current photo"
            className="w-full h-full object-cover pointer-events-none"
            draggable={false}
          />
          {/* @N badge — only when visible */}
          {!pipHidden && (
            <div
              className="absolute top-0 left-0 px-1.5 py-0.5 text-[12px] font-medium tracking-wide pointer-events-none"
              style={{
                background: 'rgba(0,0,0,0.55)',
                borderBottomRightRadius: 8,
                color: 'rgba(255,255,255,0.75)',
                backdropFilter: 'blur(4px)',
              }}
            >
              @{currentSnapshotIndex ?? snapshots.length ?? 1}
            </div>
          )}
          {/* Resize handle — bottom-right corner, cycles PIP size */}
          {!pipHidden && (
            <div
              className="absolute bottom-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPipSizeIndex(i => (i + 1) % PIP_SIZES.length);
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                   stroke="rgba(255,255,255,0.8)" strokeWidth="2.5" strokeLinecap="round">
                {PIP === PIP_SIZES[0]
                  ? (<>
                      <polyline points="15 3 21 3 21 9"/>
                      <polyline points="9 21 3 21 3 15"/>
                      <line x1="21" y1="3" x2="14" y2="10"/>
                      <line x1="3" y1="21" x2="10" y2="14"/>
                    </>)
                  : (<>
                      <polyline points="4 14 4 20 10 20"/>
                      <polyline points="20 10 20 4 14 4"/>
                      <line x1="14" y1="10" x2="20" y2="4"/>
                      <line x1="4" y1="20" x2="10" y2="14"/>
                    </>)
                }
              </svg>
            </div>
          )}
          {/* Peek arrow — only when hidden, on the visible edge */}
          {pipHidden && (
            <div
              className="absolute top-0 bottom-0 flex items-center justify-center"
              style={{
                [pipHiddenEdge === 'left' ? 'right' : 'left']: 0,
                width: PIP_PEEK,
                background: `linear-gradient(to ${pipHiddenEdge === 'left' ? 'right' : 'left'}, rgba(0,0,0,0.65) 0%, transparent 100%)`,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {pipHiddenEdge === 'left'
                  ? <polyline points="9 18 15 12 9 6" />   /* > pull from left */
                  : <polyline points="15 18 9 12 15 6" />  /* < pull from right */
                }
              </svg>
            </div>
          )}
        </div>
      )}

      {/* ── Messages ── */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto overscroll-contain hide-scrollbar px-4 min-h-0" style={{ gap: 0, paddingTop: isPanel ? '16px' : 'var(--makaron-cui-messages-top, calc(max(0.75rem, env(safe-area-inset-top)) + 2.75rem))', paddingBottom: isPanel ? '0' : `calc(${inputBarH}px + ${keyboardInsetCss})` }}>
        {/* Empty state or loading */}
        {messages.length === 0 && (
          messagesLoading ? (
            <div className="flex items-center justify-center h-full pb-10">
              <div className="w-6 h-6 border-2 border-white/10 border-t-fuchsia-400 rounded-full animate-spin" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 pb-10">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(192,38,211,0.15)' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-fuchsia-400">
                  <line x1="12" y1="2" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
                </svg>
              </div>
              <p className={`text-white/25 text-center leading-relaxed max-w-[220px] ${isPanel ? 'text-[17px]' : 'text-[19px]'}`}>
                Tell me what you&apos;d like to do with your photo
              </p>
            </div>
          )
        )}

        {/* Message list */}
        <div className={`flex flex-col ${isPanel ? 'gap-3' : 'gap-5'}`}>
          {messages.map((msg, idx) => (
            <div key={`${msg.id}:${idx}`}>
              {msg.role === 'user' ? (
                /* User bubble — right-aligned pill */
                <div className="flex min-w-0 justify-end overflow-hidden">
                  <div
                    className={`min-w-0 overflow-hidden text-white/90 leading-relaxed max-w-[82%] ${isPanel ? 'text-[17px]' : 'text-[21px]'}`}
                    style={{
                      background: '#222222',
                      borderRadius: isPanel ? '14px 14px 4px 14px' : '18px 18px 5px 18px',
                      wordBreak: 'break-word',
                    }}
                  >
                    {/* Attached reference images — square thumbnails */}
                    {msg.editInputImages && msg.editInputImages.length > 0 && (
                      <div
                        className={`hide-scrollbar flex max-w-full gap-1.5 overflow-x-auto overscroll-x-contain p-2 ${msg.content ? 'pb-1' : ''}`}
                        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
                      >
                        {msg.editInputImages.map((img, i) => (

                          <img key={i} src={img} alt="" className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />
                        ))}
                      </div>
                    )}
                    {msg.content && (
                      <div className={`whitespace-pre-wrap ${isPanel ? 'px-3 py-2' : 'px-4 py-2.5'}`}>{msg.content}</div>
                    )}
                  </div>
                </div>
              ) : (
                /* Assistant — no bubble, full-width text */
                <div className="flex flex-col gap-2.5">
                  <div className={`${isPanel ? 'text-[17px] leading-[1.6]' : 'text-[22px] leading-[1.68]'} pr-2`} style={{ color: 'rgba(255,255,255,0.84)', wordBreak: 'break-word' }}>
                    {/* Credits exhausted inline card */}
                    {msg.content?.startsWith('[CREDITS_EXHAUSTED:') && (() => {
                      const bal = parseInt(msg.content.match(/\d+/)?.[0] || '0');
                      return (
                        <div className="mt-2 rounded-xl overflow-hidden" style={{ maxWidth: 308, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <div className="flex items-center gap-3 px-3.5 py-3.5">
                            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                              style={{ background: 'rgba(192,38,211,0.15)' }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e879f9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] font-medium" style={{ color: 'rgba(255,255,255,0.8)' }}>
                                {t('billing.exhausted')}
                              </div>
                              <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                                {bal} remaining · <span style={{ color: '#fbbf24' }}>{t('billing.topUpToContinue')}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => onOpenCreditPopup?.()}
                              className="px-3 py-1.5 rounded-full flex-shrink-0 active:scale-90 transition-transform text-[11px] font-semibold"
                              style={{ background: 'rgba(192,38,211,0.2)', color: '#e879f9', border: '1px solid rgba(192,38,211,0.3)' }}
                            >
                              {t('billing.topUp')}
                            </button>
                          </div>
                          <div style={{ height: 2, background: 'rgba(192,38,211,0.4)' }} />
                        </div>
                      );
                    })()}
                    {msg.thinking?.map((segment, ti) => segment && (
                      <details key={ti} className="mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        <summary className="cursor-pointer select-none text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          Thinking{msg.thinking!.length > 1 ? ` (${ti + 1})` : ''}...
                        </summary>
                        <div className="mt-1 text-[13px] leading-[1.6] whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          {segment}
                        </div>
                      </details>
                    ))}
                    {msg.content && !msg.content.startsWith('[CREDITS_EXHAUSTED:') && (() => {
                      const { text: visibleText, actions } = splitCompletionActions(msg.content);
                      const inlineVideo = msg.design || msg.image || msg.content.includes('```')
                        ? null
                        : resolveInlineVideoCandidate(msg.content, snapshots);
                      const visibleWithoutVideoUrls = inlineVideo
                        ? removeAllInlineVideoUrls(visibleText)
                        : removeRenderableInlineVideoUrls(visibleText);
                      return (
                        <div className="markdown-body">
                          <MarkdownBlock
                            key={`${msg.id}:${idx}:markdown`}
                            text={fixMarkdownDelimiters(removeInlineMediaNavigationMarkers(visibleWithoutVideoUrls).replace(/\n?music:\d+\|[^\n]*/g, ''))}
                            isPanel={isPanel}
                            snapshots={snapshots}
                            onNavigateToSnapshot={onNavigateToSnapshot}
                            onPreviewSnapshot={handlePreviewSnapshot}
                            onViewFile={setViewingFile}
                          />
                          {/* Inline video — natural aspect ratio, play button, tap to navigate */}
                          {(() => {
                            if (!inlineVideo) return null;
                            const { url: videoUrl, navId, videoSnap } = inlineVideo;
                            const vw = videoSnap?.videoMeta?.width || 0;
                            const vh = videoSnap?.videoMeta?.height || 0;
                            const videoAR = vw && vh ? `${vw}/${vh}` : '9/16';
                            const posterUrl = videoSnap?.imageUrl || videoSnap?.image || undefined;
                            const snapIdx = videoSnap ? snapshots.indexOf(videoSnap) + 1 : undefined;
                            return <InlineCuiVideo url={videoUrl} aspectRatio={videoAR} posterUrl={posterUrl} snapIndex={snapIdx} isDesktop={isPanel} onNavigate={(e, time) => handleInlineVideoClick(e, videoUrl, navId, time)} />;
                          })()}
                          <CompletionActionCard
                            actions={actions}
                            disabled={readOnly || isAgentActive}
                            onAction={onArtifactAction}
                          />
                        </div>
                      );
                    })()}

                    {/* Typing dots — show when active, last message, no content yet */}
                    {!msg.content && isAgentActive && idx === messages.length - 1 && (
                      <span className="inline-flex gap-[5px] items-center h-[18px] mt-0.5">
                        <span className="typing-dot w-[6px] h-[6px] rounded-full" style={{ background: 'rgba(255,255,255,0.3)' }} />
                        <span className="typing-dot w-[6px] h-[6px] rounded-full" style={{ background: 'rgba(255,255,255,0.3)' }} />
                        <span className="typing-dot w-[6px] h-[6px] rounded-full" style={{ background: 'rgba(255,255,255,0.3)' }} />
                      </span>
                    )}

                    {/* Inline image — shared for generate_image and design poster */}
                    {msg.image && (() => {
                      const snapIdx = getSnapshotIndex(msg.id);
                      return (
                        <button
                          onClick={(e) => handleGeneratedImageClick(msg.id, e)}
                          className="block w-full mt-3 active:opacity-75 transition-opacity relative"
                        >
                          { }
                          <img
                            src={msg.image.startsWith('http') ? getThumbnailUrl(msg.image, isPanel ? 680 : 1024, 75, 2000, 'contain') : msg.image}
                            alt="Generated"
                            className="rounded-2xl"
                            style={{ border: '1px solid rgba(255,255,255,0.08)', maxWidth: 308 }}
                          />
                          {snapIdx !== null && (
                            <span className="absolute bottom-2 left-2 bg-black/60 backdrop-blur text-white text-sm font-medium px-2 py-0.5 rounded-md">
                              @{snapIdx}
                            </span>
                          )}
                        </button>
                      );
                    })()}

                    {/* Multiple preview frames (from preview_frame tool) */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex gap-2 mt-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                        {msg.images.map((url, i) => (
                          <button
                            key={`${msg.id}-frame-${i}`}
                            onClick={(e) => handleInlineImageClick(msg.id, e)}
                            className="flex-shrink-0 active:opacity-75 transition-opacity relative"
                          >
                            { }
                            <img
                              src={url.startsWith('http') ? getThumbnailUrl(url, isPanel ? 340 : 512, 75, 1000, 'contain') : url}
                              alt={`Frame ${i + 1}`}
                              className="rounded-xl"
                              style={{ border: '1px solid rgba(255,255,255,0.08)', height: 160, width: 'auto' }}
                            />
                            <span className="absolute bottom-1.5 left-1.5 bg-black/60 backdrop-blur text-white text-[10px] font-medium px-1.5 py-0.5 rounded-md">
                              {msg.imageCaptions?.[i] || `${i + 1}/${msg.images!.length}`}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* editPrompt card — collapsible */}
                    {msg.editPrompt && (
                      <EditPromptCard prompt={msg.editPrompt} inputImages={msg.editInputImages} editModel={msg.editModel} />
                    )}

                    {/* Inline music — format: "music:INDEX|TITLE|DURATION|TAGS|playUrl|finalUrl" */}
                    {(() => {
                      const musicMatches = msg.content.match(/music:\d+\|[^\n]+/g);
                      if (!musicMatches) return null;
                      return musicMatches.map((line) => {
                        const parts = line.replace('music:', '').split('|');
                        if (parts.length < 5) return null;
                        // 6-field format: parts[4]=playUrl, parts[5]=finalUrl
                        // 5-field backwards compat: parts[4]=audioUrl (used as both)
                        const playUrl = parts[4];
                        const finalUrl = parts.length >= 6 ? parts.slice(5).join('|') : playUrl;
                        const track = { trackIndex: parseInt(parts[0]), title: parts[1], duration: parseFloat(parts[2]), tags: parts[3], playUrl, finalUrl };
                        return (
                          <MusicCard key={track.trackIndex} track={track}
                            onSelect={() => onMusicSelect?.({ audioUrl: finalUrl || playUrl, duration: track.duration, title: track.title, tags: track.tags, trackIndex: track.trackIndex })} />
                        );
                      });
                    })()}
                  </div>

                </div>
              )}
            </div>
          ))}

          {/* Agent status line — below last message */}
          {(isAgentActive || hasBackgroundTask) && agentStatus && (
            <div className="flex items-center gap-2 pl-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-pulse flex-shrink-0" />
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>
                {agentStatus}
              </span>
            </div>
          )}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ── */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,video/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          for (const file of files) {
            const id = (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`;
            if (file.type.startsWith('video/')) {
              // Video: extract poster immediately, process in background
              try {
                const url = URL.createObjectURL(file);
                const v = document.createElement('video');
                v.muted = true; v.src = url;
                await new Promise<void>(r => { v.onloadedmetadata = () => r(); setTimeout(r, 5000); });
                const videoDuration = v.duration;
                const { MAX_DURATION, MAX_ACCEPTED_DURATION } = await import('@/lib/video-upload');
                if (videoDuration > MAX_ACCEPTED_DURATION) {
                  v.pause(); v.removeAttribute('src'); v.load();
                  URL.revokeObjectURL(url);
                  setAttachments(prev => [...prev, { id, type: 'video', thumbnail: '', status: 'error' as const }]);
                  setTimeout(() => setAttachments(prev => prev.filter(a => a.id !== id)), 3000);
                  alert(t('video.tooLong').replace('{duration}', videoDuration.toFixed(1).replace(/\.0$/, '')).replace('{max}', String(MAX_DURATION)));
                  continue;
                }
                v.currentTime = Math.min(0.5, v.duration * 0.1);
                await new Promise<void>(r => { v.onseeked = () => r(); setTimeout(r, 3000); });
                const c = document.createElement('canvas');
                c.width = v.videoWidth; c.height = v.videoHeight;
                c.getContext('2d')!.drawImage(v, 0, 0);
                const poster = c.toDataURL('image/jpeg', 0.75);
                v.pause(); v.removeAttribute('src'); v.load();
                URL.revokeObjectURL(url);
                setAttachments(prev => [...prev, { id, type: 'video', thumbnail: poster, status: 'processing' }]);
                // Background: transcode + upload
                import('@/lib/video-upload').then(({ uploadVideoToStorage }) =>
                  uploadVideoToStorage(file, projectId || '').then(result => {
                    setAttachments(prev => prev.map(a => a.id === id ? { ...a, status: 'ready' as const, data: result.videoUrl, duration: result.duration, width: result.width, height: result.height } : a));
                  }).catch(() => {
                    setAttachments(prev => prev.map(a => a.id === id ? { ...a, status: 'error' as const } : a));
                  })
                );
              } catch { /* skip unreadable video */ }
            } else {
              // Image: show placeholder, compress in background
              setAttachments(prev => [...prev, { id, type: 'image', thumbnail: '', status: 'processing' }]);
              compressImageFile(file).then(base64 => {
                setAttachments(prev => prev.map(a => a.id === id ? { ...a, status: 'ready' as const, thumbnail: base64, data: base64 } : a));
              }).catch(() => {
                setAttachments(prev => prev.filter(a => a.id !== id));
              });
            }
          }
        }}
      />

      {!readOnly && <div
        ref={inputBarRef}
        className={isPanel ? 'flex-shrink-0 px-3' : 'fixed left-0 right-0 px-3'}
        style={isPanel ? {
          paddingBottom: '12px',
          paddingTop: '12px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          zIndex: 20,
        } : {
          bottom: keyboardInsetCss,
          paddingBottom: effectiveKbInset > 0 ? '8px' : 'var(--makaron-cui-input-safe-bottom, max(0.75rem, env(safe-area-inset-bottom)))',
          paddingTop: '32px',
          background: 'linear-gradient(to bottom, transparent 0%, #0a0a0a 32px)',
          zIndex: 20,
        }}
      >
        {/* Two-row layout: textarea on top, toolbar on bottom */}
        <div
          className="mkr-input-box-liquid"
          style={{
            background: 'linear-gradient(145deg, rgba(24,24,30,0.72), rgba(8,8,12,0.58))',
            borderRadius: '20px',
            border: '0.5px solid rgba(255,255,255,0.11)',
            boxShadow: '0 18px 48px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.09)',
            backdropFilter: 'blur(20px) saturate(1.35)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.35)',
          }}
        >
          {/* Row 1: Textarea */}
          <textarea
            ref={inputRef}
            data-testid="chat-input"
            aria-label="Chat with agent"
            value={input}
            rows={1}
            onFocus={keepInputAboveKeyboard}
            onClick={keepInputAboveKeyboard}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.code === 'Enter') && e.altKey) {
                e.preventDefault();
                const ta = e.currentTarget;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const val = ta.value;
                setInput(val.substring(0, start) + '\n' + val.substring(end));
                requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 1; });
                return;
              }
              const isMobile = 'ontouchstart' in window;
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isMobile) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={t('chat.placeholder')}
            className={`w-full bg-transparent outline-none border-none leading-relaxed disabled:opacity-40 resize-none overflow-y-auto block ${isPanel ? 'text-[17px]' : 'text-[21px]'}`}
            style={{ color: 'rgba(255,255,255,0.88)', caretColor: '#d946ef', maxHeight: '8rem', padding: isPanel ? '10px 14px 4px' : '12px 16px 6px' }}
          />

          {/* Row 2: Toolbar — 📷 | thumbnails | flex-1 spacer | ↑ */}
          <div className="flex items-center gap-2 px-3 pb-2.5">
            {/* Image attach button */}
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={isAgentActive || attachments.length >= 10}
              className="mkr-liquid-icon-button w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all active:scale-90"
              style={{
                background: attachments.length > 0 ? 'linear-gradient(145deg, rgba(192,38,211,0.24), rgba(10,10,14,0.38))' : 'linear-gradient(145deg, rgba(255,255,255,0.08), rgba(10,10,14,0.34))',
                color: attachments.length > 0 ? 'rgba(217,70,239,0.9)' : 'rgba(255,255,255,0.35)',
                border: '0.5px solid rgba(255,255,255,0.10)',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>

            {/* Model selector */}
            {onModelChange && (
              <ModelSelector
                preferredModel={preferredModel}
                onModelChange={onModelChange}
                videoAuto={videoAuto}
                onVideoAutoChange={onVideoAutoChange}
                videoModel={videoModel}
                onVideoModelChange={onVideoModelChange}
                videoResolution={videoResolution}
                onVideoResolutionChange={onVideoResolutionChange}
                agentModel={agentModel}
                onAgentModelChange={onAgentModelChange}
                onOpenChange={setModelSelectorOpen}
              />
            )}

            {/* Unified attachments — scrollable thumbnails */}
            {attachments.length > 0 && (
              <div className="hide-scrollbar" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, overflowX: 'auto', padding: '6px 6px 2px 0' }}>
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="relative flex-shrink-0"
                    data-testid={att.type === 'image' ? 'chat-attachment-image' : 'chat-attachment-video'}
                    data-attachment-status={att.status}
                  >
                    {att.thumbnail ? (

                      <img src={att.thumbnail} alt="" className="w-9 h-9 rounded-lg object-cover" style={{ border: '1px solid rgba(255,255,255,0.12)' }} />
                    ) : (
                      <div className="w-9 h-9 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }} />
                    )}
                    {/* Video play icon */}
                    {att.type === 'video' && att.status === 'ready' && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <svg width="14" height="14" viewBox="0 0 8 8" fill="rgba(255,255,255,0.85)"><polygon points="2,1 7,4 2,7" /></svg>
                      </div>
                    )}
                    {/* Processing spinner */}
                    {att.status === 'processing' && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg" style={{ background: 'rgba(0,0,0,0.4)' }}>
                        <div className="w-4 h-4 border-2 border-fuchsia-400/40 border-t-fuchsia-400 rounded-full animate-spin" />
                      </div>
                    )}
                    {/* Remove button */}
                    <button
                      onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                      aria-label="Remove attachment"
                      className="w-3.5 h-3.5 rounded-full flex items-center justify-center"
                      style={{ position: 'absolute', top: -4, right: -4, zIndex: 2, background: 'rgba(20,20,24,0.88)', border: '0.5px solid rgba(255,255,255,0.22)', boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}
                    >
                      <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="3.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Spacer (only when no thumbnails taking flex space) */}
            {attachments.length === 0 && <div className="flex-1" />}

            {/* Skill selector — right side, before send */}
            {skills && skills.length > 0 && onSkillChange && (
              <SkillSelector
                skills={skills}
                selectedSkill={selectedSkill ?? null}
                onSkillChange={onSkillChange}
                onDeleteSkill={onDeleteSkill}
                onUploadSkill={onUploadSkill}
                installing={installingSkill}
                onOpenChange={(isOpen) => setSkillSelectorOpen(isOpen)}
              />
            )}

            {/* Send / Stop button */}
            {isAgentActive && onAbort ? (
              <button
                data-testid="chat-stop"
                aria-label="Stop agent"
                onClick={onAbort}
                className="mkr-liquid-icon-button w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all active:scale-90 cursor-pointer"
                style={{ background: 'linear-gradient(145deg, rgba(239,68,68,0.22), rgba(10,10,14,0.36))', color: '#ef4444', border: '0.5px solid rgba(239,68,68,0.26)' }}
>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <rect x="1" y="1" width="10" height="10" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                data-testid="chat-send"
                aria-label="Send message"
                onClick={handleSubmit}
                disabled={!allReady && attachments.length > 0 ? true : (!input.trim() && attachments.length === 0)}
                className="mkr-liquid-icon-button w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all active:scale-90"
                style={{
                  background: (input.trim() || (attachments.length > 0 && allReady)) ? 'linear-gradient(145deg, rgba(192,38,211,0.92), rgba(145,18,178,0.74))' : 'linear-gradient(145deg, rgba(255,255,255,0.08), rgba(10,10,14,0.34))',
                  color: (input.trim() || (attachments.length > 0 && allReady)) ? '#fff' : 'rgba(255,255,255,0.25)',
                  border: (input.trim() || (attachments.length > 0 && allReady)) ? '0.5px solid rgba(232,121,249,0.40)' : '0.5px solid rgba(255,255,255,0.10)',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>}
      {inlineImagePreview && (() => {
        const previewUrl = inlineImagePreview.src.startsWith('http')
          ? getThumbnailUrl(inlineImagePreview.src, 400, 90, 400, 'cover')
          : inlineImagePreview.src;
        const imgLoaded = inlineImagePreviewLoadedUrl === previewUrl;
        return (
          <span
            ref={inlineImagePreviewRef}
            data-testid="cui-inline-image-preview"
            className="rounded-xl overflow-hidden shadow-2xl border border-white/10 bg-black"
            style={{
              ...inlineImagePreview.style,
              display: 'block',
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
              userSelect: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {!imgLoaded && (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', inset: 0, background: '#111' }}>
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {inlineImagePreview.snapIdx !== null && (
                    <span className="text-white/30 text-xs">@{inlineImagePreview.snapIdx}</span>
                  )}
                  <span className="animate-spin" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.5)', borderRadius: '50%' }} />
                </span>
              </span>
            )}
            { }
            <img
              src={previewUrl}
              alt=""
              draggable={false}
              onLoad={() => setInlineImagePreviewLoadedUrl(previewUrl)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
            />
            {imgLoaded && inlineImagePreview.snapIdx !== null && (
              <span
                className="bg-black/60 backdrop-blur text-white text-sm font-medium px-1.5 py-0.5 rounded-md"
                style={{ position: 'absolute', bottom: 8, left: 8 }}
              >
                @{inlineImagePreview.snapIdx}
              </span>
            )}
          </span>
        );
      })()}
    </div>
    {viewingFile && <FileViewer path={viewingFile} onClose={() => setViewingFile(null)} />}
    </>
  );
}
