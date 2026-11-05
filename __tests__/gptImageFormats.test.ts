import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { preserveGptImageOutput, validateGeneratedSvg } from '@/lib/models/gpt-image-output';
import { buildFalImage25Request } from '@/lib/models/fal-image25';
import { planImageGeneration, normalizeImageModelId } from '@/lib/image-model-capabilities';
import { normalizeImageFilename, getOptimizedUrl, getThumbnailUrl } from '@/lib/supabase/storage';
const model = 'gpt-image-2.6-flare' as const;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="832" height="832" viewBox="0 0 832 832"><path d="M0 0H832V832H0Z" fill="#932acd"/></svg>';
describe('Original GPT Image formats and successor migration', () => {
  it('migrates legacy new requests without removing historical model identity', () => {
    expect(normalizeImageModelId('gpt-image-2.5-flare')).toBe(model);
    expect(normalizeImageModelId('gpt-image-2.5-sunburst')).toBe('gpt-image-2.6-sunburst');
  });
  it('keeps quality and reasoning independent; rejects unsupported live tiers and format substitutions', () => {
    expect(buildFalImage25Request({ prompt: 'logo', imageQuality: 'high', imageReasoningEffort: 'low' }, model).body).toMatchObject({ quality: 'high', reasoning_effort: 'low' });
    expect(() => planImageGeneration({ prompt: 'logo', outputFormat: 'svg', image: 'https://example.com/a.png' })).toThrow('text-to-image only');
    expect(() => planImageGeneration({ prompt: 'logo', outputFormat: 'gif', model: 'gemini' })).toThrow('require GPT Image 2.6');
    expect(() => planImageGeneration({ prompt: 'logo', imageReasoningEffort: 'max' as never })).toThrow('unsupported imageReasoningEffort');
    expect(() => planImageGeneration({ prompt: 'logo', outputFormat: 'gif', frameDurationMs: 25 })).toThrow('steps of 10');
  });
  it('budgets every GIF frame before submission instead of requesting square 1K x 9', () => {
    const body = buildFalImage25Request({ prompt: 'pulse', outputFormat: 'gif' }, model).body;
    expect(body).toMatchObject({ output_format: 'gif', frame_count: 9, frame_duration_ms: 200, image_size: { width: 960, height: 960 } });
    expect(buildFalImage25Request({ prompt: 'pulse', outputFormat: 'gif', imageResolution: '1K' }, model).body.image_size).toEqual({ width: 960, height: 960 });
  });
  it('returns actual SVG paths and MIME, no raster replacement', async () => {
    const out = await preserveGptImageOutput(Buffer.from(svg), 'svg');
    expect(out).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(out.split(',')[1], 'base64').toString()).toContain('<path');
  });
  it.each([
    svg.replace('<path', '<script>alert(1)</script><path'),
    svg.replace('<path', '<foreignObject/><path'),
    svg.replace('fill="#932acd"', 'fill="url(https://example.com/a.svg)"'),
    svg.replace('<path', '<use href="https://example.com/a.svg"/><path'),
    svg.replace('<path', '<image href="data:image/png;base64,AAAA"/><path'),
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+svg,
    svg.replace('fill="#932acd"', 'onload="alert(1)"'),
  ])('rejects active or external SVG content', input => expect(() => validateGeneratedSvg(Buffer.from(input))).toThrow());
  it('does not flatten GIF animation', async () => {
    const raw = Buffer.alloc(16 * 32 * 4, 255);raw.fill(0, 0, 16 * 16 * 4);
    const gif = await sharp(raw, { raw: { width: 16, height: 32, channels: 4, pageHeight: 16 } }).gif({ delay: [100, 200], loop: 0 }).toBuffer();
    const output = await preserveGptImageOutput(gif, 'gif');
    expect(Buffer.from(output.split(',')[1], 'base64')).toEqual(gif);
    expect(await sharp(gif, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [100, 200] });
  });
  it.each([['gif','image/gif'],['svg','image/svg+xml']])('preserves %s in storage and display URLs', (ext,mime) => {
    expect(normalizeImageFilename('snapshot.jpg',mime)).toBe(`snapshot.${ext}`);
    const url=`https://example.supabase.co/storage/v1/object/public/images/test.${ext}`;
    expect(getOptimizedUrl(url)).toBe(url);expect(getThumbnailUrl(url)).toBe(url);
  });
});
