'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  AZIMUTH_MAP,
  ELEVATION_MAP,
  DISTANCE_MAP,
  AZIMUTH_ARROWS,
  AZIMUTH_STEPS,
  ELEVATION_STEPS,
  DISTANCE_STEPS,
  snapToNearest,
  buildCameraPrompt,
  DEFAULT_CAMERA_STATE,
  type CameraState,
} from '@/lib/camera-utils';

const CameraControl3D = dynamic(() => import('./CameraControl3D'), {
  ssr: false,
  loading: () => <CameraLoadingSkeleton />,
});

function CameraLoadingSkeleton() {
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: '#0a0a0a', borderRadius: 12, minHeight: 180 }}>
      <div className="flex flex-col items-center gap-3">
        {/* Animated camera icon */}
        <div className="relative">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-fuchsia-500/40 animate-pulse">
            <path d="M15 16H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="11.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {/* Orbiting dot */}
          <div className="absolute inset-0 animate-spin" style={{ animationDuration: '2s' }}>
            <div className="w-2 h-2 rounded-full bg-fuchsia-500/60 absolute -top-1 left-1/2 -translate-x-1/2" />
          </div>
        </div>
        <span className="text-[11px] text-white/30">Loading 3D scene...</span>
        {/* Grid skeleton lines */}
        <div className="flex gap-3 opacity-20">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="w-px h-8 bg-white/20 animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

const DRAG_THRESHOLD = 3;
const NO_DRAG_TAGS = new Set(['BUTTON', 'INPUT', 'A', 'SELECT', 'CANVAS']);

const PANEL_STYLE = {
  background: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
};

interface CameraPanelProps {
  imageUrl: string;
  isDesktop: boolean;
  isGenerating: boolean;
  onGenerate: (camera: CameraState, prompt: string) => void;
  onCancel: () => void;
}

/* ─── Controls section (shared between desktop/mobile) ─── */
function ControlsSection({
  camera, setCamera, azName, elName, dsName,
}: {
  camera: CameraState;
  setCamera: React.Dispatch<React.SetStateAction<CameraState>>;
  azName: string; elName: string; dsName: string;
}) {
  return (
    <div className="space-y-3">
      {/* Azimuth */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-white/50 uppercase tracking-wider">Azimuth</span>
          <span className="text-[11px] text-white/70">{azName}</span>
        </div>
        <div className="flex items-center gap-1 mb-1.5">
          {AZIMUTH_ARROWS.map(({ deg, label }) => (
            <button
              key={deg}
              onClick={() => setCamera(c => ({ ...c, azimuth: deg }))}
              className={`flex-1 h-7 rounded text-[13px] cursor-pointer transition-colors ${
                snapToNearest(camera.azimuth, AZIMUTH_STEPS) === deg
                  ? 'bg-fuchsia-500/30 text-white border border-fuchsia-500/50'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 border border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="range" min={0} max={360} step={1}
          value={camera.azimuth}
          onChange={e => setCamera(c => ({ ...c, azimuth: +e.target.value }))}
          className="w-full h-1 appearance-none bg-white/10 rounded-full accent-fuchsia-500"
        />
      </div>

      {/* Elevation */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-white/50 uppercase tracking-wider">Elevation</span>
          <span className="text-[11px] text-white/70">{elName}</span>
        </div>
        <div className="flex items-center gap-1 mb-1.5">
          {ELEVATION_STEPS.map(deg => (
            <button
              key={deg}
              onClick={() => setCamera(c => ({ ...c, elevation: deg }))}
              className={`flex-1 h-7 rounded text-[11px] cursor-pointer transition-colors ${
                snapToNearest(camera.elevation, ELEVATION_STEPS) === deg
                  ? 'bg-fuchsia-500/30 text-white border border-fuchsia-500/50'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 border border-transparent'
              }`}
            >
              {ELEVATION_MAP[deg].replace(' shot', '')}
            </button>
          ))}
        </div>
        <input
          type="range" min={-30} max={60} step={1}
          value={camera.elevation}
          onChange={e => setCamera(c => ({ ...c, elevation: +e.target.value }))}
          className="w-full h-1 appearance-none bg-white/10 rounded-full accent-pink-500"
        />
      </div>

      {/* Distance */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-white/50 uppercase tracking-wider">Distance</span>
          <span className="text-[11px] text-white/70">{dsName}</span>
        </div>
        <div className="flex items-center gap-1 mb-1.5">
          {DISTANCE_STEPS.map(d => (
            <button
              key={d}
              onClick={() => setCamera(c => ({ ...c, distance: d }))}
              className={`flex-1 h-7 rounded text-[11px] cursor-pointer transition-colors ${
                snapToNearest(camera.distance, DISTANCE_STEPS) === d
                  ? 'bg-fuchsia-500/30 text-white border border-fuchsia-500/50'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 border border-transparent'
              }`}
            >
              {DISTANCE_MAP[d]}
            </button>
          ))}
        </div>
        <input
          type="range" min={0.6} max={1.4} step={0.01}
          value={camera.distance}
          onChange={e => setCamera(c => ({ ...c, distance: +e.target.value }))}
          className="w-full h-1 appearance-none bg-white/10 rounded-full accent-orange-500"
        />
      </div>
    </div>
  );
}

export default function CameraPanel({
  imageUrl,
  isDesktop,
  isGenerating,
  onGenerate,
  onCancel,
}: CameraPanelProps) {
  const [camera, setCamera] = useState<CameraState>(DEFAULT_CAMERA_STATE);

  // Desktop drag
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; active: boolean } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isDesktop) return;
    let el = e.target as HTMLElement;
    while (el && el !== e.currentTarget) {
      if (NO_DRAG_TAGS.has(el.tagName) || el.getAttribute('role') === 'button') return;
      el = el.parentElement!;
    }
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: dragOffset.x, origY: dragOffset.y, active: false };
  }, [isDesktop, dragOffset]);

  useEffect(() => {
    if (!isDesktop) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.active) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        d.active = true;
        setIsDragging(true);
      }
      setDragOffset({ x: d.origX + dx, y: d.origY + dy });
    };
    const onUp = () => {
      dragRef.current = null;
      if (isDragging) setIsDragging(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDesktop, isDragging]);

  const prompt = buildCameraPrompt(camera.azimuth, camera.elevation, camera.distance);
  const azName = AZIMUTH_MAP[snapToNearest(camera.azimuth, AZIMUTH_STEPS)];
  const elName = ELEVATION_MAP[snapToNearest(camera.elevation, ELEVATION_STEPS)];
  const dsName = DISTANCE_MAP[snapToNearest(camera.distance, DISTANCE_STEPS)];

  return (
    <div
      className="px-3 pb-3 pt-1"
      style={isDesktop ? {
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        cursor: isDragging ? 'grabbing' : undefined,
        maxWidth: 720,
        width: '100%',
      } : undefined}
    >
      {/* × close */}
      <button
        onClick={onCancel}
        className="w-7 h-7 flex items-center justify-center rounded-full cursor-pointer mb-1.5"
        style={{ ...PANEL_STYLE }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div
        className="rounded-2xl overflow-hidden"
        style={{
          ...PANEL_STYLE,
          cursor: isDesktop ? (isDragging ? 'grabbing' : 'grab') : undefined,
        }}
        onMouseDown={handleMouseDown}
      >
        {isDesktop ? (
          /* ── Desktop: left-right layout ── */
          <div className="flex">
            {/* 3D Preview — 60% */}
            <div className="flex-[3] min-w-0">
              <CameraControl3D
                imageUrl={imageUrl}
                camera={camera}
                onCameraChange={setCamera}
                height={400}
              />
            </div>
            {/* Controls + prompt + buttons — 40% */}
            <div className="flex-[2] min-w-0 flex flex-col" style={{ height: 400 }}>
              <div className="flex-1 overflow-y-auto px-3 py-3">
                <ControlsSection camera={camera} setCamera={setCamera} azName={azName} elName={elName} dsName={dsName} />
              </div>
              {/* Prompt + buttons pinned at bottom of right panel */}
              <div className="px-3 pb-3 pt-2 space-y-2 border-t border-white/5">
                <div className="text-[10px] text-white/30 font-mono truncate">{prompt}</div>
                <div className="flex gap-2">
                  <button
                    onClick={onCancel}
                    className="flex-1 h-9 rounded-xl text-[13px] font-medium cursor-pointer bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onGenerate(camera, prompt); }}
                    disabled={isGenerating}
                    className="flex-1 h-9 rounded-xl text-[13px] font-medium cursor-pointer bg-fuchsia-500 text-white hover:bg-fuchsia-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isGenerating ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Generating...
                      </span>
                    ) : 'Generate'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── Mobile: top-bottom layout (unchanged) ── */
          <>
            <CameraControl3D
              imageUrl={imageUrl}
              camera={camera}
              onCameraChange={setCamera}
              height={180}
            />
            <div className="px-3 pt-3 pb-3 space-y-3">
              <ControlsSection camera={camera} setCamera={setCamera} azName={azName} elName={elName} dsName={dsName} />
              <div className="text-[10px] text-white/30 font-mono truncate">{prompt}</div>
              <div className="flex gap-2">
                <button
                  onClick={onCancel}
                  className="flex-1 h-9 rounded-xl text-[13px] font-medium cursor-pointer bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onGenerate(camera, prompt); }}
                  disabled={isGenerating}
                  className="flex-1 h-9 rounded-xl text-[13px] font-medium cursor-pointer bg-fuchsia-500 text-white hover:bg-fuchsia-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isGenerating ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generating...
                    </span>
                  ) : 'Generate'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
