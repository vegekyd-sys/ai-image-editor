'use client';

import { useRef, useState, useEffect } from 'react';
import Moveable from 'react-moveable';

export default function MoveableTestPage() {
  const targetRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [info, setInfo] = useState('Ready — try drag, scale handle, and pinch');

  const isDraggingRef = useRef(false);

  useEffect(() => { setTarget(targetRef.current); }, []);

  // Compute zoom ratio (screen-px / design-px)
  const scale = 400 / 1080;

  return (
    <div className="select-none" style={{ background: '#1a1a1a', minHeight: '100vh', padding: 40 }}>
      <div style={{ color: '#888', fontFamily: 'monospace', fontSize: 14, marginBottom: 20 }}>{info}</div>

      <div
        ref={rootRef}
        style={{
          position: 'relative', width: 400, height: 500, background: '#111',
          overflow: 'hidden', margin: '0 auto',
        }}
      >
        <div style={{
          width: 1080, height: 1350, transformOrigin: 'top left',
          transform: `scale(${scale})`,
        }}>
          <div
            ref={targetRef}
            data-editable="title"
            style={{
              position: 'absolute', bottom: '12%', left: '10%', right: '10%',
              padding: '16px 24px',
              background: 'rgba(0,0,0,0.5)',
              color: 'white', fontSize: 72, fontWeight: 900,
              fontFamily: 'sans-serif', textAlign: 'center',
              cursor: 'pointer', pointerEvents: 'auto',
            }}
          >
            Scale me
          </div>
        </div>
      </div>

      {target && (
        <Moveable
          target={target}
          rootContainer={rootRef.current ?? undefined}
          draggable={true}
          scalable={true}
          pinchable={true}
          keepRatio={true}
          renderDirections={['se']}
          rotatable={false}
          origin={false}
          throttleDrag={0}
          throttleScale={0}
          zoom={scale}
          hideDefaultLines={false}
          edge={false}
          padding={{ left: 0, top: 0, right: 0, bottom: 0 }}
          onDragStart={({ set }) => {
            isDraggingRef.current = true;
            set([0, 0]);
            setInfo('🔵 DRAG START');
          }}
          onDrag={({ target, beforeTranslate }) => {
            target.style.translate = `${beforeTranslate[0]}px ${beforeTranslate[1]}px`;
            setInfo(`🔵 DRAG: tx=${Math.round(beforeTranslate[0])} ty=${Math.round(beforeTranslate[1])}`);
          }}
          onDragEnd={() => { isDraggingRef.current = false; }}
          onScaleStart={() => {
            isDraggingRef.current = true;
            setInfo('🟣 SCALE START');
          }}
          onScale={({ target, transform }) => {
            target.style.transform = transform;
            setInfo(`🟣 SCALE: ${transform}`);
          }}
          onScaleEnd={() => { isDraggingRef.current = false; }}
        />
      )}
    </div>
  );
}
