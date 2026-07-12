import type { SupabaseClient } from '@supabase/supabase-js';
import type { DesignPayload } from '@/types';
import * as workspace from './workspace';
import { loadCompositionDraft, persistCompositionDraft } from './composition-draft';
import { validateDesign } from './design-harness';
import { WorkspaceStudioRunStore, type StudioRun } from './studio-run';

interface StoryboardScene {
  id: string;
  startSeconds: number;
  endSeconds: number;
  purpose: string;
  focalPoint: string;
  visualTreatment: string;
  transitionOut: string;
}

interface StoryboardArtifact {
  scenes: StoryboardScene[];
  artDirection?: string;
  layoutContract?: string;
  subtitleSafeArea?: string;
}

interface ScriptSection {
  id: string;
  startSeconds: number;
  endSeconds: number;
  narration?: string;
  onScreenText?: string[];
}

interface ScriptArtifact {
  sections?: ScriptSection[];
}

function textForScene(scene: StoryboardScene, script: ScriptArtifact): string[] {
  const section = script.sections?.find(item => (
    item.id === scene.id
    || (item.startSeconds < scene.endSeconds && item.endSeconds > scene.startSeconds)
  ));
  return section?.onScreenText?.filter(Boolean).slice(0, 3)
    || [scene.focalPoint || scene.purpose].filter(Boolean);
}

export function buildStudioCompositionScaffold(input: {
  run: Pick<StudioRun, 'id' | 'deliveryPromise'>;
  storyboard: StoryboardArtifact;
  script: ScriptArtifact;
}): DesignPayload & { description: string; __makaronScaffold: true } {
  const { deliveryPromise } = input.run;
  const fps = deliveryPromise.fps;
  const scenes = input.storyboard.scenes.map((scene, index) => ({
    id: scene.id,
    from: Math.max(0, Math.round(scene.startSeconds * fps)),
    duration: Math.max(1, Math.round((scene.endSeconds - scene.startSeconds) * fps)),
    eyebrow: `SCENE ${String(index + 1).padStart(2, '0')}`,
    title: textForScene(scene, input.script)[0] || scene.focalPoint,
    subtitle: textForScene(scene, input.script).slice(1).join('  /  ') || scene.purpose,
    purpose: scene.purpose,
    visualTreatment: scene.visualTreatment,
    transitionOut: scene.transitionOut,
  }));
  const code = `
const SCAFFOLD_COLORS = ['#111115', '#181820', '#0f171b', '#1b141b'];
function ScaffoldScene({ scene, index }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, Math.max(11, scene.duration - 10), scene.duration], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rise = interpolate(frame, [0, 18], [36, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ backgroundColor: SCAFFOLD_COLORS[index % SCAFFOLD_COLORS.length], color: '#f5f5f7', fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif', opacity, padding: '7%', justifyContent: 'center' }}>
    <div style={{ fontSize: 18, fontWeight: 700, color: '#e65cb6', marginBottom: 24 }}>{scene.eyebrow}</div>
    <div style={{ fontSize: 64, lineHeight: 1.12, fontWeight: 760, maxWidth: '82%', transform: 'translateY(' + rise + 'px)' }}>{scene.title}</div>
    <div style={{ fontSize: 28, lineHeight: 1.45, color: 'rgba(245,245,247,0.68)', maxWidth: '72%', marginTop: 24 }}>{scene.subtitle}</div>
    <div style={{ position: 'absolute', left: '7%', right: '7%', bottom: '6%', height: 2, backgroundColor: 'rgba(255,255,255,0.12)' }} />
  </AbsoluteFill>;
}
function Composition(props) {
  return <AbsoluteFill style={{ backgroundColor: '#111115' }}>
    {props.scenes.map((scene, index) => <Sequence key={scene.id} from={scene.from} durationInFrames={scene.duration}><ScaffoldScene scene={scene} index={index} /></Sequence>)}
  </AbsoluteFill>;
}`.trim();
  const design = {
    code,
    width: deliveryPromise.width,
    height: deliveryPromise.height,
    props: {
      scenes,
      artDirection: input.storyboard.artDirection || '',
      layoutContract: input.storyboard.layoutContract || '',
      subtitleSafeArea: input.storyboard.subtitleSafeArea || '',
    },
    animation: {
      fps,
      durationInSeconds: deliveryPromise.durationSeconds,
    },
    description: `[studio-scaffold:${input.run.id}] Structural checkpoint only. Replace or refine using the original Composition and Director guidance before preview, publish, review, or delivery.`,
    __makaronScaffold: true as const,
  };
  const validationError = validateDesign(design);
  if (validationError) throw new Error(validationError);
  return design;
}

async function readJson<T>(path: string | undefined, supabase: SupabaseClient, userId: string): Promise<T> {
  if (!path) throw new Error('Required Studio artifact path is missing');
  const file = await workspace.readFile(path, supabase, userId);
  if (!file) throw new Error(`Studio artifact not found: ${path}`);
  return JSON.parse(file.content) as T;
}

export async function ensureStudioCompositionScaffold(input: {
  projectId: string;
  userId: string;
  supabase: SupabaseClient;
}): Promise<{ created: boolean; path?: string; studioRunId?: string; codeChars?: number; elapsedMs: number }> {
  const startedAt = Date.now();
  const store = new WorkspaceStudioRunStore(input.supabase, input.userId);
  const run = (await store.listRuns(input.projectId)).find(item => item.status === 'running' && item.currentStage === 'composition');
  if (!run) return { created: false, elapsedMs: Date.now() - startedAt };

  const existing = await loadCompositionDraft(input);
  if (existing) {
    return {
      created: false,
      path: existing.path,
      studioRunId: run.id,
      codeChars: existing.draft.code.length,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const storyboard = await readJson<StoryboardArtifact>(run.artifacts.storyboard?.path, input.supabase, input.userId);
  const script = await readJson<ScriptArtifact>(run.artifacts.script?.path, input.supabase, input.userId);
  const design = buildStudioCompositionScaffold({ run, storyboard, script });
  const saved = await persistCompositionDraft({
    projectId: input.projectId,
    userId: input.userId,
    supabase: input.supabase,
    design,
  });
  if (!saved.success) throw new Error(`Composition scaffold autosave failed: ${saved.error}`);
  return {
    created: true,
    path: saved.path,
    studioRunId: run.id,
    codeChars: design.code.length,
    elapsedMs: Date.now() - startedAt,
  };
}

