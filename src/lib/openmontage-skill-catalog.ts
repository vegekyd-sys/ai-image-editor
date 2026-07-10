export type OpenMontageSkillFamily =
  | 'audio'
  | 'character'
  | 'composition'
  | 'image'
  | 'media'
  | 'quality'
  | 'video-generation'
  | 'video-workflow';

export type OpenMontageSupportLevel = 'native' | 'adapted' | 'excluded' | 'unavailable';

export interface OpenMontageSkillCatalogEntry {
  name: string;
  sourceKind: 'agent-skill' | 'pipeline';
  family: OpenMontageSkillFamily;
  supportLevel: OpenMontageSupportLevel;
  canonicalSkill?: string;
  reason?: string;
  userSelectable?: boolean;
  studioRunRecipe?: string;
  studioRunProfile?: string;
  sourceMediaRequired?: boolean;
}

const group = (
  names: string[],
  family: OpenMontageSkillFamily,
  canonicalSkill: string,
  supportLevel: 'native' | 'adapted' = 'adapted',
): OpenMontageSkillCatalogEntry[] => names.map(name => ({
  name,
  sourceKind: 'agent-skill',
  family,
  supportLevel,
  canonicalSkill,
}));

const excludedHyperFrames = [
  'hyperframes',
  'hyperframes-animation',
  'hyperframes-cli',
  'hyperframes-core',
  'hyperframes-creative',
  'hyperframes-media',
  'hyperframes-registry',
  'remotion-to-hyperframes',
] as const;

const agentSkills: OpenMontageSkillCatalogEntry[] = [
  ...group(['acestep', 'elevenlabs', 'music'], 'audio', 'music-to-video'),
  ...group(['doubao-tts', 'sound-effects', 'speech-to-text', 'text-to-speech'], 'audio', 'explainer-video', 'native'),
  ...group(['media-use'], 'audio', 'motion-design-video', 'native'),
  {
    name: 'music-to-video', sourceKind: 'agent-skill', family: 'video-workflow', supportLevel: 'native',
    canonicalSkill: 'music-to-video', userSelectable: true, studioRunRecipe: 'music-to-video',
    studioRunProfile: 'audio-led-local-animation', sourceMediaRequired: false,
  },
  ...group(['canvas-procedural-animation', 'character-animation-qa', 'character-rigging', 'pose-library-design', 'svg-character-animation'], 'character', 'character-animation', 'native'),
  ...group(['beautiful-mermaid', 'd3-viz', 'framer-motion', 'lottie-bodymovin'], 'composition', 'motion-design-video'),
  ...group(['gsap-core', 'gsap-frameworks', 'gsap-performance', 'gsap-plugins', 'gsap-react', 'gsap-scrolltrigger', 'gsap-timeline', 'gsap-utils'], 'composition', 'motion-design-video'),
  ...group(['manim-composer', 'manimce-best-practices', 'manimgl-best-practices'], 'composition', 'motion-design-video'),
  ...group(['motion-graphics', 'remotion', 'remotion-best-practices', 'synthetic-screen-recording'], 'composition', 'motion-design-video', 'native'),
  ...group(['tailwind-design-system', 'vercel-composition-patterns', 'vercel-react-best-practices'], 'composition', 'motion-design-video'),
  ...group(['threejs-animation', 'threejs-fundamentals', 'threejs-geometry', 'threejs-interaction', 'threejs-lighting', 'threejs-loaders', 'threejs-materials', 'threejs-postprocessing', 'threejs-shaders', 'threejs-textures'], 'composition', 'motion-design-video', 'native'),
  ...group(['bfl-api', 'flux-best-practices'], 'image', 'sticker-maker'),
  ...group(['comfyui'], 'image', 'sticker-maker', 'native'),
  ...group(['dashscope'], 'image', 'explainer-video'),
  ...group(['ffmpeg', 'video-download', 'video-edit'], 'media', 'video-ffmpeg-lab', 'native'),
  ...group(['video-understand'], 'media', 'source-video-studio', 'native'),
  ...group(['visual-style', 'web-design-guidelines'], 'quality', 'motion-design-video', 'native'),
  ...group(['ai-video-gen', 'create-video', 'seedance-2-0'], 'video-generation', 'photo-to-video', 'native'),
  ...group(['avatar-video', 'faceswap', 'heygen', 'ltx2', 'video-toolkit'], 'video-generation', 'photo-to-video'),
  ...group(['grok-media'], 'video-generation', 'photo-to-video', 'native'),
  ...group(['playwright-recording'], 'video-workflow', 'screen-demo'),
  ...group(['video-translate'], 'video-workflow', 'localization-dub', 'native'),
  {
    name: 'website-to-video', sourceKind: 'agent-skill', family: 'video-workflow', supportLevel: 'adapted',
    canonicalSkill: 'screen-demo', userSelectable: true, studioRunRecipe: 'website-to-video',
    studioRunProfile: 'site-led-remotion', sourceMediaRequired: false,
  },
  {
    name: 'agents', sourceKind: 'agent-skill', family: 'audio', supportLevel: 'unavailable',
    reason: 'OpenMontage uses this for real-time ElevenLabs voice agents; Makaron currently produces media and does not host interactive voice-agent sessions.',
  },
  {
    name: 'setup-api-key', sourceKind: 'agent-skill', family: 'audio', supportLevel: 'unavailable',
    reason: 'Makaron owns provider credentials server-side, so an end-user ElevenLabs MCP key-setup skill is intentionally not applicable.',
  },
  ...excludedHyperFrames.map(name => ({
    name,
    sourceKind: 'agent-skill' as const,
    family: 'composition' as const,
    supportLevel: 'excluded' as const,
    reason: 'Explicitly excluded: this migration does not add HyperFrames runtime or conversion paths.',
  })),
];

const pipeline = (
  name: string,
  canonicalSkill: string,
  profile: string,
  sourceMediaRequired: boolean,
  supportLevel: 'native' | 'adapted' = 'adapted',
  userSelectable = false,
): OpenMontageSkillCatalogEntry => ({
  name,
  sourceKind: 'pipeline',
  family: 'video-workflow',
  supportLevel,
  canonicalSkill,
  userSelectable,
  studioRunRecipe: name,
  studioRunProfile: profile,
  sourceMediaRequired,
});

const pipelines: OpenMontageSkillCatalogEntry[] = [
  pipeline('animated-explainer', 'explainer-video', 'generated-explainer', false),
  pipeline('animation', 'motion-design-video', 'local-animation', false),
  pipeline('avatar-spokesperson', 'avatar-spokesperson', 'generated-presenter', false, 'adapted', true),
  pipeline('character-animation', 'character-animation', 'local-character-animation', false, 'native', true),
  pipeline('cinematic', 'cinematic-video', 'generated-or-hybrid', false),
  pipeline('clip-factory', 'content-repurpose', 'batch-source-led', true),
  pipeline('documentary-montage', 'source-video-studio', 'source-led', true),
  pipeline('hybrid', 'source-video-studio', 'source-led', true),
  pipeline('localization-dub', 'localization-dub', 'source-led-variant', true, 'native', true),
  pipeline('podcast-repurpose', 'content-repurpose', 'batch-source-led', true),
  pipeline('screen-demo', 'screen-demo', 'capture-or-synthetic', false, 'native', true),
  pipeline('talking-head', 'source-video-studio', 'source-led', true),
  {
    name: 'framework-smoke', sourceKind: 'pipeline', family: 'video-workflow', supportLevel: 'unavailable',
    reason: 'Upstream framework test pipeline; retained in the coverage matrix but not exposed as a product workflow.',
  },
];

export const OPENMONTAGE_SKILL_CATALOG: OpenMontageSkillCatalogEntry[] = [...agentSkills, ...pipelines];

export const OPENMONTAGE_SOURCE_AGENT_SKILL_COUNT = 78;
export const OPENMONTAGE_SOURCE_PIPELINE_COUNT = 13;

export function getMigratedOpenMontageSkills(): OpenMontageSkillCatalogEntry[] {
  return OPENMONTAGE_SKILL_CATALOG.filter(entry => entry.supportLevel === 'native' || entry.supportLevel === 'adapted');
}

export function getOpenMontageCoverageSummary() {
  return OPENMONTAGE_SKILL_CATALOG.reduce<Record<OpenMontageSupportLevel, number>>((summary, entry) => {
    summary[entry.supportLevel] += 1;
    return summary;
  }, { native: 0, adapted: 0, excluded: 0, unavailable: 0 });
}
