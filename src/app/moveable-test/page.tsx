'use client';

import { useRef, useState, useEffect } from 'react';
import Moveable from 'react-moveable';

export default function MoveableTestPage() {
  const targetRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [info, setInfo] = useState('Drag the scaled box');
  const [compensate, setCompensate] = useState(false);

  const moveableRef = useRef<Moveable>(null);
  const [currentScale, setCurrentScale] = useState(1.5);
  const baseOffsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(currentScale);
  scaleRef.current = currentScale;

  // Update Moveable frame when scale changes
  useEffect(() => {
    requestAnimationFrame(() => moveableRef.current?.updateRect());
  }, [currentScale]);
  const compensateRef = useRef(compensate);
  compensateRef.current = compensate;

  useEffect(() => { setTarget(targetRef.current); }, []);

  return (
    <div style={{ background: '#111', minHeight: '100dvh', padding: 20, touchAction: 'none' }}>
      <div style={{ color: '#888', fontFamily: 'monospace', fontSize: 13, marginBottom: 8 }}>{info}</div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 8 }}>
        {[1, 1.5, 2, 3].map(s => (
          <button key={s} onClick={() => { setCurrentScale(s); baseOffsetRef.current = { x: 0, y: 0 }; if (targetRef.current) targetRef.current.style.translate = ''; }}
            style={{ padding: '4px 12px', background: currentScale === s ? '#d946ef' : '#333', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13 }}>
            {s}x
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 12 }}>
        <button onClick={() => setCompensate(c => !c)}
          style={{ padding: '4px 16px', background: compensate ? '#22c55e' : '#555', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13 }}>
          {compensate ? '✓ Compensate ON' : '✗ Compensate OFF'}
        </button>
      </div>

      <div style={{ position: 'relative', width: 300, height: 350, background: '#222', margin: '0 auto' }}>
        <div
          ref={targetRef}
          style={{
            position: 'absolute', top: 80, left: 40, width: 180, height: 100,
            background: 'rgba(217,70,239,0.3)', border: '3px solid #d946ef',
            borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 20, fontWeight: 900,
            scale: `${currentScale} ${currentScale}`,
          }}
        >
          Drag Me
        </div>
      </div>

      {target && (
        <Moveable
          ref={moveableRef}
          target={target}
          draggable={true}
          scalable={false}
          pinchable={false}
          origin={false}
          onDragStart={({ set }) => {
            set([0, 0]);
          }}
          onDrag={({ target, beforeTranslate }) => {
            const s = scaleRef.current;
            const comp = compensateRef.current;
            const bx = baseOffsetRef.current.x;
            const by = baseOffsetRef.current.y;
            // With compensation: multiply by scale
            const mx = comp ? beforeTranslate[0] * s : beforeTranslate[0];
            const my = comp ? beforeTranslate[1] * s : beforeTranslate[1];
            target.style.translate = `${bx + mx}px ${by + my}px`;
            setInfo(`s=${s} comp=${comp} raw=${beforeTranslate[0].toFixed(0)},${beforeTranslate[1].toFixed(0)} applied=${mx.toFixed(0)},${my.toFixed(0)}`);
          }}
          onDragEnd={({ lastEvent }) => {
            if (lastEvent) {
              const s = scaleRef.current;
              const comp = compensateRef.current;
              const mx = comp ? lastEvent.beforeTranslate[0] * s : lastEvent.beforeTranslate[0];
              const my = comp ? lastEvent.beforeTranslate[1] * s : lastEvent.beforeTranslate[1];
              baseOffsetRef.current = {
                x: baseOffsetRef.current.x + mx,
                y: baseOffsetRef.current.y + my,
              };
            }
          }}
        />
      )}
    </div>
  );
}
