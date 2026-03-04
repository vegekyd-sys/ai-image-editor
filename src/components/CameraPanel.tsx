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

const CameraControl3D = dynamic(() => import('./CameraControl3D'), { ssr: false });

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
        maxWidth: 380,
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
        {/* 3D Preview */}
        <CameraControl3D
          imageUrl={imageUrl}
          camera={camera}
          onCameraChange={setCamera}
          height={isDesktop ? 200 : 180}
        />

        <div className="px-3 pt-3 pb-3 space-y-3">
          {/* Azimuth */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-white/50 uppercase tracking-wider">Azimuth</span>
              <span className="text-[11px] text-white/70">{azName}</span>
            </div>
            {/* 8 direction buttons */}
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
              type="range"
              min={0}
              max={360}
              step={1}
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
              type="range"
              min={-30}
              max={60}
              step={1}
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
              type="range"
              min={0.6}
              max={1.4}
              step={0.01}
              value={camera.distance}
              onChange={e => setCamera(c => ({ ...c, distance: +e.target.value }))}
              className="w-full h-1 appearance-none bg-white/10 rounded-full accent-orange-500"
            />
          </div>

          {/* Prompt preview */}
          <div className="text-[10px] text-white/30 font-mono truncate">{prompt}</div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 h-9 rounded-xl text-[13px] font-medium cursor-pointer bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onGenerate(camera, prompt)}
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
  );
}
