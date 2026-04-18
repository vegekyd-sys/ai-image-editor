'use client';

import { useRef, useState, useEffect } from 'react';
import Moveable from 'react-moveable';

export default function MoveableTestPage() {
  const targetRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [info, setInfo] = useState('Tap box, then pinch');

  useEffect(() => { setTarget(targetRef.current); }, []);

  return (
    <div style={{ background: '#111', minHeight: '100dvh', padding: 20, touchAction: 'none' }}>
      <div style={{ color: '#888', fontFamily: 'monospace', fontSize: 13, marginBottom: 12 }}>{info}</div>

      <div style={{ position: 'relative', width: 300, height: 400, background: '#222', margin: '0 auto' }}>
        <div
          ref={targetRef}
          style={{
            position: 'absolute', top: 100, left: 50, width: 200, height: 200,
            background: 'rgba(217,70,239,0.3)', border: '3px solid #d946ef',
            borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 24, fontWeight: 900,
          }}
        >
          Pinch Me
        </div>
      </div>

      {target && (
        <Moveable
          target={target}
          draggable={true}
          scalable={true}
          pinchable={true}
          keepRatio={true}
          renderDirections={['nw', 'ne', 'sw', 'se']}
          origin={false}
          onDragStart={({ set }) => { set([0, 0]); setInfo('DRAG START'); }}
          onDrag={({ target, beforeTranslate }) => {
            target.style.transform = `translate(${beforeTranslate[0]}px, ${beforeTranslate[1]}px)`;
          }}
          onDragEnd={() => setInfo('DRAG END')}
          onScaleStart={({ isPinch, set, dragStart }) => {
            set([1, 1]);
            if (dragStart) dragStart.set([0, 0]);
            setInfo(`SCALE START pinch=${isPinch}`);
          }}
          onScale={({ target, scale, drag, isPinch }) => {
            target.style.transform = `translate(${drag.beforeTranslate[0]}px, ${drag.beforeTranslate[1]}px) scale(${scale[0]}, ${scale[1]})`;
            setInfo(`SCALE ${scale[0].toFixed(2)} pinch=${isPinch}`);
          }}
          onScaleEnd={({ isPinch }) => setInfo(`SCALE END pinch=${isPinch}`)}
          onPinchStart={() => setInfo('PINCH START')}
          onPinchEnd={() => setInfo('PINCH END')}
        />
      )}
    </div>
  );
}
