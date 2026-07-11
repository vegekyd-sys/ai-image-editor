import { describe, expect, it } from 'vitest';
import {
  approveStudioStage,
  createStudioRun,
  getStudioArtifactJsonSchema,
  parseStudioRun,
  putPersistedStudioArtifacts,
  putStudioArtifact,
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
      { id: 'a', title: 'One Brief', hook: 'One sentence', visualDirection: 'Signal map', motionLanguage: 'Branch and converge', themeConnection: 'One brief visibly coordinates every studio stage', visualForm: 'system choreography', visualFit: { themeSpecificity: 5, recognitionSpeed: 4, motionPotential: 5, productionEfficiency: 4 } },
      { id: 'b', title: 'Two Doors', hook: 'Human and agent', visualDirection: 'Split screen', motionLanguage: 'Parallel tracks', themeConnection: 'A creator chooses between manual and orchestrated work', visualForm: 'spatial reveal', visualFit: { themeSpecificity: 3, recognitionSpeed: 4, motionPotential: 3, productionEfficiency: 5 } },
    ],
    selectedConceptId: 'a', rationale: 'Most direct product story', estimatedCostUsd: 0,
    creativeMode: 'directed',
    creativeTreatmentVersion: 2,
    creativeTreatment: {
      thesis: 'Turn one brief into visible creative momentum',
      themeEvidence: ['one brief', 'script, frame, and rhythm stages'],
      evidenceMapping: [
        { evidence: 'one brief', visibleCue: 'a page stack', motionRole: 'fans into production tracks' },
        { evidence: 'review', visibleCue: 'review marks on a film frame', motionRole: 'locks the tracks into delivery' },
      ],
      bestVisualForm: 'system choreography',
      formRationale: 'The product coordinates a studio, so coordinated rails make the benefit visible',
      rejectedForms: ['journey map is too generic', 'character behavior hides the workflow'],
      visualFit: { themeSpecificity: 5, recognitionSpeed: 4, motionPotential: 5, productionEfficiency: 4 },
      visualMechanism: 'A signal branches into authored scenes and converges as a finished film',
      signatureFrame: 'One bright brief line crossing a field of finished visual worlds',
      rhythm: 'Quiet signal, accelerating branches, confident final lockup',
      materialSystem: 'Ink black, electric accents, editorial type, crisp kinetic rails',
      contrastPlan: ['single line to full field', 'small prompt to cinematic frame'],
      antiCliches: ['dashboard cards', 'floating feature pills', 'generic purple glow'],
    },
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
    assets: [{ id: 'spark', type: 'image', path: 'public/brand/makaron-spark-mark.png', source: 'project-owned', sceneIds: ['scene-1'], status: 'ready', costUsd: 0 }],
  },
  composition: {
    version: '1.0', runtime: 'remotion', mode: 'editable', designPath: 'code/makaron.json', width: 1920, height: 1080,
    fps: 30, durationSeconds: 50, sceneIds: ['scene-1'], previewFramePaths: ['a.png', 'b.png', 'c.png'], editable: true,
  },
  review: {
    version: '1.0', outputPath: 'outputs/final.mp4', status: 'pass',
    technical: { validContainer: true, durationSeconds: 50, resolution: '1920x1080', fps: 30, hasAudio: true },
    visual: { framesSampled: 3, contactSheetPath: 'outputs/contact.png', blackFramesDetected: false, missingAssets: false, unreadableText: false, overlapDetected: false, themeFidelity: true, signatureFrameAchieved: true, visualFormFit: true, visibleThemeEvidenceCount: 2, genericShapeRisk: false },
    audio: { integratedLufs: -14, truePeakDbfs: -2, unexpectedSilence: false, narrationPresent: true, musicPresent: true },
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
  it('runs the complete auto-approved explainer pipeline and records approvals', () => {
    let run = makeRun('auto');
    for (const stage of ['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition', 'review', 'delivery'] as StudioStageId[]) {
      run = put(run, stage).run;
    }
    expect(run.status).toBe('completed');
    expect(run.currentStage).toBeNull();
    expect(run.decisions.filter(decision => decision.category === 'approval')).toHaveLength(5);
    expect(parseStudioRun(JSON.stringify(run))).toEqual(run);
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

  it('refuses a passing review built from generic shapes without visible theme evidence', () => {
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
          visibleThemeEvidenceCount: 1,
          genericShapeRisk: true,
        },
      },
      artifactPath: 'generic-review.json',
      now,
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
    expect(proposal.properties).toHaveProperty('creativeMode');
    expect(proposal.properties).toHaveProperty('creativeTreatmentVersion');
    expect(proposal.properties).toHaveProperty('creativeTreatment');
    const treatment = proposal.properties?.creativeTreatment as {
      properties?: Record<string, unknown>;
    };
    expect(treatment.properties).toHaveProperty('themeEvidence');
    expect(treatment.properties).toHaveProperty('evidenceMapping');
    expect(treatment.properties).toHaveProperty('bestVisualForm');
    expect(treatment.properties).toHaveProperty('visualFit');
    const concepts = proposal.properties?.concepts as {
      items?: { properties?: Record<string, unknown> };
    };
    expect(concepts.items?.properties).toHaveProperty('themeConnection');
    expect(concepts.items?.properties).toHaveProperty('visualForm');
    expect(concepts.items?.properties).toHaveProperty('visualFit');

    const composition = getStudioArtifactJsonSchema('composition') as {
      required?: string[];
    };
    expect(composition.required).toEqual(expect.arrayContaining([
      'designPath', 'width', 'height', 'fps', 'durationSeconds', 'previewFramePaths',
    ]));

    const review = getStudioArtifactJsonSchema('review') as {
      properties?: { visual?: { properties?: { framesSampled?: { minimum?: number } } } };
    };
    expect(review.properties?.visual?.properties?.framesSampled?.minimum).toBe(3);
    expect(review.properties?.visual?.properties).toHaveProperty('visibleThemeEvidenceCount');
    expect(review.properties?.visual?.properties).toHaveProperty('genericShapeRisk');

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
