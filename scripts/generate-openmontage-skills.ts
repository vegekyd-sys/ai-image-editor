import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  OPENMONTAGE_SKILL_CATALOG,
  type OpenMontageSkillCatalogEntry,
  type OpenMontageSkillFamily,
} from '../src/lib/openmontage-skill-catalog';

const root = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(root, 'src', 'skills');
const preservedHandAuthoredSkills = new Set(['character-animation', 'localization-dub', 'screen-demo']);

const familyConfig: Record<OpenMontageSkillFamily, {
  icon: string;
  tools: string[];
  direction: string;
  completion: string;
}> = {
  audio: {
    icon: '♪',
    tools: ['read_file', 'analyze_image', 'generate_image', 'list_voiceover_voices', 'generate_voiceover', 'transcribe_audio', 'generate_audio', 'generate_music', 'run_code', 'write_file'],
    direction: 'Preserve timing, language, performance, loudness, and edit intent. Use Makaron voice, music, sound, transcription, and FFmpeg primitives; never claim an unavailable external provider was used.',
    completion: 'Return a durable audio asset or a composition that uses it, with timing and source recorded.',
  },
  character: {
    icon: '人',
    tools: ['read_file', 'studio_run', 'analyze_image', 'analyze_video', 'generate_image', 'generate_audio', 'generate_music', 'list_voiceover_voices', 'generate_voiceover', 'run_code', 'write_file', 'preview_frame', 'materialize_media'],
    direction: 'Lock the character spec, layer order, pivots, poses, expressions, and action beats before animation. Prefer frame-driven SVG, Canvas, or Remotion motion and inspect representative poses.',
    completion: 'Deliver the reusable character source plus sampled frames and, when requested, the materialized MP4.',
  },
  composition: {
    icon: '✦',
    tools: ['read_file', 'studio_run', 'analyze_image', 'analyze_video', 'generate_image', 'generate_audio', 'generate_music', 'list_voiceover_voices', 'generate_voiceover', 'transcribe_audio', 'run_code', 'write_file', 'preview_frame', 'materialize_media'],
    direction: 'Translate the source craft into deterministic frame-driven Remotion. Use injected React, Remotion, and THREE primitives; external animation APIs are guidance unless Makaron explicitly exposes them.',
    completion: 'Deliver an editable composition, preview the hook/body/ending, then materialize once.',
  },
  image: {
    icon: '▧',
    tools: ['read_file', 'analyze_image', 'generate_image', 'list_voiceover_voices', 'generate_voiceover', 'transcribe_audio', 'run_code', 'write_file'],
    direction: 'Apply the source prompting and reference discipline through Makaron image models. Respect the selected model; if the named external provider is unavailable, state the native replacement before generation.',
    completion: 'Deliver the generated or edited image with reference intent preserved and no false provider claim.',
  },
  media: {
    icon: '⌁',
    tools: ['read_file', 'analyze_video', 'transcribe_audio', 'run_code', 'write_file', 'preview_frame', 'materialize_media'],
    direction: 'Use the Node media runtime and FFmpeg/FFprobe for exact file operations. Probe once, transform once, publish existing workspace output instead of re-running work.',
    completion: 'Deliver a real probed file with the requested duration, dimensions, streams, and timeline publication.',
  },
  quality: {
    icon: '✓',
    tools: ['read_file', 'analyze_image', 'analyze_video', 'generate_image', 'run_code', 'write_file', 'preview_frame'],
    direction: 'Treat the source skill as a review and art-direction lens. Turn findings into concrete corrections for hierarchy, distinctness, readability, motion, accessibility, or performance.',
    completion: 'Return prioritized findings or apply and verify the requested corrections.',
  },
  'video-generation': {
    icon: '▶',
    tools: ['read_file', 'analyze_image', 'analyze_video', 'generate_image', 'generate_animation', 'transcribe_audio', 'run_code', 'write_file'],
    direction: 'Use Makaron video models and their real reference limits. With no source, call generate_animation as native text-to-video; with images, use image/reference-to-video; with a video, use the supported video-edit route. Submit once. Preserve the requested provider when supported; otherwise disclose the mapped native model and do not silently substitute.',
    completion: 'Return a submitted or completed video with the selected model, duration, references, and next action made explicit.',
  },
  'video-workflow': {
    icon: '◫',
    tools: ['read_file', 'studio_run', 'analyze_video', 'analyze_image', 'transcribe_audio', 'generate_image', 'generate_animation', 'generate_audio', 'generate_music', 'list_voiceover_voices', 'generate_voiceover', 'run_code', 'write_file', 'preview_frame', 'materialize_media'],
    direction: 'Run the full Studio Run contract for substantial work. Preserve source evidence, make production choices explicit, and use the canonical Makaron workflow for execution.',
    completion: 'Complete all applicable stages with an editable source, reviewed MP4, and delivery artifact.',
  },
};

const specialRules: Record<string, string> = {
  'ai-video-gen': 'Choose the Makaron model from the user request or active app selection, keep duration/aspect/reference count within that model contract, and submit one generation without inventing an intermediate image.',
  'avatar-spokesperson': 'Use a supplied presenter image/video when available. Makaron can create presenter-led video, voiceover, captions, and compositing; do not promise exact phoneme lip sync unless the selected provider exposes it.',
  'avatar-video': 'Use a supplied presenter image/video when available and keep identity stable. Exact HeyGen avatar controls are not implied by this adapter.',
  'bfl-api': 'Reuse FLUX prompting ideas, structured references, typography discipline, and color constraints through an available Makaron image model; do not claim BFL API execution.',
  'comfyui': 'Route Qwen, Pony, and WAI requests through Makaron\'s existing ComfyUI-backed image models. Arbitrary custom graph upload and unregistered nodes are outside this adapter.',
  'create-video': 'Treat prompt-only generation as first-class. Do not require a source image and do not ask for a second confirmation when the current request already authorizes generation.',
  'dashscope': 'Map DashScope image intent to the Qwen image route, TTS intent to voiceover generation, and timestamped ASR intent to transcription. State that Makaron owns the provider route and do not claim direct DashScope endpoint execution.',
  'faceswap': 'Require explicit source identity and target media. Prefer reference-video editing, preserve duration, and review multiple frames for identity drift.',
  'flux-best-practices': 'Reuse FLUX prompt craft through an available Makaron image model; model-specific FLUX endpoints and parameters are not exposed.',
  'gsap-scrolltrigger': 'For video, convert scroll progress into deterministic frame progress; do not depend on a live page scroll position during rendering.',
  'ltx2': 'Preserve the requested shot and motion intent through an available Makaron video model; do not claim LTX-2 execution.',
  'music-to-video': 'Require an Audio Index item or uploaded track. Analyze duration and beats once, build the visual timeline from that grid, and keep the original track authoritative.',
  'playwright-recording': 'Use uploaded capture when available. If browser capture is unavailable in the current runtime, switch only to an explicitly labeled synthetic UI/terminal mode or request a recording.',
  'seedance-2-0': 'Map standard/full/premium Seedance 2.0 to model `seedance`, fast to `seedance-fast`, and low-cost draft/mini to `seedance-mini`. Seedance supports native text-to-video, image references, video references, and audio references within Makaron capability limits.',
  'website-to-video': 'Treat the website as source evidence. Use supplied screen recording/screenshots and brand assets; when only a URL is present and capture is unavailable, request one capture rather than inventing the interface.',
};

const workflowSections: Record<string, string> = {
  'avatar-spokesperson': `## Production Modes

- **source-presenter**: edit supplied presenter footage while keeping speech authoritative.
- **generated-presenter**: animate a supplied identity image with an approved voice/script.
- **voiceover-composite**: use presenter visuals plus timed voiceover and captions when exact lip sync is unavailable.

Lock identity, language, voice, framing, duration, and lip-sync expectation in the brief. Prove one representative line before a long or paid generation, then review face consistency, mouth behavior, captions, and audio timing.`,
  'music-to-video': `## Audio-Led Workflow

Probe the track once and record duration, sections, major beats, energy changes, and any lyric cues. Build the script and storyboard on that timing grid. Use Remotion \`Audio\` with the original track, drive motion from \`useCurrentFrame\`, and keep cuts and kinetic type subordinate to the music. Review three representative frames covering the opening, strongest contrast, and ending before materialization.`,
  'website-to-video': `## Site-Led Workflow

Choose **real-capture**, **screenshot-led**, or clearly labeled **synthetic-ui** mode. Put the user outcome in the opening three seconds, preserve the site's actual brand and interface, and storyboard actions rather than feature claims. Never imply synthetic UI is a real capture. Keep source text readable at delivery size and review every crop, zoom, callout, and final CTA.`,
};

function titleCase(value: string): string {
  return value.split('-').map(part => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ');
}

function skillMarkdown(entry: OpenMontageSkillCatalogEntry): string {
  const family = familyConfig[entry.family];
  const selectable = entry.userSelectable === true;
  const requiredReading = ['Follow this adapter before using tools.'];
  const directAdapterFamilies: OpenMontageSkillFamily[] = ['audio', 'image', 'quality', 'video-generation'];
  if (entry.canonicalSkill && entry.canonicalSkill !== entry.name && !directAdapterFamilies.includes(entry.family)) {
    requiredReading.push(`Read \`skills/${entry.canonicalSkill}/SKILL.md\` and use it as the execution contract.`);
  }
  if (entry.studioRunRecipe) {
    requiredReading.push('Read `skills/_shared/studio-production/production-contract.md` before starting substantial production.');
  }
  const special = specialRules[entry.name] ? `\n- ${specialRules[entry.name]}` : '';
  const recipeRule = entry.studioRunRecipe
    ? `\n- Start recipe \`${entry.studioRunRecipe}\` and keep that recipe id through delivery.`
    : '';
  const workflowSection = workflowSections[entry.name] ? `\n\n${workflowSections[entry.name]}` : '';
  const tags = [
    'openmontage',
    entry.sourceKind,
    entry.family,
    entry.supportLevel,
    ...(entry.studioRunRecipe ? ['video', 'workflow', 'studio-run', 'remotion'] : []),
  ];
  const studioMeta = entry.studioRunRecipe ? `
    studioRunRecipe: "${entry.studioRunRecipe}"
    studioRunProfile: "${entry.studioRunProfile}"
    sourceMediaRequired: ${entry.sourceMediaRequired === true}` : '';

  return `---
name: ${entry.name}
description: >
  Makaron adapter with ${entry.supportLevel} support for OpenMontage's ${entry.name}
  ${entry.sourceKind === 'pipeline' ? 'production pipeline' : 'craft skill'}, using existing Makaron tools and durable project outputs.
allowed-tools: ${family.tools.join(' ')}
metadata:
  makaron:
    icon: "${family.icon}"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: ${selectable}
    manifestVisible: ${selectable}
    sourceProject: "openmontage"
    sourceSkill: "${entry.name}"
    sourceKind: "${entry.sourceKind}"
    supportLevel: "${entry.supportLevel}"
    adapterFamily: "${entry.family}"
    canonicalSkill: "${entry.canonicalSkill || entry.name}"${studioMeta}
    tags: [${tags.join(', ')}]
---

# ${titleCase(entry.name)}

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

${requiredReading.map((item, index) => `${index + 1}. ${item}`).join('\n')}

## Execution Contract

- ${family.direction}${recipeRule}${special}
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview three representative frames, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

${family.completion}
${workflowSection}
`.trimEnd() + '\n';
}

let created = 0;
let skipped = 0;
for (const entry of OPENMONTAGE_SKILL_CATALOG) {
  if (entry.supportLevel !== 'native' && entry.supportLevel !== 'adapted') continue;
  const dir = path.join(skillsRoot, entry.name);
  const target = path.join(dir, 'SKILL.md');
  if (preservedHandAuthoredSkills.has(entry.name) && existsSync(target)) {
    skipped += 1;
    continue;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, skillMarkdown(entry), 'utf8');
  created += 1;
}

console.log(JSON.stringify({ created, skipped }));
