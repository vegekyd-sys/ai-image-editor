'use client';

import { useState, useRef, useEffect } from 'react';
import { renderStillOnWeb } from '@remotion/web-renderer';
import { Player } from '@remotion/player';
import Moveable from 'react-moveable';
import { evalRemotionJSX } from '@/lib/evalRemotionJSX';

// Design code with a data-editable element — same pattern as Agent-generated designs
const DESIGN_CODE = `
function TestDesign(props) {
  return React.createElement(AbsoluteFill, { style: { background: '#1a1a2e' } },
    React.createElement("div", {
      "data-editable": "box",
      style: {
        position: "absolute", top: 80, left: 80,
        fontSize: 48, fontWeight: 900, color: "#fff",
        background: "rgba(217,70,239,0.5)", padding: "16px 32px",
        borderRadius: 12,
      }
    }, props.title || "Drag Me"),
    React.createElement("div", {
      style: { position: "absolute", bottom: 40, left: 80, fontSize: 24, color: "rgba(255,255,255,0.4)" }
    }, "Reference (unmoved)")
  );
}
`;

export default function MoveableTestPage() {
  const [Component, setComponent] = useState<React.ComponentType<Record<string, unknown>> | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [sc, setSc] = useState<{ w: number; h: number } | null>(null);
  const scaleBase = useRef({ w: 1, h: 1 });
  const [exportUrl, setExportUrl] = useState('');
  const [status, setStatus] = useState('Loading...');
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragBase = useRef({ x: 0, y: 0 });

  // Compile design (with HOC)
  useEffect(() => {
    const comp = evalRemotionJSX(DESIGN_CODE);
    if (comp) {
      setComponent(() => comp);
      setStatus('Ready — drag the purple box, then click Export');
    } else {
      setStatus('Failed to compile design');
    }
  }, []);

  // Find editable element after Player renders
  useEffect(() => {
    if (!containerRef.current) return;
    const timer = setInterval(() => {
      const el = containerRef.current?.querySelector('[data-editable="box"]') as HTMLElement;
      if (el) { setTarget(el); clearInterval(timer); }
    }, 200);
    return () => clearInterval(timer);
  }, [Component]);

  const props = {
    title: 'Drag Me',
    ...(pos ? { _pos_box: pos } : {}),
    ...(sc ? { _scale_box: sc } : {}),
  };

  const handleExport = async () => {
    if (!Component) return;
    setStatus('Exporting...');
    try {
      const result = await renderStillOnWeb({
        composition: {
          component: Component,
          durationInFrames: 1, fps: 30,
          width: 600, height: 400,
          id: 'test-export',
          calculateMetadata: null,
          defaultProps: { title: '' },
        },
        frame: 0,
        imageFormat: 'png',
        inputProps: props,
      });
      setExportUrl(URL.createObjectURL(result.blob));
      setStatus('Exported! Compare preview vs export image below.');
    } catch (e) {
      setStatus('Error: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div style={{ background: '#111', minHeight: '100dvh', padding: 20, color: '#fff', fontFamily: 'monospace' }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>useLayoutEffect + translate/scale Demo</h2>
      <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>{status}</p>
      <p style={{ fontSize: 11, color: '#666', marginBottom: 12 }}>
        pos: {pos ? `(${Math.round(pos.x)}, ${Math.round(pos.y)})` : 'none'}
        {' | '}scale: {sc ? `${sc.w.toFixed(2)}x${sc.h.toFixed(2)}` : 'none'}
      </p>

      {/* Preview */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: '#aaa', marginBottom: 4 }}>Preview (Player):</div>
        <div ref={containerRef} style={{ width: 600, height: 400, position: 'relative', border: '1px solid #333', borderRadius: 8, overflow: 'hidden' }}>
          {Component && (
            <Player
              component={Component}
              inputProps={props}
              compositionWidth={600}
              compositionHeight={400}
              durationInFrames={1}
              fps={30}
              style={{ width: '100%', height: '100%' }}
              controls={false}
              acknowledgeRemotionLicense
            />
          )}
        </div>
      </div>

      {/* Moveable */}
      {target && (
        <Moveable
          target={target}
          draggable={true}
          scalable={true}
          keepRatio={true}
          renderDirections={['nw', 'ne', 'sw', 'se']}
          origin={false}
          onDragStart={({ set }) => {
            dragBase.current = pos || { x: 0, y: 0 };
            set([0, 0]);
          }}
          onDrag={({ target: t, beforeTranslate }) => {
            const x = dragBase.current.x + beforeTranslate[0];
            const y = dragBase.current.y + beforeTranslate[1];
            t.style.translate = `${x}px ${y}px`;
          }}
          onDragEnd={({ lastEvent }) => {
            if (lastEvent) {
              setPos({
                x: dragBase.current.x + lastEvent.beforeTranslate[0],
                y: dragBase.current.y + lastEvent.beforeTranslate[1],
              });
            }
          }}
          onScaleStart={({ set }) => {
            scaleBase.current = sc || { w: 1, h: 1 };
            set([1, 1]);
          }}
          onScale={({ target: t, scale: s }) => {
            t.style.scale = `${scaleBase.current.w * s[0]} ${scaleBase.current.h * s[1]}`;
          }}
          onScaleEnd={({ lastEvent }) => {
            if (lastEvent) {
              setSc({
                w: scaleBase.current.w * lastEvent.scale[0],
                h: scaleBase.current.h * lastEvent.scale[1],
              });
            }
          }}
        />
      )}

      <button onClick={handleExport} style={{ padding: '8px 20px', background: '#d946ef', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', marginBottom: 16 }}>
        Export
      </button>

      {/* Export result */}
      {exportUrl && (
        <div>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 4 }}>Export result:</div>
          <img src={exportUrl} style={{ width: 600, border: '1px solid #333', borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
