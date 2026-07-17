import { describe, expect, it } from 'vitest';
import {
  approveStudioStage,
  completeStudioRunFromMaterialization,
  assertCompositionSubtitleTextAuthored,
  assertSubtitleSyncEvidence,
  assertSubtitleVisualReviewEvidence,
  assertStoryboardNarrationTimingEvidence,
  createStudioRun,
  getStudioArtifactJsonSchema,
  normalizeStudioDeliveryArtifact,
  parseStudioRun,
  putPersistedStudioArtifacts,
  putStudioArtifact,
  startPersistedStudioRun,
  studioArtifactSchemas,
  type StudioRunStore,
  type StudioRun,
  type StudioStageId,
  studioArtifactPath,
  studioRunStatePath,
} from '@/lib/studio-run';

const now = '2026-07-10T00:00:00.000Z';

function makeRun(policy: 'auto' | 'guided' = 'auto'): StudioRun {
  return createStudioRun({
    id: 'run-1',
    projectId: 'project-1',
    recipe: 'explainer-video',
    title: 'Makaron One Man Studio',
    approvalPolicy: policy,
    deliveryPromise: {
      durationSeconds: 50,
      width: 1920,
      height: 1080,
      fps: 30,
      renderRuntime: 'remotion',
      compositionMode: 'editable',
      audioRequired: true,
      subtitlesRequired: false,
    },
    now,
  });
}

const artifacts: Record<StudioStageId, unknown> = {
  brief: {
    version: '1.0', title: 'Makaron', objective: 'Explain the product', audience: 'Creators',
    coreMessage: 'One brief becomes a studio', language: 'zh-CN', durationSeconds: 50, aspectRatio: '16:9',
  },
  proposal: {
    version: '1.0',
    concepts: [
      { id: 'a', title: 'One Brief', hook: 'One sentence', visualDirection: 'Signal map', motionLanguage: 'Branch and converge' },
      { id: 'b', title: 'Two Doors', hook: 'Human and agent', visualDirection: 'Split screen', motionLanguage: 'Parallel tracks' },
    ],
    selectedConceptId: 'a', rationale: 'Most direct product story', estimatedCostUsd: 0,
    deliveryPromise: makeRun().deliveryPromise,
  },
  script: {
    version: '1.0', title: 'Makaron', totalDurationSeconds: 50,
    sections: [{ id: 's1', startSeconds: 0, endSeconds: 50, narration: 'Narration', onScreenText: ['Makaron'] }],
  },
  storyboard: {
    version: '1.0', artDirection: 'Dark editorial signal system', layoutContract: 'One focal point', subtitleSafeArea: 'Bottom 15 percent clear',
    scenes: [{ id: 'scene-1', startSeconds: 0, endSeconds: 50, purpose: 'Explain', focalPoint: 'Spark', visualTreatment: 'Branching rails', transitionOut: 'fade', assetIds: ['spark'] }],
  },
  assets: {
    version: '1.0', totalCostUsd: 0, missingAssetIds: [],
    assets: [
      { id: 'spark', type: 'image', path: 'public/brand/makaron-spark-mark.png', source: 'project-owned', sceneIds: ['scene-1'], status: 'ready', costUsd: 0 },
      { id: 'voice', type: 'audio', path: 'audio/voice.mp3', source: 'generated', sceneIds: ['scene-1'], status: 'ready', costUsd: 0 },
    ],
  },
  composition: {
    version: '1.0', runtime: 'remotion', mode: 'editable', designPath: 'code/makaron.json', width: 1920, height: 1080,
    fps: 30, durationSeconds: 50, sceneIds: ['scene-1'], previewFramePaths: ['a.png', 'b.png', 'c.png'],
    draftGate: { expectedDurationFrames: 1500, timelineDurationFrames: 1500, boundaryFramesChecked: 0, endingFrameChecked: true, audioSources: 'resolved', visualPlanChecked: true, underfilledSceneIds: [], subtitleSyncEvidence: [], unresolvedIssues: [] },
    editable: true,
  },
  review: {
    version: '1.0', outputPath: 'outputs/final.mp4', status: 'pass',
    technical: { validContainer: true, durationSeconds: 50, resolution: '1920x1080', fps: 30, hasAudio: true },
    visual: { framesSampled: 3, contactSheetPath: 'outputs/contact.png', blackFramesDetected: false, missingAssets: false, unreadableText: false, overlapDetected: false, subjectNamed: true, storyArcComplete: true, endingResolves: true, visualPlanHonored: true, underfilledFramesDetected: false, subtitleNarrationVisualAligned: true, subtitleVisualEvidence: [] },
    audio: { integratedLufs: -14, truePeakDbfs: -2, unexpectedSilence: false, narrationPresent: true, musicPresent: true, soundDesignPresent: true, audioSupportsStory: true },
    runtimePromiseHonored: true, issues: [],
  },
  delivery: {
    version: '1.0', outputPath: 'outputs/final.mp4', editableSourcePath: 'code/makaron.json',
    sha256: 'a'.repeat(64), deliveredAt: '2026-07-10T00:10:00.000Z',
  },
};

function put(run: StudioRun, stage: StudioStageId, time = now) {
  return putStudioArtifact({
    run,
    stage,
    artifact: artifacts[stage],
    artifactPath: `project-1/studio-runs/run-1/artifacts/${stage}.json`,
    now: time,
  });
}

describe('Studio Run controller', () => {
  it('reuses a matching fresh run when the Agent corrects its approval policy', async () => {
    const runs: StudioRun[] = [];
    const store: StudioRunStore = {
      async saveRun(run) {
        const index = runs.findIndex(candidate => candidate.id === run.id);
        if (index >= 0) runs[index] = run;
        else runs.push(run);
        return studioRunStatePath(run.projectId, run.id);
      },
      async saveArtifact() { return 'unused.json'; },
      async loadRun(projectId, runId) {
        return runs.find(run => run.projectId === projectId && run.id === runId) || null;
      },
      async listRuns(projectId) {
        return runs.filter(run => run.projectId === projectId);
      },
    };
    const deliveryPromise = makeRun().deliveryPromise;

    const guided = await startPersistedStudioRun({
      store,
      projectId: 'project-1',
      recipe: 'explainer-video',
      title: 'First attempt',
      approvalPolicy: 'guided',
      deliveryPromise,
    });
    const auto = await startPersistedStudioRun({
      store,
      projectId: 'project-1',
      recipe: 'explainer-video',
      title: 'Corrected attempt',
      approvalPolicy: 'auto',
      deliveryPromise,
    });

    expect(auto.id).toBe(guided.id);
    expect(auto.approvalPolicy).toBe('auto');
    expect(auto.title).toBe('Corrected attempt');
    expect(runs).toHaveLength(1);
  });

  it('derives mechanical Delivery fields from reviewed Studio artifacts', () => {
    expect(normalizeStudioDeliveryArtifact({
      candidate: { version: '2.0', outputPath: 'wrong/media.mp4', deliveredAt: 'not-a-date' },
      reviewedOutputPath: 'project/media/final.mp4',
      compositionDesignPath: 'project/drafts/latest-composition.json',
      now,
    })).toEqual({
      version: '1.0',
      outputPath: 'project/media/final.mp4',
      editableSourcePath: 'project/drafts/latest-composition.json',
      deliveredAt: now,
    });
  });

  it('accepts an honest unmeasured loudness result', () => {
    const baseReview = artifacts.review as Record<string, unknown>;
    const baseAudio = baseReview.audio as Record<string, unknown>;
    const review = {
      ...baseReview,
      audio: { ...baseAudio, integratedLufs: null, truePeakDbfs: null },
    };
    expect(() => studioArtifactSchemas.review.parse(review)).not.toThrow();
  });

  it('runs the complete auto-approved explainer pipeline and records approvals', () => {
    let run = makeRun('auto');
    for (const stage of ['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition', 'review', 'delivery'] as StudioStageId[]) {
      run = put(run, stage).run;
    }
    expect(run.status).toBe('completed');
    expect(run.currentStage).toBeNull();
    expect(run.decisions.filter(decision => decision.category === 'approval')).toHaveLength(4);
    expect(parseStudioRun(JSON.stringify(run))).toEqual(run);
  });

  it('projects Review and Delivery atomically from successful materialization', () => {
    let run = makeRun('auto');
    for (const stage of ['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition'] as StudioStageId[]) {
      run = put(run, stage).run;
    }

    const result = completeStudioRunFromMaterialization({
      run,
      outputPath: 'https://cdn.example.com/final.mp4',
      compositionDesignPath: 'code/makaron.json',
      artifactPath: 'project-1/studio-runs/run-1/artifacts/delivery.v1.json',
      now,
    });

    expect(result.run.status).toBe('completed');
    expect(result.run.currentStage).toBeNull();
    expect(result.run.stages.review.status).toBe('completed');
    expect(result.run.artifacts.review).toBeUndefined();
    expect(result.run.stages.delivery.status).toBe('completed');
    expect(result.run.artifacts.delivery?.path).toBe('project-1/studio-runs/run-1/artifacts/delivery.v1.json');
    expect(result.artifact).toMatchObject({
      outputPath: 'https://cdn.example.com/final.mp4',
      editableSourcePath: 'code/makaron.json',
      deliveredAt: now,
    });

    const repeated = completeStudioRunFromMaterialization({
      run: result.run,
      outputPath: 'https://cdn.example.com/final.mp4',
      compositionDesignPath: 'code/makaron.json',
      artifactPath: 'ignored.json',
      now,
    });
    expect(repeated.run).toEqual(result.run);
    expect(repeated.ref).toEqual(result.ref);
  });

  it('stops a guided run at approval and resumes after explicit approval', () => {
    let run = makeRun('guided');
    run = put(run, 'brief').run;
    run = put(run, 'proposal').run;
    expect(run.status).toBe('awaiting_approval');
    expect(() => put(run, 'script')).toThrow(/incomplete dependencies proposal/);
    run = approveStudioStage({ run, stage: 'proposal', now });
    expect(run.status).toBe('running');
    expect(run.currentStage).toBe('script');
  });

  it('invalidates only downstream artifacts when an upstream artifact changes', () => {
    let run = makeRun('auto');
    for (const stage of ['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition'] as StudioStageId[]) {
      run = put(run, stage).run;
    }
    const result = put(run, 'script', '2026-07-10T00:05:00.000Z');
    expect(result.invalidated).toEqual(['storyboard', 'assets', 'composition']);
    expect(result.run.stages.proposal.status).toBe('completed');
    expect(result.run.stages.script.status).toBe('completed');
    expect(result.run.stages.storyboard.status).toBe('invalidated');
    expect(result.run.artifacts.storyboard).toBeUndefined();
    expect(result.run.currentStage).toBe('storyboard');
  });

  it('rejects artifacts that skip dependencies or fail their contract', () => {
    const run = makeRun('auto');
    expect(() => put(run, 'script')).toThrow(/incomplete dependencies proposal/);
    expect(() => putStudioArtifact({
      run,
      stage: 'brief',
      artifact: { version: '1.0' },
      artifactPath: 'bad.json',
      now,
    })).toThrow();
  });

  it('blocks composition until the first draft covers every boundary and ending frame', () => {
    const composition = artifacts.composition as Record<string, unknown>;
    expect(() => studioArtifactSchemas.composition.parse({
      ...composition,
      sceneIds: ['scene-1', 'scene-2', 'scene-3'],
      draftGate: {
        expectedDurationFrames: 1500,
        timelineDurationFrames: 1444,
        boundaryFramesChecked: 1,
        endingFrameChecked: false,
        audioSources: 'resolved',
        visualPlanChecked: false,
        underfilledSceneIds: ['scene-2'],
        subtitleSyncEvidence: [{
          scriptSectionId: 's1',
          sceneId: 'scene-1',
          visualStartSeconds: 0,
          visualEndSeconds: 10,
          narrationStartSeconds: 0,
          narrationEndSeconds: 10,
          representativeFrameSeconds: 12,
          subtitleText: 'Narration',
          timingSource: 'transcribe_audio',
        }],
        unresolvedIssues: ['black transition frame'],
      },
    })).toThrow(/timelineDurationFrames|scene boundary|final visible frame|representativeFrameSeconds|resolve draft issues/);
  });

  it('cross-checks subtitle timing evidence against Script and Storyboard instead of trusting a boolean', () => {
    const script = {
      sections: [
        { id: 'video', narration: '再让画面动起来', onScreenText: ['生成视频'] },
        { id: 'audio', narration: '也让声音加入故事', onScreenText: ['生成音乐'] },
      ],
    };
    const storyboard = {
      scenes: [
        { id: 'video-scene', startSeconds: 8.8, endSeconds: 12.2 },
        { id: 'audio-scene', startSeconds: 12.2, endSeconds: 16 },
      ],
      narrationTimingEvidence: [
        {
          scriptSectionId: 'video', sceneId: 'video-scene', narrationStartSeconds: 9.02,
          narrationEndSeconds: 11.78, timingSource: 'transcribe_audio' as const,
        },
        {
          scriptSectionId: 'audio', sceneId: 'audio-scene', narrationStartSeconds: 12.42,
          narrationEndSeconds: 15.66, timingSource: 'transcribe_audio' as const,
        },
      ],
    };
    const aligned = [
      {
        scriptSectionId: 'video', sceneId: 'video-scene', visualStartSeconds: 8.8, visualEndSeconds: 12.2,
        narrationStartSeconds: 9.02, narrationEndSeconds: 11.78, representativeFrameSeconds: 10.4,
        subtitleText: '再让画面动起来',
        timingSource: 'transcribe_audio' as const,
      },
      {
        scriptSectionId: 'audio', sceneId: 'audio-scene', visualStartSeconds: 12.2, visualEndSeconds: 16,
        narrationStartSeconds: 12.42, narrationEndSeconds: 15.66, representativeFrameSeconds: 14,
        subtitleText: '也让声音加入故事',
        timingSource: 'transcribe_audio' as const,
      },
    ];

    expect(() => assertSubtitleSyncEvidence({
      required: true,
      script,
      storyboard,
      compositionSceneIds: ['video-scene', 'audio-scene'],
      evidence: aligned,
    })).not.toThrow();

    expect(() => assertSubtitleSyncEvidence({
      required: true,
      script,
      storyboard: {
        scenes: [
          { id: 'video-scene', startSeconds: 10, endSeconds: 15 },
          { id: 'audio-scene', startSeconds: 15, endSeconds: 20.5 },
        ],
        narrationTimingEvidence: storyboard.narrationTimingEvidence,
      },
      compositionSceneIds: ['video-scene', 'audio-scene'],
      evidence: aligned,
    })).toThrow(/does not match Storyboard|starts before scene/);
  });

  it('allows either faithful narration or concise text authored for the same Script section', () => {
    const script = {
      sections: [{
        id: 'sound',
        narration: '配上专属音乐和音效，作品眨时有了灵魂。',
        onScreenText: ['声音魔法'],
      }],
    };
    const storyboard = {
      scenes: [{ id: 'sound-scene', startSeconds: 20, endSeconds: 25 }],
      narrationTimingEvidence: [{
        scriptSectionId: 'sound', sceneId: 'sound-scene', narrationStartSeconds: 20.2,
        narrationEndSeconds: 24.5, timingSource: 'transcribe_audio' as const,
      }],
    };
    const evidence = {
      scriptSectionId: 'sound', sceneId: 'sound-scene', visualStartSeconds: 20, visualEndSeconds: 25,
      narrationStartSeconds: 20.2, narrationEndSeconds: 24.5, representativeFrameSeconds: 22,
      subtitleText: '配上专属音乐和音效，作品瞬间有了灵魂。',
      timingSource: 'transcribe_audio' as const,
    };

    expect(() => assertSubtitleSyncEvidence({
      required: true,
      script,
      storyboard,
      compositionSceneIds: ['sound-scene'],
      evidence: [evidence],
    })).not.toThrow();
    expect(() => assertSubtitleSyncEvidence({
      required: true,
      script,
      storyboard,
      compositionSceneIds: ['sound-scene'],
      evidence: [{ ...evidence, subtitleText: '声音魔法' }],
    })).not.toThrow();
    expect(() => assertSubtitleSyncEvidence({
      required: true,
      script,
      storyboard,
      compositionSceneIds: ['sound-scene'],
      evidence: [{ ...evidence, subtitleText: '无限创意' }],
    })).toThrow(/Script section's authored on-screen text/);
  });

  it('requires claimed subtitle text to exist in the saved Composition source', () => {
    const evidence = [{
      scriptSectionId: 'video', sceneId: 'video-scene', visualStartSeconds: 8.8, visualEndSeconds: 12.2,
      narrationStartSeconds: 9.02, narrationEndSeconds: 11.78, representativeFrameSeconds: 10.4,
      subtitleText: '再让画面动起来', timingSource: 'transcribe_audio' as const,
    }];

    expect(() => assertCompositionSubtitleTextAuthored({
      evidence,
      design: { code: 'function Composition() {}', props: { captions: ['再让画面动起来'] } },
    })).not.toThrow();
    expect(() => assertCompositionSubtitleTextAuthored({
      evidence,
      design: { code: 'function Composition() {}', props: { title: '视频生成' } },
    })).toThrow(/not authored in the saved Composition/);
  });

  it('blocks Storyboard before Assets when real narration falls outside its linked scene', () => {
    const script = {
      sections: [{ id: 'music', narration: '让声音加入故事', onScreenText: ['生成音乐'] }],
    };
    const aligned = {
      scenes: [{ id: 'music-scene', startSeconds: 12.2, endSeconds: 16 }],
      narrationTimingEvidence: [{
        scriptSectionId: 'music', sceneId: 'music-scene', narrationStartSeconds: 12.42,
        narrationEndSeconds: 15.66, timingSource: 'transcribe_audio' as const,
      }],
    };
    expect(() => assertStoryboardNarrationTimingEvidence({ required: true, script, storyboard: aligned })).not.toThrow();
    expect(() => assertStoryboardNarrationTimingEvidence({
      required: true,
      script,
      storyboard: {
        scenes: [{ id: 'music-scene', startSeconds: 15, endSeconds: 20.5 }],
        narrationTimingEvidence: aligned.narrationTimingEvidence,
      },
    })).toThrow(/starts before Storyboard scene/);
  });

  it('requires Review to describe the observed picture instead of trusting a semantic boolean', () => {
    const compositionEvidence = [{
      scriptSectionId: 'video', sceneId: 'video-scene', visualStartSeconds: 8.8, visualEndSeconds: 12.2,
      narrationStartSeconds: 9.02, narrationEndSeconds: 11.78, representativeFrameSeconds: 10.4,
      subtitleText: '让画面动起来',
      timingSource: 'transcribe_audio' as const,
    }];
    const aligned = [{
      scriptSectionId: 'video', sceneId: 'video-scene', representativeFrameSeconds: 10.4,
      framePath: 'project-1/drafts/video-final-t10-40.jpg', displayedText: '让画面动起来',
      observedVisualContent: '胶片角色推动一段正在播放的画面', alignment: 'pass' as const,
    }];

    expect(() => assertSubtitleVisualReviewEvidence({
      required: true,
      compositionEvidence,
      reviewEvidence: aligned,
    })).not.toThrow();
    expect(() => assertSubtitleVisualReviewEvidence({
      required: true,
      compositionEvidence,
      reviewEvidence: [{ ...aligned[0], observedVisualContent: '让画面动起来' }],
    })).toThrow(/non-text picture/);
    expect(() => assertSubtitleVisualReviewEvidence({
      required: true,
      compositionEvidence,
      reviewEvidence: [],
    })).toThrow(/requires exactly one/);
    expect(() => assertSubtitleVisualReviewEvidence({
      required: true,
      compositionEvidence,
      reviewEvidence: [{ ...aligned[0], displayedText: 'Bring your ideas to life in video' }],
    })).toThrow(/must match Composition subtitleText/);
    expect(() => assertSubtitleVisualReviewEvidence({
      required: true,
      compositionEvidence,
      reviewEvidence: [{ ...aligned[0], framePath: 'project-1/drafts/design-contact-frame.jpg' }],
    })).toThrow(/must come from previewing the final MP4/);
  });

  it('refuses a passing final review with failed visual checks', () => {
    let run = makeRun('auto');
    for (const stage of ['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition'] as StudioStageId[]) {
      run = put(run, stage).run;
    }
    expect(() => putStudioArtifact({
      run,
      stage: 'review',
      artifact: {
        ...(artifacts.review as Record<string, unknown>),
        visual: {
          ...(artifacts.review as any).visual,
          overlapDetected: true,
        },
      },
      artifactPath: 'review.json',
      now,
    })).toThrow(/passing review/);
  });

  it('refuses a visual study that does not finish the story or support it with audio', () => {
    let run = makeRun('auto');
    for (const stage of ['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition'] as StudioStageId[]) {
      run = put(run, stage).run;
    }
    expect(() => putStudioArtifact({
      run,
      stage: 'review',
      artifact: {
        ...(artifacts.review as Record<string, unknown>),
        visual: { ...(artifacts.review as any).visual, subjectNamed: false, storyArcComplete: false, endingResolves: false },
        audio: { ...(artifacts.review as any).audio, audioSupportsStory: false },
      },
      artifactPath: 'incomplete-story-review.json',
      now,
    })).toThrow(/passing review/);
  });

  it('rejects missing promised audio, editable JSON delivery, and underfilled visual reviews', () => {
    let run = makeRun('auto');
    for (const stage of ['brief', 'proposal', 'script', 'storyboard'] as StudioStageId[]) run = put(run, stage).run;
    expect(() => putStudioArtifact({
      run,
      stage: 'assets',
      artifact: {
        ...(artifacts.assets as Record<string, unknown>),
        assets: [(artifacts.assets as any).assets[0]],
      },
      artifactPath: 'assets-without-audio.json',
      now,
    })).toThrow('assets does not honor delivery promise: required audio asset');

    expect(() => studioArtifactSchemas.review.parse({
      ...(artifacts.review as Record<string, unknown>),
      outputPath: 'code/editable-composition.json',
    })).toThrow(/materialized MP4/);
    expect(() => studioArtifactSchemas.delivery.parse({
      ...(artifacts.delivery as Record<string, unknown>),
      outputPath: 'code/editable-composition.json',
    })).toThrow(/materialized MP4/);
    expect(() => studioArtifactSchemas.review.parse({
      ...(artifacts.review as Record<string, unknown>),
      visual: {
        ...(artifacts.review as any).visual,
        visualPlanHonored: false,
        underfilledFramesDetected: true,
        subtitleNarrationVisualAligned: false,
      },
    })).toThrow(/passing review/);
  });

  it('enforces the locked delivery promise at composition and review', () => {
    let run = makeRun();
    for (const stage of ['brief', 'proposal', 'script', 'storyboard', 'assets'] as StudioStageId[]) run = put(run, stage).run;
    expect(() => putStudioArtifact({
      run,
      stage: 'composition',
      artifact: { ...(artifacts.composition as object), width: 1080, height: 1920 },
      artifactPath: 'wrong-composition.json',
      now,
    })).toThrow('composition does not honor delivery promise: resolution');

    run = put(run, 'composition').run;
    expect(() => putStudioArtifact({
      run,
      stage: 'review',
      artifact: {
        ...(artifacts.review as object),
        technical: { ...(artifacts.review as any).technical, durationSeconds: 47 },
      },
      artifactPath: 'wrong-review.json',
      now,
    })).toThrow('review does not honor delivery promise: review duration');
  });

  it('blocks delivery until final review passes and clears stale completion time when reopened', () => {
    let run = makeRun();
    for (const stage of ['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition'] as StudioStageId[]) run = put(run, stage).run;
    run = putStudioArtifact({
      run,
      stage: 'review',
      artifact: { ...(artifacts.review as object), status: 'revise', issues: ['Tighten scene four'] },
      artifactPath: 'review-revise.json',
      now,
    }).run;
    expect(run.status).toBe('failed');
    expect(() => put(run, 'delivery')).toThrow('incomplete dependencies review');

    run = putStudioArtifact({ run, stage: 'review', artifact: artifacts.review, artifactPath: 'review-pass.json', now }).run;
    run = put(run, 'delivery').run;
    expect(run.completedAt).toBe(now);
    run = putStudioArtifact({ run, stage: 'brief', artifact: artifacts.brief, artifactPath: 'brief-v2.json', now }).run;
    expect(run.status).toBe('running');
    expect(run.completedAt).toBeUndefined();
  });

  it('uses project-scoped workspace paths for resumable state and versioned artifacts', () => {
    expect(studioRunStatePath('project-1', 'run-1')).toBe('project-1/studio-runs/run-1/run.json');
    expect(studioArtifactPath('project-1', 'run-1', 'script', 2)).toBe(
      'project-1/studio-runs/run-1/artifacts/script.v2.json',
    );
  });

  it('publishes machine-readable schemas for every stage', () => {
    const storyboard = getStudioArtifactJsonSchema('storyboard') as {
      properties?: { scenes?: { items?: { required?: string[] } } };
    };
    expect('~standard' in storyboard).toBe(false);
    expect(Object.getPrototypeOf(storyboard)).toBe(Object.prototype);
    expect(storyboard.properties?.scenes?.items?.required).toContain('focalPoint');

    const proposal = getStudioArtifactJsonSchema('proposal') as {
      properties?: Record<string, unknown>;
    };
    expect(proposal.properties).toHaveProperty('concepts');
    expect(proposal.properties).not.toHaveProperty('creativeTreatment');

    const composition = getStudioArtifactJsonSchema('composition') as {
      required?: string[];
    };
    expect(composition.required).toEqual(expect.arrayContaining([
      'designPath', 'width', 'height', 'fps', 'durationSeconds', 'previewFramePaths', 'draftGate',
    ]));

    const review = getStudioArtifactJsonSchema('review') as {
      properties?: { visual?: { properties?: { framesSampled?: { minimum?: number } } } };
    };
    expect(review.properties?.visual?.properties?.framesSampled?.minimum).toBe(3);
    expect(review.properties?.visual?.properties).toHaveProperty('storyArcComplete');

    const delivery = getStudioArtifactJsonSchema('delivery') as {
      required?: string[];
    };
    expect(delivery.required).not.toContain('sha256');
  });

  it('allows delivery without computing an output SHA', () => {
    let run = makeRun('auto');
    for (const stage of ['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition', 'review'] as StudioStageId[]) {
      run = put(run, stage).run;
    }
    const { sha256: _sha256, ...deliveryWithoutSha } = artifacts.delivery as Record<string, unknown>;
    const result = putStudioArtifact({
      run,
      stage: 'delivery',
      artifact: deliveryWithoutSha,
      artifactPath: 'delivery.json',
      now,
    });
    expect(result.run.status).toBe('completed');
  });

  it('persists a contiguous auto-approved planning batch stage by stage', async () => {
    const savedStages: StudioStageId[] = [];
    const store: StudioRunStore = {
      async saveRun() { return 'run.json'; },
      async saveArtifact(_run, stage) { savedStages.push(stage); return `${stage}.json`; },
      async loadRun() { return null; },
      async listRuns() { return []; },
    };
    const run = makeRun('auto');
    const stages = ['brief', 'proposal', 'script', 'storyboard', 'assets'] as StudioStageId[];
    const result = await putPersistedStudioArtifacts({
      store,
      run,
      artifacts: stages.map(stage => ({ stage, artifact: artifacts[stage] })),
    });

    expect(savedStages).toEqual(stages);
    expect(result.updates).toHaveLength(5);
    expect(result.updates.map(update => update.run.currentStage)).toEqual([
      'proposal', 'script', 'storyboard', 'assets', 'composition',
    ]);
    expect(result.run.currentStage).toBe('composition');
  });

  it('refuses batch persistence for guided runs or non-contiguous stages', async () => {
    const store: StudioRunStore = {
      async saveRun() { return 'run.json'; },
      async saveArtifact() { return 'artifact.json'; },
      async loadRun() { return null; },
      async listRuns() { return []; },
    };
    await expect(putPersistedStudioArtifacts({
      store,
      run: makeRun('guided'),
      artifacts: [{ stage: 'brief', artifact: artifacts.brief }],
    })).rejects.toThrow(/only available for auto-approved/);
    await expect(putPersistedStudioArtifacts({
      store,
      run: makeRun('auto'),
      artifacts: [{ stage: 'proposal', artifact: artifacts.proposal }],
    })).rejects.toThrow(/expected brief, received proposal/);
  });

  it('preflights the full batch before writing any artifact', async () => {
    const savedStages: StudioStageId[] = [];
    const store: StudioRunStore = {
      async saveRun() { return 'run.json'; },
      async saveArtifact(_run, stage) { savedStages.push(stage); return `${stage}.json`; },
      async loadRun() { return null; },
      async listRuns() { return []; },
    };

    await expect(putPersistedStudioArtifacts({
      store,
      run: makeRun('auto'),
      artifacts: [
        { stage: 'brief', artifact: artifacts.brief },
        { stage: 'proposal', artifact: {} },
      ],
    })).rejects.toThrow();
    expect(savedStages).toEqual([]);
  });
});
