import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'sucrase';
import { describe, expect, it } from 'vitest';
import { buildLayerizeDesign, type LayerizeManifest } from '@/lib/layerize-design';
import { createEditableReactRuntime } from '@/lib/editor/editable-react-runtime';
import { validateDesign } from '@/lib/design-harness';
import { textInkAngle } from '@/lib/layerize-text-fit';

describe('font-fitted editable text', () => {
  it('preserves original glyph pixels until edited, then renders actual text without moving other layers', () => {
    const manifest: LayerizeManifest = { version: 1, taskId: 'text-fit', width: 800, height: 500, sourceSha256: 'test', supplierCostUsd: .1,
      layers: [{ z: 0, name: 'Background', url: 'https://example.test/bg.png', width: 800, height: 500, bounds: [0, 0, 800, 500] },
        { z: 1, name: 'Title', url: 'https://example.test/text.png', width: 400, height: 120, bounds: [20, 30, 420, 150],
          text: { lines: [{ text: 'HELLO', bounds: [20, 30, 420, 150], font: 'Wrong OCR Font', color: '#fff', bold: true, italic: true,
            appearance: { rasterUrl: 'https://example.test/glyphs.png', width: 390, height: 100, bounds: [25, 40, 415, 140],
              fit: { family: 'Lato', weight: 900, fontSize: 2000, color: '#ffffff', score: .9, matrix: [.1, 0, 0, .1, 0, 100] } } }] } }] };
    const design = buildLayerizeDesign(manifest, true);
    expect(validateDesign(design)).toBeNull();
    // r8 Preview/export font scanners consume literal style keys and weights.
    expect(design.code).toMatch(/fontFamily:\s*["']Lato/);
    expect(design.code).toMatch(/fontWeight:\s*900/);
    expect(design.editables?.find(x => x.id === 'layer_1_text_0')?.type).toBe('text');
    const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {};
    const runtime = createEditableReactRuntime(React, 'video');
    new Function('require', 'exports', transform(design.code, { transforms: ['jsx', 'imports'] }).code)(
      (name: string) => name === 'react' ? runtime.React : { AbsoluteFill: 'div', Img: 'img' }, exports);
    const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(runtime.wrap(exports.default, 'proxy'), props));
    const original = render(design.props!);
    expect(original).toContain('glyphs.png'); expect(original).not.toContain('<text');
    const edited = render({ ...design.props, layer_1_text_0: 'WORLD', _pos_layer_0: { x: 12, y: 24 } });
    expect(edited).toContain('<text'); expect(edited).toContain('WORLD'); expect(edited).toContain('font-family:Lato');
    expect(edited).not.toContain('glyphs.png'); expect(edited).toContain('bg.png');
    expect(edited).toContain('translate:12px 24px');
    expect(render(design.props!)).toContain('glyphs.png');
  });

  it('estimates the actual angle of a long word rather than applying an OCR italic flag', () => {
    const width = 120, height = 70, alpha = new Uint8Array(width * height);
    for (let x = 10; x < 110; x++) for (let d = -3; d <= 3; d++) alpha[(Math.round(15 + x * .35) + d) * width + x] = 255;
    expect(textInkAngle(alpha, width, height)).toBeGreaterThan(17);
    expect(textInkAngle(alpha, width, height)).toBeLessThan(22);
  });
});
