export interface SubtitleSyncEvidence {
  scriptSectionId: string;
  sceneId: string;
  visualStartSeconds: number;
  visualEndSeconds: number;
  narrationStartSeconds: number;
  narrationEndSeconds: number;
  representativeFrameSeconds: number;
  subtitleText: string;
  timingSource: 'transcribe_audio' | 'explicit-audio-placement';
}

export interface StoryboardNarrationTimingEvidence {
  scriptSectionId: string;
  sceneId: string;
  narrationStartSeconds: number;
  narrationEndSeconds: number;
  timingSource: 'transcribe_audio' | 'explicit-audio-placement';
}

export interface SubtitleVisualReviewEvidence {
  scriptSectionId: string;
  sceneId: string;
  representativeFrameSeconds: number;
  framePath: string;
  displayedText: string;
  observedVisualContent: string;
  alignment: 'pass' | 'fail';
}

interface TimedScriptSection {
  id: string;
  narration: string;
  onScreenText: string[];
}

interface TimedStoryboardScene {
  id: string;
  startSeconds: number;
  endSeconds: number;
}

export function assertStoryboardNarrationTimingEvidence(input: {
  required: boolean;
  script: { sections: TimedScriptSection[] };
  storyboard: {
    scenes: TimedStoryboardScene[];
    narrationTimingEvidence?: StoryboardNarrationTimingEvidence[];
  };
  syncToleranceSeconds?: number;
}): void {
  if (!input.required) return;

  const tolerance = input.syncToleranceSeconds ?? 0.35;
  const scenesById = new Map(input.storyboard.scenes.map(scene => [scene.id, scene]));
  const narratedSections = input.script.sections.filter(section => section.narration.trim().length > 0);
  const sectionIds = new Set(input.script.sections.map(section => section.id));
  const evidence = input.storyboard.narrationTimingEvidence ?? [];
  const evidenceBySection = new Map<string, StoryboardNarrationTimingEvidence[]>();
  const issues: string[] = [];

  for (const item of evidence) {
    const entries = evidenceBySection.get(item.scriptSectionId) ?? [];
    entries.push(item);
    evidenceBySection.set(item.scriptSectionId, entries);
    if (!sectionIds.has(item.scriptSectionId)) {
      issues.push(`timing evidence references unknown Script section ${item.scriptSectionId}`);
    }
    const scene = scenesById.get(item.sceneId);
    if (!scene) {
      issues.push(`timing evidence references unknown Storyboard scene ${item.sceneId}`);
      continue;
    }
    if (item.narrationStartSeconds < scene.startSeconds - tolerance) {
      issues.push(`narration for ${item.scriptSectionId} starts before Storyboard scene ${item.sceneId}`);
    }
    if (item.narrationEndSeconds > scene.endSeconds + tolerance) {
      issues.push(`narration for ${item.scriptSectionId} ends after Storyboard scene ${item.sceneId}`);
    }
  }

  for (const section of narratedSections) {
    if (section.onScreenText.length === 0) {
      issues.push(`Script section ${section.id} has narration but no authored on-screen text`);
    }
    if ((evidenceBySection.get(section.id) ?? []).length !== 1) {
      issues.push(`Script section ${section.id} requires exactly one Storyboard narration timing record`);
    }
  }
  if (evidence.length !== narratedSections.length) {
    issues.push(`Storyboard narration timing must cover all ${narratedSections.length} narrated Script sections`);
  }

  if (issues.length > 0) {
    throw new Error(`Storyboard narration timing evidence failed: ${issues.join('; ')}`);
  }
}

function nearlyEqual(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

export function assertSubtitleSyncEvidence(input: {
  required: boolean;
  script: { sections: TimedScriptSection[] };
  storyboard: {
    scenes: TimedStoryboardScene[];
    narrationTimingEvidence?: StoryboardNarrationTimingEvidence[];
  };
  compositionSceneIds: string[];
  evidence: SubtitleSyncEvidence[];
  visualToleranceSeconds?: number;
  syncToleranceSeconds?: number;
}): void {
  if (!input.required) return;

  const visualTolerance = input.visualToleranceSeconds ?? 0.05;
  const syncTolerance = input.syncToleranceSeconds ?? 0.35;
  const narratedSections = input.script.sections.filter(section => section.narration.trim().length > 0);
  const sectionsById = new Map(input.script.sections.map(section => [section.id, section]));
  const scenesById = new Map(input.storyboard.scenes.map(scene => [scene.id, scene]));
  const storyboardTiming = new Map(
    (input.storyboard.narrationTimingEvidence ?? []).map(item => [item.scriptSectionId, item]),
  );
  const evidenceBySection = new Map<string, SubtitleSyncEvidence[]>();
  const issues: string[] = [];

  for (const item of input.evidence) {
    const entries = evidenceBySection.get(item.scriptSectionId) ?? [];
    entries.push(item);
    evidenceBySection.set(item.scriptSectionId, entries);

    if (!sectionsById.has(item.scriptSectionId)) {
      issues.push(`evidence references unknown Script section ${item.scriptSectionId}`);
    } else {
      const section = sectionsById.get(item.scriptSectionId)!;
      const normalizedSubtitle = normalizedEvidenceText(item.subtitleText);
      const authoredSceneText = section.onScreenText.some(text => (
        normalizedEvidenceText(text) === normalizedSubtitle
      ));
      if (!isFaithfulNarrationRendering(item.subtitleText, section.narration) && !authoredSceneText) {
        issues.push(
          `subtitleText for ${item.scriptSectionId} must preserve its narration or use that Script section's authored on-screen text`,
        );
      }
    }
    const plannedNarration = storyboardTiming.get(item.scriptSectionId);
    if (!plannedNarration) {
      issues.push(`Storyboard is missing narration timing for ${item.scriptSectionId}`);
    } else if (
      plannedNarration.sceneId !== item.sceneId
      || !nearlyEqual(plannedNarration.narrationStartSeconds, item.narrationStartSeconds, visualTolerance)
      || !nearlyEqual(plannedNarration.narrationEndSeconds, item.narrationEndSeconds, visualTolerance)
      || plannedNarration.timingSource !== item.timingSource
    ) {
      issues.push(`Composition narration timing for ${item.scriptSectionId} does not match Storyboard evidence`);
    }
    const scene = scenesById.get(item.sceneId);
    if (!scene) {
      issues.push(`evidence references unknown Storyboard scene ${item.sceneId}`);
      continue;
    }
    if (!input.compositionSceneIds.includes(item.sceneId)) {
      issues.push(`evidence scene ${item.sceneId} is missing from Composition sceneIds`);
    }
    if (
      !nearlyEqual(item.visualStartSeconds, scene.startSeconds, visualTolerance)
      || !nearlyEqual(item.visualEndSeconds, scene.endSeconds, visualTolerance)
    ) {
      issues.push(`evidence visual range for ${item.sceneId} does not match Storyboard ${scene.startSeconds}-${scene.endSeconds}s`);
    }
    if (item.narrationStartSeconds < item.visualStartSeconds - syncTolerance) {
      issues.push(`narration for ${item.scriptSectionId} starts before scene ${item.sceneId}`);
    }
    if (item.narrationEndSeconds > item.visualEndSeconds + syncTolerance) {
      issues.push(`narration for ${item.scriptSectionId} ends after scene ${item.sceneId}`);
    }
    const overlapStart = Math.max(item.visualStartSeconds, item.narrationStartSeconds);
    const overlapEnd = Math.min(item.visualEndSeconds, item.narrationEndSeconds);
    if (
      overlapEnd < overlapStart
      || item.representativeFrameSeconds < overlapStart - visualTolerance
      || item.representativeFrameSeconds > overlapEnd + visualTolerance
    ) {
      issues.push(`representative frame for ${item.scriptSectionId} is not inside both its narration and visual beat`);
    }
  }

  for (const section of narratedSections) {
    if (section.onScreenText.length === 0) {
      issues.push(`Script section ${section.id} has narration but no authored on-screen text`);
    }
    const entries = evidenceBySection.get(section.id) ?? [];
    if (entries.length !== 1) {
      issues.push(`Script section ${section.id} requires exactly one subtitle sync evidence record`);
    }
  }

  if (input.evidence.length !== narratedSections.length) {
    issues.push(`subtitle sync evidence must cover all ${narratedSections.length} narrated Script sections`);
  }

  if (issues.length > 0) {
    throw new Error(`Composition subtitle sync evidence failed: ${issues.join('; ')}`);
  }
}

function normalizedEvidenceText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function isFaithfulNarrationRendering(subtitleText: string, narration: string): boolean {
  const displayed = normalizedEvidenceText(subtitleText);
  const authored = normalizedEvidenceText(narration);
  if (!displayed || !authored) return false;
  if (displayed === authored) return true;
  const shorterLength = Math.min(displayed.length, authored.length);
  if (shorterLength >= 4 && (displayed.includes(authored) || authored.includes(displayed))) return true;
  const similarity = 1 - editDistance(displayed, authored) / Math.max(displayed.length, authored.length);
  return similarity >= 0.72;
}

function collectAuthoredStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAuthoredStrings(item, output);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAuthoredStrings(item, output);
  }
}

export function assertCompositionSubtitleTextAuthored(input: {
  evidence: SubtitleSyncEvidence[];
  design: unknown;
}): void {
  const authoredStrings: string[] = [];
  collectAuthoredStrings(input.design, authoredStrings);
  const normalizedAuthoredStrings = authoredStrings
    .map(normalizedEvidenceText)
    .filter(Boolean);
  const issues = input.evidence.flatMap(item => {
    const subtitle = normalizedEvidenceText(item.subtitleText);
    const present = subtitle.length > 0 && normalizedAuthoredStrings.some(authored => authored.includes(subtitle));
    return present
      ? []
      : [`subtitleText for ${item.scriptSectionId} is not authored in the saved Composition code, props, or editables`];
  });

  if (issues.length > 0) {
    throw new Error(`Composition subtitle source evidence failed: ${issues.join('; ')}`);
  }
}

export function assertSubtitleVisualReviewEvidence(input: {
  required: boolean;
  compositionEvidence: SubtitleSyncEvidence[];
  reviewEvidence: SubtitleVisualReviewEvidence[];
  frameToleranceSeconds?: number;
}): void {
  if (!input.required) return;

  const tolerance = input.frameToleranceSeconds ?? 0.05;
  const reviewBySection = new Map<string, SubtitleVisualReviewEvidence[]>();
  const issues: string[] = [];

  for (const item of input.reviewEvidence) {
    const entries = reviewBySection.get(item.scriptSectionId) ?? [];
    entries.push(item);
    reviewBySection.set(item.scriptSectionId, entries);

    const compositionItem = input.compositionEvidence.find(candidate => candidate.scriptSectionId === item.scriptSectionId);
    if (!compositionItem) {
      issues.push(`review evidence references unknown Composition section ${item.scriptSectionId}`);
      continue;
    }
    if (normalizedEvidenceText(item.displayedText) !== normalizedEvidenceText(compositionItem.subtitleText)) {
      issues.push(`displayedText for ${item.scriptSectionId} must match Composition subtitleText`);
    }
    if (!/(?:^|\/)drafts\/video-[^/]+\.(?:jpe?g|png)$/i.test(item.framePath)) {
      issues.push(`framePath for ${item.scriptSectionId} must come from previewing the final MP4`);
    }
    if (item.sceneId !== compositionItem.sceneId) {
      issues.push(`review evidence for ${item.scriptSectionId} does not match Composition scene ${compositionItem.sceneId}`);
    }
    if (!nearlyEqual(item.representativeFrameSeconds, compositionItem.representativeFrameSeconds, tolerance)) {
      issues.push(`review frame for ${item.scriptSectionId} does not match its Composition representative frame`);
    }
    if (item.alignment !== 'pass') {
      issues.push(`subtitle and picture are not aligned for ${item.scriptSectionId}`);
    }
    if (normalizedEvidenceText(item.displayedText) === normalizedEvidenceText(item.observedVisualContent)) {
      issues.push(`observedVisualContent for ${item.scriptSectionId} must describe the non-text picture, not repeat its subtitle`);
    }
  }

  for (const item of input.compositionEvidence) {
    if ((reviewBySection.get(item.scriptSectionId) ?? []).length !== 1) {
      issues.push(`Composition section ${item.scriptSectionId} requires exactly one subtitle visual review record`);
    }
  }
  if (input.reviewEvidence.length !== input.compositionEvidence.length) {
    issues.push(`subtitle visual review must cover all ${input.compositionEvidence.length} Composition subtitle records`);
  }

  if (issues.length > 0) {
    throw new Error(`Review subtitle visual evidence failed: ${issues.join('; ')}`);
  }
}
