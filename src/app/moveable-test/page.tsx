'use client';

import { useState } from 'react';
import { renderStillOnWeb } from '@remotion/web-renderer';
import { AbsoluteFill } from 'remotion';

// Simple component: one box with style.translate + style.scale, one without (reference)
function TestDesign({ text, bgColor }: { text: string; bgColor: string }) {
  return (
    <AbsoluteFill style={{ background: bgColor }}>
      <div style={{
        position: 'absolute', top: 100, left: 100,
        fontSize: 48, fontWeight: 900, color: '#fff',
        background: 'rgba(217,70,239,0.5)', padding: '12px 24px',
        borderRadius: 12,
        // CSS independent properties — patch should make web-renderer read these
        translate: '150px 80px',
        scale: '1.5 1.5',
      }}>
        {text}
      </div>
      <div style={{
        position: 'absolute', top: 400, left: 100,
        fontSize: 32, color: '#fff',
      }}>
        Reference (no translate/scale)
      </div>
    </AbsoluteFill>
  );
}

export default function MoveableTestPage() {
  const [result, setResult] = useState<string>('');
  const [status, setStatus] = useState('Click Export Test to verify patch');

  const runTest = async () => {
    setStatus('Exporting...');
    try {
      const res = await renderStillOnWeb({
        composition: {
          component: TestDesign,
          durationInFrames: 1, fps: 30,
          width: 800, height: 600,
          id: 'translate-test',
          calculateMetadata: null, defaultProps: { text: '', bgColor: '#000' },
        },
        frame: 0,
        imageFormat: 'png',
        inputProps: { text: 'Translated+Scaled', bgColor: '#1a1a2e' },
      });
      const url = URL.createObjectURL(res.blob);
      setResult(url);
      setStatus('Done! Purple box should be offset right+down and 1.5x bigger.');
    } catch (e) {
      setStatus('Error: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div style={{ background: '#111', minHeight: '100dvh', padding: 20, color: '#fff', fontFamily: 'monospace' }}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>style.translate + scale Export Test</h2>
      <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
        Verifies @remotion/web-renderer patch reads CSS translate/scale.
      </p>
      <button onClick={runTest} style={{ padding: '8px 20px', background: '#d946ef', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', marginBottom: 16 }}>
        Export Test
      </button>
      <div style={{ fontSize: 13, color: '#aaa', marginBottom: 16 }}>{status}</div>
      {result && (
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Exported:</h3>
          <img src={result} style={{ maxWidth: '100%', border: '1px solid #333', borderRadius: 8 }} />
          <p style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
            If purple box at top-left corner (100,100) with normal size = patch NOT working.
            If offset right+down and bigger = patch WORKS.
          </p>
        </div>
      )}
    </div>
  );
}
