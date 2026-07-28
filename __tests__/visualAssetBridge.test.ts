import { readFileSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { studioArtifactSchemas } from '../src/lib/studio-run/contracts';
import {
  assertCompositionConsumesVisualAssets,
  assertPersistedVisualAssetBridgeEvidence,
  assertVisualAssetBridgeEvidence,
} from '../src/lib/studio-run/visual-asset-evidence';
import { preparedVisualAssetSchema } from '../src/lib/visual-assets/contracts';
import {
  prepareVisualAsset,
  preparedVisualAssetPointerPath,
  resolvePreparedVisualAssetById,
} from '../src/lib/visual-assets/bridge';
import { analyzeEdgeFrameBuffers } from '../src/lib/visual-assets/edge-video';
import { prepareChromaKeyCutout, renderCutoutContactSheet } from '../src/lib/visual-assets/image-cutout';

const workspaceFiles = vi.hoisted(() => new Map<string, { content: string | Buffer; contentType: string; storageUrl: string }>());

vi.mock('../src/lib/workspace', () => ({
  writeFile: vi.fn(async (filePath: string, content: string | Buffer, _supabase: unknown, _userId: string, contentType: string) => {
    const storageUrl = `https://workspace.test/${filePath}`;
    workspaceFiles.set(filePath, { content, contentType, storageUrl });
    return { success: true, path: filePath, storageUrl };
  }),
  readFile: vi.fn(async (filePath: string) => workspaceFiles.get(filePath) || null),
  clearWorkspaceCache: vi.fn(),
}));

const root = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

async function chromaFixture(clipped = false): Promise<Buffer> {
  const x = clipped ? -12 : 96;
  const bodyWidth = clipped ? 330 : 320;
  return sharp(Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" fill="#00ff00"/>
    <g>
      <path d="M256 48 C244 29 248 19 266 14" stroke="#6e35d8" stroke-width="12" stroke-linecap="round" fill="none"/>
      <rect x="${x}" y="72" width="${bodyWidth}" height="366" rx="142" fill="#5024a7" stroke="#26ee31" stroke-width="4"/>
      <ellipse cx="205" cy="190" rx="25" ry="32" fill="#ffffff"/>
      <ellipse cx="307" cy="190" rx="25" ry="32" fill="#ffffff"/>
      <circle cx="211" cy="198" r="10" fill="#17112f"/>
      <circle cx="301" cy="198" r="10" fill="#17112f"/>
      <path d="M205 287 Q256 330 307 287" stroke="#f3d6ff" stroke-width="14" stroke-linecap="round" fill="none"/>
      <rect x="254" y="253" width="4" height="4" fill="#00ee00"/>
      <path d="M122 305 Q68 326 79 376" stroke="#7138dd" stroke-width="18" stroke-linecap="round" fill="none"/>
      <path d="M390 305 Q444 326 433 376" stroke="#7138dd" stroke-width="18" stroke-linecap="round" fill="none"/>
    </g>
  </svg>`)).png().toBuffer();
}

async function enclosedChromaPocketFixture(): Promise<Buffer> {
  return sharp(Buffer.from(`<svg width="320" height="320" xmlns="http://www.w3.org/2000/svg">
    <rect width="320" height="320" fill="#00ff00"/>
    <circle cx="160" cy="160" r="104" fill="#00ff00" stroke="#7138dd" stroke-width="28"/>
    <circle cx="160" cy="56" r="10" fill="#ff4fc8"/>
  </svg>`)).png().toBuffer();
}

async function edgeParticleFixture(): Promise<Buffer> {
  return sharp(Buffer.from(`<svg width="320" height="320" xmlns="http://www.w3.org/2000/svg">
    <rect width="320" height="320" fill="#00ff00"/>
    <rect x="70" y="52" width="180" height="220" rx="80" fill="#7138dd"/>
    <circle cx="1" cy="120" r="3" fill="#ff4fc8"/>
  </svg>`)).png().toBuffer();
}

async function saturatedEffectFixture(): Promise<Buffer> {
  const particles = Array.from({ length: 20 }, (_, index) => {
    const x = 92 + (index * 31) % 330;
    const y = 70 + (index * 47) % 370;
    const color = ['#00dfff', '#ff42d0', '#ffe85a'][index % 3];
    return `<circle cx="${x}" cy="${y}" r="${5 + index % 4}" fill="${color}"/>`;
  }).join('');
  return sharp(Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" fill="#00ff00"/>
    <rect x="138" y="112" width="236" height="288" rx="112" fill="#6f35dc"/>
    <path d="M142 185 Q256 72 370 185" fill="none" stroke="#00dfff" stroke-width="18"/>
    <path d="M148 330 Q256 430 364 330" fill="none" stroke="#ff42d0" stroke-width="18"/>
    ${particles}
  </svg>`)).png().toBuffer();
}

async function contaminatedGlowFixture(): Promise<Buffer> {
  return sharp(Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" fill="#00ff00"/>
    <rect x="124" y="116" width="264" height="290" rx="126" fill="#6f35dc"/>
    <circle cx="374" cy="112" r="42" fill="#56d968"/>
    <circle cx="374" cy="112" r="27" fill="#00dfff"/>
    <path d="M350 136 L305 188" stroke="#ffe85a" stroke-width="15" stroke-linecap="round"/>
    <circle cx="124" cy="300" r="18" fill="#ff42d0"/>
  </svg>`)).png().toBuffer();
}

async function solidEdgeFrame(edgeColor: string, subjectColor = '#d53cff'): Promise<Buffer> {
  return sharp(Buffer.from(`<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
    <rect width="640" height="360" fill="${edgeColor}"/>
    <ellipse cx="320" cy="180" rx="145" ry="108" fill="${subjectColor}"/>
  </svg>`)).png().toBuffer();
}

async function detailedMatchingEdgeFrame(edgeColor: string): Promise<Buffer> {
  const particles = Array.from({ length: 22 }, (_, index) => {
    const x = 8 + (index * 83) % 624;
    const y = index % 2 === 0 ? 8 : 348;
    return `<circle cx="${x}" cy="${y}" r="7" fill="${index % 3 === 0 ? '#ef5fd5' : '#46dbea'}"/>`;
  }).join('');
  return sharp(Buffer.from(`<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
    <rect width="640" height="360" fill="${edgeColor}"/>
    ${particles}
    <ellipse cx="320" cy="180" rx="150" ry="112" fill="#d53cff"/>
  </svg>`)).png().toBuffer();
}

describe('Visual Asset Bridge', () => {
  it('blocks a Studio Composition that drops ready hero plates from the Storyboard', () => {
    const storyboard = {
      scenes: [
        { id: 'scene-input', assetIds: ['chip'], visualPlan: { carrier: 'plate' as const } },
        { id: 'scene-compute', assetIds: ['network'], visualPlan: { carrier: 'plate' as const } },
        { id: 'scene-output', assetIds: ['output'], visualPlan: { carrier: 'plate' as const } },
      ],
    };
    const manifest = {
      assets: [
        { id: 'chip', type: 'image' as const, path: '<<<media_1>>>', sceneIds: ['scene-input'], status: 'ready' as const, role: 'hero' as const },
        { id: 'network', type: 'image' as const, path: '<<<media_2>>>', sceneIds: ['scene-compute'], status: 'ready' as const, role: 'hero' as const },
        { id: 'output', type: 'image' as const, path: '<<<media_3>>>', sceneIds: ['scene-output'], status: 'ready' as const, role: 'hero' as const },
        { id: 'score', type: 'audio' as const, path: 'score.wav', sceneIds: ['scene-input'], status: 'ready' as const, role: 'support' as const },
      ],
    };

    expect(() => assertCompositionConsumesVisualAssets({
      storyboard,
      manifest,
      composition: { mode: 'editable', sceneIds: ['scene-input', 'scene-compute', 'scene-output'] },
      design: {
        code: 'function Composition(props){return <AbsoluteFill><Audio src={props.score}/></AbsoluteFill>}',
        props: { score: 'score.wav', title: 'AI inference' },
        editables: [{ id: 'title', type: 'text', propKey: 'title' }],
      },
      mediaUrls: ['https://cdn.test/chip.jpg', 'https://cdn.test/network.jpg', 'https://cdn.test/output.jpg'],
    })).toThrow(/chip.*absent[\s\S]*network.*absent[\s\S]*output.*absent[\s\S]*do not regenerate/);
  });

  it('accepts rendered hero plates only when editable mode exposes each media prop', () => {
    const storyboard = {
      scenes: [{ id: 'scene-input', assetIds: ['chip'], visualPlan: { carrier: 'plate' as const } }],
    };
    const manifest = {
      assets: [{
        id: 'chip',
        type: 'image' as const,
        path: '<<<media_1>>>',
        sceneIds: ['scene-input'],
        status: 'ready' as const,
        role: 'hero' as const,
      }],
    };
    const base = {
      storyboard,
      manifest,
      composition: { mode: 'editable' as const, sceneIds: ['scene-input'] },
      mediaUrls: ['https://cdn.test/chip.jpg'],
    };

    expect(() => assertCompositionConsumesVisualAssets({
      ...base,
      design: {
        code: 'function Composition(props){return <Img src={props.chip}/>}',
        props: { chip: 'https://cdn.test/chip.jpg' },
        editables: [],
      },
    })).toThrow(/not exposed as an editable image/);

    expect(() => assertCompositionConsumesVisualAssets({
      ...base,
      design: {
        code: 'function Composition(props){return <Img src={props.chip}/>}',
        props: { chip: 'https://cdn.test/chip.jpg' },
        editables: [{ id: 'chip', type: 'image', propKey: 'chip' }],
      },
    })).not.toThrow();
  });

  it('keys the border background, despills edges, and preserves only tiny isolated key-colored details', async () => {
    const result = await prepareChromaKeyCutout(await chromaFixture());
    expect(result.keyColor).toBe('#00ff00');
    expect(result.quality.status).toBe('pass');
    expect(result.quality.issues).toEqual([]);
    expect(result.quality.metrics?.transparentRatio).toBeGreaterThan(0.35);
    expect(result.quality.metrics?.spillRatio).toBeLessThanOrEqual(0.03);
    expect(result.quality.metrics?.residualChromaRatio).toBeLessThanOrEqual(0.001);
    expect(result.subjectBox).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(result.subjectBox!.x).toBeGreaterThan(2);
    expect(result.subjectBox!.y).toBeGreaterThanOrEqual(0);
    expect(result.width).toBeLessThan(512);
    expect(result.height).toBeLessThanOrEqual(512);

    const { data, info } = await sharp(result.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    expect(alphaAt(2, 2)).toBe(0);
    expect(alphaAt(256, 255)).toBeGreaterThan(245);
    expect(alphaAt(205, 190)).toBeGreaterThan(245);
    let magentaOvershootPixels = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) {
      const alpha = data[offset + 3];
      if (alpha > 8 && alpha < 248 && data[offset] > 225 && data[offset + 1] < 55 && data[offset + 2] > 225) {
        magentaOvershootPixels++;
      }
    }
    expect(magentaOvershootPixels).toBe(0);
  });

  it('removes a sizeable chroma pocket enclosed by a foreground effect', async () => {
    const result = await prepareChromaKeyCutout(await enclosedChromaPocketFixture());
    expect(result.quality.status).toBe('pass');
    expect(result.quality.metrics?.enclosedKeyRegionCount).toBeGreaterThanOrEqual(1);
    expect(result.quality.metrics?.residualChromaRatio).toBe(0);

    const { data, info } = await sharp(result.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    expect(alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2))).toBe(0);
    expect(alphaAt(Math.floor(info.width / 2), 14)).toBeGreaterThan(245);
  });

  it('removes tiny detached edge particles without accepting a clipped main subject', async () => {
    const result = await prepareChromaKeyCutout(await edgeParticleFixture());
    expect(result.quality.status).toBe('pass');
    expect(result.quality.metrics?.removedEdgeDecorationRegionCount).toBe(1);
    expect(result.quality.metrics?.subjectTouchesEdge).toBe(0);

    const { data, info } = await sharp(result.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const leftEdgeAlpha = Array.from({ length: info.height }, (_, y) => data[(y * info.width) * info.channels + 3]);
    expect(Math.max(...leftEdgeAlpha)).toBe(0);
  });

  it('preserves saturated foreground effects instead of projecting nearby colors into them', async () => {
    const result = await prepareChromaKeyCutout(await saturatedEffectFixture());
    expect(result.quality.status).toBe('pass');
    expect(result.quality.metrics?.meanOpaqueColorDelta).toBeLessThan(0.5);
    expect(result.quality.metrics?.opaqueColorChangedRatio).toBeLessThan(0.003);
    expect(result.quality.metrics?.coreOpaqueColorChangedRatio).toBe(0);

    const { data, info } = await sharp(result.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let cyan = 0;
    let magenta = 0;
    let yellow = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) {
      if (data[offset + 3] < 220) continue;
      const [r, g, b] = [data[offset], data[offset + 1], data[offset + 2]];
      if (r < 70 && g > 160 && b > 190) cyan++;
      if (r > 190 && g < 130 && b > 150) magenta++;
      if (r > 190 && g > 170 && b < 130) yellow++;
    }
    expect(cyan).toBeGreaterThan(500);
    expect(magenta).toBeGreaterThan(500);
    expect(yellow).toBeGreaterThan(120);
  });

  it('despills a bounded chroma-contaminated glow without changing its alpha or adjacent effect colors', async () => {
    const result = await prepareChromaKeyCutout(await contaminatedGlowFixture());
    expect(result.quality.status).toBe('pass');
    expect(result.quality.metrics?.despilledForegroundRatio).toBeGreaterThan(0);
    expect(result.quality.metrics?.coreOpaqueColorChangedRatio).toBe(0);

    const { data, info } = await sharp(result.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let greenExcess = 0;
    let cyan = 0;
    let yellow = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) {
      if (data[offset + 3] < 220) continue;
      const [r, g, b] = [data[offset], data[offset + 1], data[offset + 2]];
      if (g - Math.max(r, b) > 40) greenExcess++;
      if (r < 70 && g > 160 && b > 190) cyan++;
      if (r > 190 && g > 170 && b < 130) yellow++;
    }
    expect(greenExcess).toBeLessThan(40);
    expect(cyan).toBeGreaterThan(1_500);
    expect(yellow).toBeGreaterThan(250);
  });

  it('produces a five-background contact sheet for visual inspection', async () => {
    const result = await prepareChromaKeyCutout(await chromaFixture());
    const contactSheet = await renderCutoutContactSheet(result.png);
    const metadata = await sharp(contactSheet).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(960);
    expect(metadata.height).toBe(640);
  });

  it('stores source, prepared media, QA, and metadata once, then reuses the cache', async () => {
    workspaceFiles.clear();
    const source = await chromaFixture();
    const input = {
      projectId: 'project-1',
      userId: 'user-1',
      supabase: {},
      sourceUrl: `data:image/png;base64,${source.toString('base64')}`,
      mode: 'cutout' as const,
      assetId: 'mascot-hero',
      role: 'hero' as const,
      sourceSnapshotId: 'snapshot-1',
    };
    const first = await prepareVisualAsset(input);
    expect(first.cached).toBe(false);
    expect(first.asset.status).toBe('ready');
    expect(first.asset.width).toBeLessThan(512);
    expect(first.asset.sourceUrl).toBe(first.asset.sourceWorkspaceUrl);
    expect(first.asset.sourceUrl).not.toContain('base64');
    expect(first.asset.sourceWorkspacePath).toMatch(/\/source\.png$/);
    expect(workspaceFiles.has(first.asset.sourceWorkspacePath)).toBe(true);
    expect(workspaceFiles.has(first.asset.workspacePath)).toBe(true);
    expect(workspaceFiles.has(first.asset.quality.contactSheetPath!)).toBe(true);
    const pointerPath = preparedVisualAssetPointerPath(input.projectId, input.assetId);
    expect(workspaceFiles.has(pointerPath)).toBe(true);
    expect(JSON.parse(String(workspaceFiles.get(pointerPath)?.content))).toMatchObject({
      assetId: input.assetId,
      preparedUrl: first.asset.preparedUrl,
    });
    await expect(resolvePreparedVisualAssetById({
      projectId: input.projectId,
      userId: input.userId,
      supabase: input.supabase,
      assetId: input.assetId,
    })).resolves.toMatchObject({ cacheKey: first.asset.cacheKey });
    const fileCount = workspaceFiles.size;

    const second = await prepareVisualAsset(input);
    expect(second.cached).toBe(true);
    expect(second.asset.cacheKey).toBe(first.asset.cacheKey);
    expect(workspaceFiles.size).toBe(fileCount);
  });

  it('refreshes the semantic pointer when QA changes without changing the output URL', async () => {
    workspaceFiles.clear();
    const source = await chromaFixture();
    const input = {
      projectId: 'project-pointer-refresh',
      userId: 'user-1',
      supabase: {},
      sourceUrl: `data:image/png;base64,${source.toString('base64')}`,
      mode: 'cutout' as const,
      assetId: 'mascot-hero',
      role: 'hero' as const,
    };
    const first = await prepareVisualAsset(input);
    const pointerPath = preparedVisualAssetPointerPath(input.projectId, input.assetId);
    const pointer = workspaceFiles.get(pointerPath)!;
    const stale = JSON.parse(String(pointer.content));
    stale.status = 'failed';
    stale.quality.status = 'revise';
    workspaceFiles.set(pointerPath, { ...pointer, content: JSON.stringify(stale) });

    const refreshed = await prepareVisualAsset({ ...input, forceRefresh: true });
    expect(refreshed.asset.preparedUrl).toBe(first.asset.preparedUrl);
    expect(JSON.parse(String(workspaceFiles.get(pointerPath)?.content))).toMatchObject({
      status: 'ready',
      quality: { status: 'pass' },
    });
  });

  it('rejects a cutout whose foreground is clipped by the source canvas', async () => {
    const result = await prepareChromaKeyCutout(await chromaFixture(true));
    expect(result.quality.status).toBe('revise');
    expect(result.quality.issues.join(' ')).toContain('touches the canvas edge');
  });

  it('accepts quiet matching video edges and rejects visible temporal seams', async () => {
    const matching = await Promise.all([
      solidEdgeFrame('#121826'),
      solidEdgeFrame('#131927'),
      solidEdgeFrame('#111725'),
    ]);
    const pass = await analyzeEdgeFrameBuffers(matching, '#121826');
    expect(pass.quality.status).toBe('pass');
    expect(pass.targetBackground).toBe('#121826');
    expect(pass.recommendedFeatherPx).toBeGreaterThanOrEqual(20);

    const drifting = await Promise.all([
      solidEdgeFrame('#121826'),
      solidEdgeFrame('#f4f4f4'),
      solidEdgeFrame('#235f9a'),
    ]);
    const revise = await analyzeEdgeFrameBuffers(drifting, '#121826');
    expect(revise.quality.status).toBe('revise');
    expect(revise.quality.issues.join(' ')).toMatch(/drifts|changes/);
  });

  it('accepts moderately detailed but color-stable edges with a wider feather recommendation', async () => {
    const frames = await Promise.all([
      detailedMatchingEdgeFrame('#19103f'),
      detailedMatchingEdgeFrame('#1b1141'),
      detailedMatchingEdgeFrame('#18103e'),
    ]);
    const result = await analyzeEdgeFrameBuffers(frames, '#1a1040');
    expect(result.quality.status).toBe('pass');
    expect(result.quality.metrics?.maxTargetDistance).toBeLessThan(20);
    expect(result.recommendedFeatherPx).toBeGreaterThanOrEqual(20);
  });

  it('extends Studio artifacts without invalidating legacy manifests', () => {
    const prepared = preparedVisualAssetSchema.parse({
      version: '1.0',
      assetId: 'mascot-cutout',
      role: 'hero',
      kind: 'image',
      mode: 'cutout',
      sourceUrl: 'https://example.com/source.png',
      sourceWorkspacePath: 'project/visual-assets/cutout/key/source.png',
      sourceWorkspaceUrl: 'https://example.com/workspace-source.png',
      preparedUrl: 'https://example.com/prepared.png',
      workspacePath: 'project/visual-assets/cutout/key/mascot.png',
      cacheKey: '1234567890abcdef',
      status: 'ready',
      hasAlpha: true,
      width: 512,
      height: 512,
      quality: { status: 'pass', issues: [] },
    });
    expect(studioArtifactSchemas.storyboard.parse({
      version: '1.0',
      scenes: [{
        id: 'scene-1',
        startSeconds: 0,
        endSeconds: 5,
        purpose: 'Introduce the guide',
        focalPoint: 'Mascot',
        visualTreatment: 'Foreground character reveal',
        transitionOut: 'Portal wipe',
        assetIds: ['mascot-cutout'],
        visualPlan: {
          carrier: 'cutout',
          primaryAssetId: 'mascot-cutout',
          subject: 'Mascot',
          shotScale: 'close',
          compositionIntent: 'Large foreground first read',
          backgroundIntent: 'Responsive procedural workspace',
          motionIntent: 'Character enters and environment reacts',
        },
      }],
      artDirection: 'Playful creative workshop',
      layoutContract: 'One focal subject per beat',
      subtitleSafeArea: 'Scene-defined',
    }).scenes[0].visualPlan?.carrier).toBe('cutout');
    expect(studioArtifactSchemas.assets.parse({
      version: '1.0',
      assets: [{
        id: 'mascot-cutout',
        type: 'image',
        path: prepared.workspacePath,
        source: prepared.sourceUrl,
        sceneIds: ['scene-1'],
        status: 'ready',
        costUsd: 0,
        role: 'hero',
        prepared,
      }],
      totalCostUsd: 0,
      missingAssetIds: [],
    }).assets[0].prepared?.mode).toBe('cutout');
  });

  it('rejects ad hoc cutouts when Storyboard selected the Visual Asset Bridge', () => {
    const storyboard = {
      scenes: [{
        id: 'scene-1',
        assetIds: ['mascot-cutout'],
        visualPlan: { carrier: 'cutout' as const, primaryAssetId: 'mascot-cutout' },
      }],
    };
    expect(() => assertVisualAssetBridgeEvidence({
      storyboard,
      manifest: { assets: [{ id: 'mascot-cutout', path: 'custom-keyed.png' }] },
    })).toThrow(/must use prepare_visual_asset|ad hoc keying/);

    const preparedUrl = 'https://example.com/prepared.png';
    expect(() => assertVisualAssetBridgeEvidence({
      storyboard,
      manifest: {
        assets: [{
          id: 'mascot-cutout',
          path: preparedUrl,
          prepared: {
            assetId: 'mascot-cutout',
            mode: 'cutout',
            preparedUrl,
            status: 'ready',
            hasAlpha: true,
            quality: {
              status: 'pass',
              contactSheetPath: 'visual-assets/mascot-qa.png',
              contactSheetUrl: 'https://example.com/mascot-qa.png',
            },
          },
        }],
      },
    })).not.toThrow();
  });

  it('rejects a manifest that forges pass over a persisted revise result', async () => {
    const preparedUrl = 'https://example.com/prepared.mp4';
    const contactSheetPath = 'visual-assets/video-qa.jpg';
    const contactSheetUrl = 'https://example.com/video-qa.jpg';
    const storyboard = {
      scenes: [{
        id: 'scene-1',
        assetIds: ['hero-video'],
        visualPlan: { carrier: 'edge-video' as const, primaryAssetId: 'hero-video' },
      }],
    };
    const manifest = {
      assets: [{
        id: 'hero-video',
        path: preparedUrl,
        prepared: {
          assetId: 'hero-video',
          mode: 'edge-video' as const,
          preparedUrl,
          status: 'ready' as const,
          quality: { status: 'pass' as const, contactSheetPath, contactSheetUrl },
        },
      }],
    };

    await expect(assertPersistedVisualAssetBridgeEvidence({
      storyboard,
      manifest,
      resolvePreparedAsset: async () => ({
        assetId: 'hero-video',
        mode: 'edge-video',
        preparedUrl,
        status: 'failed',
        quality: { status: 'revise', contactSheetPath, contactSheetUrl },
      }),
    })).rejects.toThrow(/Persisted asset hero-video has not passed/);
  });

  it('keeps visual direction independent and makes preparation a first-class tool', () => {
    const agent = read('src/lib/agent.ts');
    const sticker = read('src/skills/sticker-maker/SKILL.md');
    const director = read('src/skills/_shared/visual-direction/SKILL.md');
    const bridge = read('src/skills/_shared/visual-asset-bridge/SKILL.md');
    const production = read('src/skills/_shared/studio-production/production-contract.md');

    expect(agent).toContain('prepare_visual_asset: tool({');
    expect(agent).toContain("'prepare_visual_asset'");
    expect(agent).toContain('The image above is the QA contact sheet');
    expect(agent).toContain('mode + asset_id and no media source first');
    expect(sticker).toContain('five-background QA sheet');
    expect(sticker).toContain('enclosed high-confidence chroma pockets');
    expect(sticker).toContain('empty chroma canvas');
    expect(sticker).not.toContain('run_code({ runtime: "node" })');
    expect(sticker).not.toContain('threshold parameter');
    expect(director).toContain('Theme Before Style');
    expect(director).toContain('one dominant carrier for asset routing');
    expect(director).toContain('carrier field is not a composition limit');
    expect(director).toContain('There is no required asset count');
    expect(bridge).toContain('Transparent video is intentionally unsupported');
    expect(bridge).toContain('Media Index is only the turn-time selector');
    expect(bridge).toContain('visual-assets/by-id');
    expect(bridge).toContain('visualPlan.primaryAssetId');
    expect(production).toContain('optional `visualPlan`');
    expect(production).toContain('`prepared` field');
    expect(production).toContain('rejects ad hoc keying');
  });
});
