import type { SupabaseClient } from '@supabase/supabase-js';
import type { DesignPayload } from '@/types';
import {
  assembleCompositionParts,
  compositionPartsPrefix,
  decodeCompositionPartContent,
  type CompositionPartSource,
} from './composition-parts';
import {
  loadCompositionDraft,
  persistCompositionDraft,
  type PersistedCompositionDraft,
} from './composition-draft';
import { normalizeCompositionAnimation } from './composition-duration';
import { validateDesignDiagnostics, type DesignResult } from './design-harness';
import { resolveMediaMarkersInString, resolveMediaMarkersInValue } from './media-markers';
import * as workspace from './workspace';

const WORKSPACE_STATE_VERSION = '1.0' as const;

interface CompositionWorkspaceState {
  version: typeof WORKSPACE_STATE_VERSION;
  workspaceId: string;
  partPaths: string[];
  metadata?: CompositionWorkspaceMetadata;
  updatedAt: string;
  lastCompile?: {
    status: 'ready' | 'invalid';
    at: string;
    totalChars: number;
    diagnostics: string[];
    designPath?: string;
  };
}

export interface CompositionWorkspaceMetadata {
  width?: number;
  height?: number;
  props?: Record<string, unknown>;
  editables?: DesignPayload['editables'];
  animation?: DesignPayload['animation'];
  fontSubstitutions?: DesignPayload['fontSubstitutions'];
  description?: string;
}

export type CompositionWorkspaceCompileResult =
  | {
      status: 'waiting';
      partPaths: string[];
      totalChars: number;
      message: string;
    }
  | {
      status: 'invalid';
      partPaths: string[];
      totalChars: number;
      diagnostics: string[];
      message: string;
    }
  | {
      status: 'ready';
      partPaths: string[];
      totalChars: number;
      designPath: string;
      design: PersistedCompositionDraft;
      message: string;
    };

export function compositionWorkspaceStatePath(projectId: string): string {
  return `${projectId}/drafts/composition-workspace.json`;
}

function parseWorkspaceState(value: unknown): CompositionWorkspaceState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Partial<CompositionWorkspaceState>;
  if (
    state.version !== WORKSPACE_STATE_VERSION
    || typeof state.workspaceId !== 'string'
    || !Array.isArray(state.partPaths)
    || !state.partPaths.every(path => typeof path === 'string')
    || typeof state.updatedAt !== 'string'
  ) {
    return null;
  }
  return state as CompositionWorkspaceState;
}

async function readWorkspaceState(input: {
  projectId: string;
  userId: string;
  supabase: SupabaseClient;
}): Promise<CompositionWorkspaceState | null> {
  try {
    const file = await workspace.readFile(
      compositionWorkspaceStatePath(input.projectId),
      input.supabase,
      input.userId,
    );
    return file ? parseWorkspaceState(JSON.parse(file.content)) : null;
  } catch {
    return null;
  }
}

async function writeWorkspaceState(input: {
  projectId: string;
  userId: string;
  supabase: SupabaseClient;
  state: CompositionWorkspaceState;
}): Promise<void> {
  const saved = await workspace.writeFile(
    compositionWorkspaceStatePath(input.projectId),
    JSON.stringify(input.state, null, 2),
    input.supabase,
    input.userId,
    'application/json',
  );
  if (!saved.success) {
    throw new Error(`Composition workspace state write failed: ${saved.error || 'unknown error'}`);
  }
}

async function readParts(input: {
  partPaths: string[];
  userId: string;
  supabase: SupabaseClient;
}): Promise<CompositionPartSource[]> {
  const parts: CompositionPartSource[] = [];
  for (const path of input.partPaths) {
    const file = await workspace.readFile(path, input.supabase, input.userId);
    if (!file) throw new Error(`Composition part not found: ${path}`);
    parts.push({ path, content: file.content });
  }
  return parts;
}

function buildWorkspaceDesign(input: {
  base?: PersistedCompositionDraft;
  code: string;
  snapshotImages: string[];
  metadata?: CompositionWorkspaceMetadata;
}): DesignPayload & { description?: string } {
  const resolvedCode = resolveMediaMarkersInString(input.code, input.snapshotImages);
  const resolvedProps = resolveMediaMarkersInValue(
    input.metadata?.props ?? input.base?.props,
    input.snapshotImages,
  ) as Record<string, unknown> | undefined;
  const baseRecord = input.base as (PersistedCompositionDraft & Record<string, unknown>) | undefined;
  const width = input.metadata?.width ?? input.base?.width;
  const height = input.metadata?.height ?? input.base?.height;
  if (!width || !height) {
    throw new Error('Composition metadata must provide positive width and height on the first numbered source file.');
  }
  const design: DesignPayload & Record<string, unknown> = {
    ...(input.base ?? {}),
    code: resolvedCode,
    width,
    height,
    props: resolvedProps,
    animation: normalizeCompositionAnimation(
      resolvedCode,
      input.metadata?.animation ?? input.base?.animation,
    ),
    ...((input.metadata?.editables ?? input.base?.editables)
      ? { editables: input.metadata?.editables ?? input.base?.editables }
      : {}),
    ...((input.metadata?.fontSubstitutions ?? input.base?.fontSubstitutions)
      ? { fontSubstitutions: input.metadata?.fontSubstitutions ?? input.base?.fontSubstitutions }
      : {}),
    description: input.metadata?.description || (baseRecord?.__makaronScaffold === true
      ? 'Composition workspace draft assembled from durable source files'
      : input.base?.description),
  };
  delete design.__makaronDraft;
  delete design.__makaronScaffold;
  return design as DesignPayload & { description?: string };
}

function hasCompositionEntrypoint(code: string): boolean {
  const functionNames = Array.from(
    code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g),
    match => match[1],
  );
  const arrowNames = Array.from(
    code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g),
    match => match[1],
  );
  return [...functionNames, ...arrowNames].some(name => (
    ['Composition', 'Design', 'AgentDesign', 'DevLog', 'App', 'Main'].includes(name)
    || /(?:Composition|Design)$/.test(name)
  ));
}

/**
 * Register a saved numbered source file and compile the complete workspace.
 * This is intentionally stage-agnostic: Studio Run and normal Agent Run can
 * share the same save -> compile -> autosave loop.
 */
export async function compileSavedCompositionPart(input: {
  projectId: string;
  userId: string;
  supabase: SupabaseClient;
  workspaceId: string;
  partPath: string;
  snapshotImages: string[];
  metadata?: CompositionWorkspaceMetadata;
}): Promise<CompositionWorkspaceCompileResult> {
  const prefix = compositionPartsPrefix(input.projectId);
  if (!input.partPath.startsWith(prefix)) {
    throw new Error(`Composition part must be stored under ${prefix}`);
  }

  const previous = await readWorkspaceState(input);
  const previousMetadata = previous?.workspaceId === input.workspaceId
    ? previous.metadata
    : undefined;
  const partPaths = previous?.workspaceId === input.workspaceId
    ? [...new Set([...previous.partPaths, input.partPath])]
    : [input.partPath];
  const state: CompositionWorkspaceState = {
    version: WORKSPACE_STATE_VERSION,
    workspaceId: input.workspaceId,
    partPaths,
    metadata: input.metadata
      ? { ...previousMetadata, ...input.metadata }
      : previousMetadata,
    updatedAt: new Date().toISOString(),
  };

  // Persist registration before compiling so a worker handoff cannot forget
  // the file that just closed successfully.
  await writeWorkspaceState({ ...input, state });

  if (partPaths.length < 2) {
    const firstPart = await workspace.readFile(input.partPath, input.supabase, input.userId);
    const totalChars = firstPart
      ? decodeCompositionPartContent(firstPart.content).trim().length
      : 0;
    return {
      status: 'waiting',
      partPaths,
      totalChars,
      message: 'Source saved. Waiting for another numbered composition part before compiling.',
    };
  }

  let assembled: ReturnType<typeof assembleCompositionParts>;
  try {
    assembled = assembleCompositionParts({
      projectId: input.projectId,
      parts: await readParts({
        partPaths,
        userId: input.userId,
        supabase: input.supabase,
      }),
    });
  } catch (error) {
    const diagnostics = [error instanceof Error ? error.message : String(error)];
    state.lastCompile = {
      status: 'invalid',
      at: new Date().toISOString(),
      totalChars: 0,
      diagnostics,
    };
    await writeWorkspaceState({ ...input, state });
    return {
      status: 'invalid',
      partPaths,
      totalChars: 0,
      diagnostics,
      message: `Source saved. Compilation found ${diagnostics.length} blocking issue.`,
    };
  }

  const baseDraft = await loadCompositionDraft(input);
  let design: DesignPayload & { description?: string };
  try {
    design = buildWorkspaceDesign({
      base: baseDraft?.draft,
      code: assembled.code,
      snapshotImages: input.snapshotImages,
      metadata: state.metadata,
    });
  } catch (error) {
    const diagnostics = [error instanceof Error ? error.message : String(error)];
    state.lastCompile = {
      status: 'invalid',
      at: new Date().toISOString(),
      totalChars: assembled.totalChars,
      diagnostics,
    };
    await writeWorkspaceState({ ...input, state });
    return {
      status: 'invalid',
      partPaths: assembled.paths,
      totalChars: assembled.totalChars,
      diagnostics,
      message: 'Source saved. Compilation needs complete composition metadata.',
    };
  }
  const diagnostics = [
    ...(!hasCompositionEntrypoint(design.code)
      ? ['Composition source has no root entry component yet. Add a root named Composition, Design, App, Main, or a name ending in Composition/Design.']
      : []),
    ...validateDesignDiagnostics(design as unknown as DesignResult),
  ];
  if (diagnostics.length) {
    state.lastCompile = {
      status: 'invalid',
      at: new Date().toISOString(),
      totalChars: assembled.totalChars,
      diagnostics,
    };
    await writeWorkspaceState({ ...input, state });
    return {
      status: 'invalid',
      partPaths: assembled.paths,
      totalChars: assembled.totalChars,
      diagnostics,
      message: `Source saved. Compilation found ${diagnostics.length} blocking issue${diagnostics.length === 1 ? '' : 's'}.`,
    };
  }

  const saved = await persistCompositionDraft({
    projectId: input.projectId,
    userId: input.userId,
    supabase: input.supabase,
    design,
    sourceDesignPath: compositionWorkspaceStatePath(input.projectId),
  });
  if (!saved.success) {
    const diagnostics = [`Composition compiled but autosave failed: ${saved.error}`];
    state.lastCompile = {
      status: 'invalid',
      at: new Date().toISOString(),
      totalChars: assembled.totalChars,
      diagnostics,
    };
    await writeWorkspaceState({ ...input, state });
    return {
      status: 'invalid',
      partPaths: assembled.paths,
      totalChars: assembled.totalChars,
      diagnostics,
      message: diagnostics[0],
    };
  }

  state.partPaths = assembled.paths;
  state.updatedAt = new Date().toISOString();
  state.lastCompile = {
    status: 'ready',
    at: state.updatedAt,
    totalChars: assembled.totalChars,
    diagnostics: [],
    designPath: saved.path,
  };
  await writeWorkspaceState({ ...input, state });

  return {
    status: 'ready',
    partPaths: assembled.paths,
    totalChars: assembled.totalChars,
    designPath: saved.path,
    design: saved.draft,
    message: `Composition compiled from ${assembled.paths.length} files (${assembled.totalChars} chars) and autosaved to ${saved.path}.`,
  };
}
