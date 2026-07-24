import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compositionDraftPath, createPersistedCompositionDraft } from '@/lib/composition-draft';
import {
  compileSavedCompositionPart,
  compositionWorkspaceStatePath,
} from '@/lib/composition-workspace-runner';

const workspaceFiles = vi.hoisted(() => new Map<string, { content: string; contentType: string; storageUrl: string }>());

vi.mock('../src/lib/workspace', () => ({
  writeFile: vi.fn(async (filePath: string, content: string | Buffer, _supabase: unknown, _userId: string, contentType = 'text/plain') => {
    const storageUrl = `https://workspace.test/${filePath}`;
    workspaceFiles.set(filePath, {
      content: Buffer.isBuffer(content) ? content.toString('utf8') : content,
      contentType,
      storageUrl,
    });
    return { success: true, storageUrl };
  }),
  readFile: vi.fn(async (filePath: string) => workspaceFiles.get(filePath) || null),
}));

const projectId = 'project-1';
const userId = 'user-1';
const supabase = {} as never;
const foundationPath = `${projectId}/drafts/composition-parts/00-foundation.js`;
const rootPath = `${projectId}/drafts/composition-parts/90-root.js`;

function seedScaffold() {
  workspaceFiles.set(compositionDraftPath(projectId), {
    content: JSON.stringify({
      ...createPersistedCompositionDraft({
        code: 'function Composition() { return <AbsoluteFill />; }',
        width: 1080,
        height: 1920,
        props: { stale: true },
        animation: { fps: 30, durationInSeconds: 30 },
      }),
      __makaronScaffold: true,
    }),
    contentType: 'application/json',
    storageUrl: 'https://workspace.test/scaffold.json',
  });
}

describe('Composition workspace runner', () => {
  beforeEach(() => {
    workspaceFiles.clear();
    seedScaffold();
  });

  it('registers the first file, then automatically assembles and autosaves a valid draft', async () => {
    workspaceFiles.set(foundationPath, {
      content: "const COLOR = '#d946ef';",
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${foundationPath}`,
    });
    const first = await compileSavedCompositionPart({
      projectId,
      userId,
      supabase,
      workspaceId: 'run-1',
      partPath: foundationPath,
      snapshotImages: [],
      metadata: {
        width: 1920,
        height: 1080,
        props: { title: 'Makaron' },
        editables: [{ id: 'title', type: 'text', label: 'Title', propKey: 'title' }],
        animation: { fps: 30, durationInSeconds: 30 },
      },
    });
    expect(first).toMatchObject({
      status: 'waiting',
      partPaths: [foundationPath],
      totalChars: "const COLOR = '#d946ef';".length,
    });

    workspaceFiles.set(rootPath, {
      content: 'function Composition(props) { return <AbsoluteFill style={{backgroundColor: COLOR}}><div data-editable="title">{props.title}</div></AbsoluteFill>; }',
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${rootPath}`,
    });
    const second = await compileSavedCompositionPart({
      projectId,
      userId,
      supabase,
      workspaceId: 'run-1',
      partPath: rootPath,
      snapshotImages: [],
    });

    expect(second).toMatchObject({
      status: 'ready',
      partPaths: [foundationPath, rootPath],
      designPath: compositionDraftPath(projectId),
    });
    if (second.status !== 'ready') throw new Error('expected ready workspace');
    expect(second.design.width).toBe(1920);
    expect(second.design.height).toBe(1080);
    expect(second.design.props).toEqual({ title: 'Makaron' });
    expect(second.design.code).toContain("const COLOR = '#d946ef'");
    expect(second.design.code).toContain('function Composition(props)');
    expect((second.design as unknown as Record<string, unknown>).__makaronScaffold).toBeUndefined();

    const state = JSON.parse(workspaceFiles.get(compositionWorkspaceStatePath(projectId))!.content);
    expect(state).toMatchObject({
      workspaceId: 'run-1',
      partPaths: [foundationPath, rootPath],
      lastCompile: { status: 'ready', designPath: compositionDraftPath(projectId) },
    });
  });

  it('creates a normal Agent Run draft from metadata without a Studio scaffold', async () => {
    workspaceFiles.delete(compositionDraftPath(projectId));
    workspaceFiles.set(foundationPath, {
      content: "const COLOR = '#0ea5e9';",
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${foundationPath}`,
    });
    await compileSavedCompositionPart({
      projectId,
      userId,
      supabase,
      workspaceId: 'agent-run-1',
      partPath: foundationPath,
      snapshotImages: [],
      metadata: {
        width: 1280,
        height: 720,
        props: { title: 'Normal Agent' },
        editables: [{ id: 'title', type: 'text', label: 'Title', propKey: 'title' }],
        animation: { fps: 30, durationInSeconds: 12 },
      },
    });
    workspaceFiles.set(rootPath, {
      content: 'function Composition(props) { return <AbsoluteFill style={{backgroundColor: COLOR}}><div data-editable="title">{props.title}</div></AbsoluteFill>; }',
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${rootPath}`,
    });

    const result = await compileSavedCompositionPart({
      projectId,
      userId,
      supabase,
      workspaceId: 'agent-run-1',
      partPath: rootPath,
      snapshotImages: [],
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected ready workspace');
    expect(result.design).toMatchObject({
      width: 1280,
      height: 720,
      props: { title: 'Normal Agent' },
    });
  });

  it('merges later metadata updates without dropping first-part fields', async () => {
    workspaceFiles.set(foundationPath, {
      content: "const COLOR = '#0ea5e9';",
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${foundationPath}`,
    });
    await compileSavedCompositionPart({
      projectId,
      userId,
      supabase,
      workspaceId: 'run-1',
      partPath: foundationPath,
      snapshotImages: [],
      metadata: {
        width: 1920,
        height: 1080,
        props: { title: 'Makaron' },
        editables: [{ id: 'title', type: 'text', label: 'Title', propKey: 'title' }],
        animation: { fps: 30, durationInSeconds: 30 },
      },
    });
    workspaceFiles.set(rootPath, {
      content: 'function Composition(props) { return <AbsoluteFill style={{backgroundColor: COLOR}}><div data-editable="title">{props.title}</div></AbsoluteFill>; }',
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${rootPath}`,
    });
    const result = await compileSavedCompositionPart({
      projectId,
      userId,
      supabase,
      workspaceId: 'run-1',
      partPath: rootPath,
      snapshotImages: [],
      metadata: { description: 'Updated description' },
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected ready workspace');
    expect(result.design).toMatchObject({
      width: 1920,
      height: 1080,
      props: { title: 'Makaron' },
      description: 'Updated description',
    });
  });

  it('preserves image and video editable metadata through durable composition parts', async () => {
    workspaceFiles.set(foundationPath, {
      content: "const BG = '#000';",
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${foundationPath}`,
    });
    await compileSavedCompositionPart({
      projectId,
      userId,
      supabase,
      workspaceId: 'media-editables',
      partPath: foundationPath,
      snapshotImages: [],
      metadata: {
        width: 1080,
        height: 1920,
        props: {
          coverImage: 'https://example.com/cover.jpg',
          heroVideo: 'https://example.com/clip.mp4',
          heroVideoStart: 12,
          heroVideoEnd: 132,
        },
        editables: [
          { id: 'cover', type: 'image', label: 'Cover', propKey: 'coverImage' },
          {
            id: 'heroVideo',
            type: 'video',
            label: 'Hero video',
            propKey: 'heroVideo',
            trimBeforePropKey: 'heroVideoStart',
            trimAfterPropKey: 'heroVideoEnd',
          },
        ],
        animation: { fps: 30, durationInSeconds: 5 },
      },
    });
    workspaceFiles.set(rootPath, {
      content: `function Composition(props) {
        return <AbsoluteFill style={{background: BG}}>
          <div data-editable="cover" style={{position: 'absolute', left: 40, top: 40, width: 400, height: 400}}>
            <Img src={props.coverImage} style={{width: '100%', height: '100%'}} />
          </div>
          <div data-editable="heroVideo" style={{position: 'absolute', left: 40, top: 520, width: 900, height: 1200}}>
            <Video
              src={props.heroVideo}
              trimBefore={props.heroVideoStart}
              trimAfter={props.heroVideoEnd}
              style={{width: '100%', height: '100%'}}
            />
          </div>
        </AbsoluteFill>;
      }`,
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${rootPath}`,
    });

    const result = await compileSavedCompositionPart({
      projectId,
      userId,
      supabase,
      workspaceId: 'media-editables',
      partPath: rootPath,
      snapshotImages: [],
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected ready workspace');
    expect(result.design.editables).toEqual([
      { id: 'cover', type: 'image', label: 'Cover', propKey: 'coverImage' },
      {
        id: 'heroVideo',
        type: 'video',
        label: 'Hero video',
        propKey: 'heroVideo',
        trimBeforePropKey: 'heroVideoStart',
        trimAfterPropKey: 'heroVideoEnd',
      },
    ]);
  });

  it('returns independent compile diagnostics together without overwriting the recoverable draft', async () => {
    workspaceFiles.set(foundationPath, {
      content: 'const image = "<<<media_9>>>";',
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${foundationPath}`,
    });
    workspaceFiles.set(rootPath, {
      content: 'function Composition() { return <AbsoluteFill><MissingComponent src={image} /></AbsoluteFill>; }',
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${rootPath}`,
    });
    await compileSavedCompositionPart({ projectId, userId, supabase, workspaceId: 'run-1', partPath: foundationPath, snapshotImages: [] });
    const result = await compileSavedCompositionPart({ projectId, userId, supabase, workspaceId: 'run-1', partPath: rootPath, snapshotImages: [] });

    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('expected invalid workspace');
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.join('\n')).toContain('MissingComponent');
    expect(result.diagnostics.join('\n')).toContain('Media Index marker could not be resolved');
    const persisted = JSON.parse(workspaceFiles.get(compositionDraftPath(projectId))!.content);
    expect(persisted.__makaronScaffold).toBe(true);
  });

  it('keeps helper-only source invalid until a root entry component is saved', async () => {
    const scenesPath = `${projectId}/drafts/composition-parts/10-scenes.js`;
    workspaceFiles.set(foundationPath, {
      content: "const COLOR = '#d946ef';",
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${foundationPath}`,
    });
    await compileSavedCompositionPart({
      projectId,
      userId,
      supabase,
      workspaceId: 'run-1',
      partPath: foundationPath,
      snapshotImages: [],
      metadata: { width: 1920, height: 1080 },
    });
    workspaceFiles.set(scenesPath, {
      content: 'function HeroScene() { return <AbsoluteFill style={{backgroundColor: COLOR}} />; }',
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${scenesPath}`,
    });

    const helpersOnly = await compileSavedCompositionPart({
      projectId,
      userId,
      supabase,
      workspaceId: 'run-1',
      partPath: scenesPath,
      snapshotImages: [],
    });

    expect(helpersOnly.status).toBe('invalid');
    if (helpersOnly.status !== 'invalid') throw new Error('expected invalid workspace');
    expect(helpersOnly.diagnostics.join('\n')).toContain('no root entry component');

    workspaceFiles.set(rootPath, {
      content: 'function Composition() { return <HeroScene />; }',
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${rootPath}`,
    });
    const completed = await compileSavedCompositionPart({
      projectId,
      userId,
      supabase,
      workspaceId: 'run-1',
      partPath: rootPath,
      snapshotImages: [],
    });
    expect(completed.status).toBe('ready');
  });

  it('starts a clean part manifest when a different execution writes the same project', async () => {
    workspaceFiles.set(foundationPath, {
      content: 'const oldRun = true;',
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${foundationPath}`,
    });
    await compileSavedCompositionPart({ projectId, userId, supabase, workspaceId: 'run-1', partPath: foundationPath, snapshotImages: [] });

    const newPath = `${projectId}/drafts/composition-parts/10-new-run.js`;
    workspaceFiles.set(newPath, {
      content: 'const newRun = true;',
      contentType: 'text/javascript',
      storageUrl: `https://workspace.test/${newPath}`,
    });
    const result = await compileSavedCompositionPart({ projectId, userId, supabase, workspaceId: 'run-2', partPath: newPath, snapshotImages: [] });

    expect(result).toMatchObject({ status: 'waiting', partPaths: [newPath] });
    const state = JSON.parse(workspaceFiles.get(compositionWorkspaceStatePath(projectId))!.content);
    expect(state.workspaceId).toBe('run-2');
    expect(state.partPaths).toEqual([newPath]);
  });
});
