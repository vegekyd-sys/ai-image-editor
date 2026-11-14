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
    expect(design.code).toContain('\"family\":\"Lato\"');
    expect(design.code).toContain('\"weight\":900');
    expect(design.editables?.find(x => x.id === 'layer_1_text_0')?.type).toBe('text');
    const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {};
    const runtime = createEditableReactRuntime(React, 'video');
    new Function('require', 'exports', transform(design.code, { transforms: ['jsx', 'imports'] }).code)(
      (name: string) => name === 'react' ? runtime.React : { AbsoluteFill: 'div', Img: 'img' }, exports);
    const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(runtime.wrap(exports.default, 'proxy'), props));
    const original = render(design.props!);
    expect(original).toContain('glyphs.png'); expect(original).not.toContain('<text');
    const edited = render({ ...design.props, layer_1_text_0: 'WORLD', _pos_layer_0: { x: 12, y: 24 } });
    expect(edited).toContain('<text'); expect(edited).toContain('WORLD'); expect(edited).toContain('font-family:&quot;Lato&quot;');
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

it('keeps CJK glyph geometry and quoted CSS families stable for same/short/long/mixed text and restoration', () => {
  const manifest: LayerizeManifest = { version: 1, taskId: 'cjk', width: 800, height: 600, sourceSha256: 'test', supplierCostUsd: .1,
    layers: [{ z: 0, name: 'Base', url: 'base.png', width: 800, height: 600, bounds: [0, 0, 800, 600] },
      { z: 1, name: 'CJK', url: 'text.png', width: 400, height: 100, bounds: [50, 60, 450, 160], text: { lines: [{
        text: '甲乙丙丁', font: 'MiSans', color: '#112233', bold: false, italic: false, bounds: [50, 60, 450, 160],
        appearance: { rasterUrl: 'glyphs.png', width: 400, height: 100, bounds: [50, 60, 450, 160], fit: { family: 'Noto Sans SC', weight: 400,
          fontSize: 1000, matrix: [.1, 0, 0, .1, 0, 90], color: '#112233', score: .8, advances: { 甲: 1000, 乙: 1000, 丙: 1000, 丁: 1000, '1': 555 } } },
      }] } }] };
  const design = buildLayerizeDesign(manifest, true), exports: any = {}, runtime = createEditableReactRuntime(React, 'video');
  new Function('require', 'exports', transform(design.code, { transforms: ['jsx', 'imports'] }).code)(
    (name: string) => name === 'react' ? runtime.React : { AbsoluteFill: 'div', Img: 'img' }, exports);
  const props = { ...design.props, _pos_layer_1_text_0: { x: 12, y: 13 }, _scale_layer_1_text_0: { w: .7, h: .7 }, _layerState: { order: ['layer_1_text_0', 'layer_0'], deleted: [] } };
  const render = (value: string) => renderToStaticMarkup(React.createElement(runtime.wrap(exports.default, 'proxy'), { ...props, layer_1_text_0: value }));
  for (const text of ['乙甲丙丁', '111', '甲乙 Makaron 1', '甲乙丙丁甲乙丙丁甲乙']) {
    const markup = render(text); expect(markup).toContain('matrix(0.1 0 0 0.1 0 90)');
    expect(markup).toContain('font-family:&quot;Noto Sans SC&quot;');
    expect(markup).toContain('&quot;Noto Sans Symbols 2&quot;');
    expect(markup).toContain('translate:12px 13px'); expect(markup).toContain('scale:0.7');
    expect(markup).not.toContain('glyphs.png');
  }
  expect(render('甲乙\n丙丁')).toContain('<tspan x="0" y="0">甲乙</tspan>');
  expect(render('甲乙\n丙丁')).toContain('<tspan x="0" y="1400">丙丁</tspan>');
  expect((render('甲乙丙丁甲乙丙丁甲乙').match(/<tspan/g) || []).length).toBe(3);
  expect(render('甲乙丙丁')).toContain('glyphs.png'); expect(render('甲乙丙丁')).not.toContain('<text');
  expect(design.props?.layer_1_text_0).toBe('甲乙丙丁');
});
