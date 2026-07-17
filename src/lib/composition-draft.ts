import type { SupabaseClient } from '@supabase/supabase-js';
import type { DesignPayload } from '@/types';
import * as workspace from './workspace';

const DRAFT_VERSION = '1.0' as const;

export interface CompositionDraftMetadata {
  version: typeof DRAFT_VERSION;
  savedAt: string;
  sourceDesignPath?: string;
}

export interface PersistedCompositionDraft extends DesignPayload {
  description?: string;
  __makaronDraft: CompositionDraftMetadata;
}

export function compositionDraftPath(projectId: string): string {
  return `${projectId}/drafts/latest-composition.json`;
}

export function createPersistedCompositionDraft(
  design: DesignPayload & { description?: string },
  options: { savedAt?: string; sourceDesignPath?: string } = {},
): PersistedCompositionDraft {
  return {
    ...design,
    __makaronDraft: {
      version: DRAFT_VERSION,
      savedAt: options.savedAt || new Date().toISOString(),
      ...(options.sourceDesignPath ? { sourceDesignPath: options.sourceDesignPath } : {}),
    },
  };
}

export function parsePersistedCompositionDraft(value: unknown): PersistedCompositionDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Partial<PersistedCompositionDraft>;
  if (
    typeof draft.code !== 'string' ||
    !draft.code.trim() ||
    typeof draft.width !== 'number' ||
    !Number.isFinite(draft.width) ||
    typeof draft.height !== 'number' ||
    !Number.isFinite(draft.height) ||
    draft.__makaronDraft?.version !== DRAFT_VERSION ||
    typeof draft.__makaronDraft.savedAt !== 'string'
  ) {
    return null;
  }
  return draft as PersistedCompositionDraft;
}

export async function persistCompositionDraft(options: {
  projectId: string;
  userId: string;
  supabase: SupabaseClient;
  design: DesignPayload & { description?: string };
  sourceDesignPath?: string;
}): Promise<{ success: true; path: string; draft: PersistedCompositionDraft } | { success: false; path: string; error: string }> {
  const path = compositionDraftPath(options.projectId);
  const draft = createPersistedCompositionDraft(options.design, {
    sourceDesignPath: options.sourceDesignPath,
  });
  const content = JSON.stringify(draft, null, 2);

  let lastError = 'unknown workspace error';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await workspace.writeFile(path, content, options.supabase, options.userId, 'application/json');
    if (result.success) return { success: true, path, draft };
    lastError = result.error || lastError;
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 150));
  }
  return { success: false, path, error: lastError };
}

export async function loadCompositionDraft(options: {
  projectId: string;
  userId: string;
  supabase: SupabaseClient;
}): Promise<{ path: string; draft: PersistedCompositionDraft } | null> {
  const path = compositionDraftPath(options.projectId);
  try {
    const file = await workspace.readFile(path, options.supabase, options.userId);
    if (!file) return null;
    const draft = parsePersistedCompositionDraft(JSON.parse(file.content));
    return draft ? { path, draft } : null;
  } catch {
    return null;
  }
}
