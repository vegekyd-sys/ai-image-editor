export interface VideoReplicationCharacterRole {
  replacementMediaIndex: number;
  sourceActorAnchor: string;
  replacementIdentity: string;
}

export interface VideoReplicationObjectRole {
  replacementMediaIndex: number;
  sourceObjectAnchor: string;
  replacementObject: string;
}

export interface VideoReplicationEnvironmentRole {
  replacementMediaIndex: number;
  sourceEnvironmentAnchor: string;
  replacementEnvironment: string;
}

export interface VideoReplicationContract {
  referenceVideoMediaIndex: number;
  sourceDurationSeconds: number;
  characters?: VideoReplicationCharacterRole[];
  objects?: VideoReplicationObjectRole[];
  environment?: VideoReplicationEnvironmentRole;
  styleDirection?: string;
  additionalExclusions?: string[];
}

function mediaMarker(index: number) {
  return `<<<media_${index}>>>`;
}

/**
 * Compile the invariant-heavy provider prompt for exact source-led replication.
 * The Agent supplies measured semantic facts; runtime owns the fragile wording.
 */
export function compileVideoReplicationPrompt(
  request: string,
  contract: VideoReplicationContract,
) {
  const source = mediaMarker(contract.referenceVideoMediaIndex);
  const duration = contract.sourceDurationSeconds.toFixed(2).replace(/\.00$/, '');
  const characterMappings = (contract.characters || []).map((character, index) => [
    `ROLE ${index + 1}: In ${source}, identify the source performer by this stable evidence: ${character.sourceActorAnchor}.`,
    `Replace that whole performer with the exact identity, face, hair, body, clothing, colors, footwear, and accessories from ${mediaMarker(character.replacementMediaIndex)}: ${character.replacementIdentity}.`,
    'The source occupation or story role does not preserve the source costume unless the user explicitly requested that exception.',
    'Follow the performer through their actions and choreography. Never identify or remap this role only by left/right screen position, because performers can cross, turn, overlap, become occluded, fall, or reverse screen direction.',
  ].join(' ')).join('\n');

  const objectMappings = (contract.objects || []).map((object, index) => [
    `OBJECT ${index + 1}: In ${source}, identify the source object and its state progression by this stable evidence: ${object.sourceObjectAnchor}.`,
    `Replace it with the exact shape, material, color, construction, surface details, and distinctive features from ${mediaMarker(object.replacementMediaIndex)}: ${object.replacementObject}.`,
    'Keep that replacement object stable through handling, overlap, impact, damage, deformation, breakage, falling, and the final state. Preserve who interacts with it and its complete source trajectory and timing.',
  ].join(' ')).join('\n');

  const replacesEnvironment = contract.environment
    && contract.environment.replacementMediaIndex !== contract.referenceVideoMediaIndex;
  const environment = replacesEnvironment && contract.environment
    ? [
        `ENVIRONMENT: In ${source}, the source environment is: ${contract.environment.sourceEnvironmentAnchor}.`,
        `Replace the entire visible environment with ${mediaMarker(contract.environment.replacementMediaIndex)}: ${contract.environment.replacementEnvironment}.`,
        'Remove all source-background architecture, decoration, signage, props, lighting motifs, and scenery that conflict with the replacement, while preserving the reference camera geometry, performer spacing, floor contact, depth, lens perspective, and lighting continuity.',
      ].join(' ')
    : `ENVIRONMENT: Preserve the environment visible in ${source}, including its architecture, geometry, lighting continuity, depth, and spatial relationship to every performer and object.`;

  const exclusions = [
    'no new shots or extra cuts',
    'no omitted shot, action, impact, reaction, or pause',
    'no different opening or ending',
    'no new camera angle, lens, zoom, pan, tilt, dolly, orbit, or handheld motion',
    'no slow motion, speed ramp, freeze frame, montage, or time remapping unless visibly present in the reference',
    'no identity morphing, blending, duplication, costume drift, role swap, or transition back to a source performer',
    'no source garment or object property that conflicts with a replacement reference',
    'no reference-sheet, contact-sheet, multi-view board, or studio-background leakage',
    'no invented props, characters, text, logos, effects, or story events',
    ...(contract.additionalExclusions || []),
  ];

  const [titleLine = '', ...requestLines] = request.trim().split(/\r?\n/);
  const cleanTitle = titleLine.trim() || 'Exact Video Replication';
  const requestDirection = requestLines.join('\n').trim();
  const requestSection = requestDirection
    ? `\n\nMEASURED SHOTS, SOUND, AND REQUEST DIRECTION:\n${requestDirection}`
    : '';

  return `${cleanTitle}

Use ${source} as the sole and exact temporal performance, edit, composition, and camera authority for the full ${duration}-second output. Recreate the complete reference video beat for beat from its first visible frame through its final held state. Match the exact shot count and order, cut points, shot durations, transitions, camera path, lens perspective, framing changes, horizon, subject scale, screen direction, spatial relationships, choreography, footwork, body and object trajectories, gestures, contacts, impacts, reactions, pauses, motion blur, and outcome. Replacement media controls only the layers named below; it must not rewrite the reference action, timing, camera, editing, causality, or result.

${characterMappings}
${objectMappings ? `\n${objectMappings}` : ''}

IDENTITY AND CAUSALITY LOCK: Keep every replacement identity and object stable from first appearance to last appearance, including during profiles, rear views, fast motion, overlap, partial occlusion, contact, falls, smoke, and motion blur. Preserve who initiates and receives every action, who interacts with each object, who wins or loses, every travel direction, and the exact final poses and object state. Track identity by source appearance plus distinctive action and choreography, never by screen side alone.

${environment}

STRUCTURE LOCK: Copy the source continuity exactly. Keep every opening pose or state, preparation beat, anticipation, action, impact, recoil, recovery, crossing, transition, screen-position change, and ending hold at the same relative time. Preserve the original camera-to-subject relationship after replacement. Do not beautify, simplify, reinterpret, extend, shorten, or turn the clip into a merely similar new scene.${requestSection}

SOUND: Follow the natural-language sound direction above. Unless it explicitly requests silence, generate model-native synchronized sound with the picture. Do not infer exact source-track reuse and do not add a separate audio post-processing workflow.

STYLE: ${contract.styleDirection?.trim() || 'Match the requested visual world while preserving physically coherent contact, natural anatomy, stable faces, consistent wardrobe and objects, believable weight, grounded feet, and motion blur from the reference.'}

HARD EXCLUSIONS: ${exclusions.join('; ')}.

Final instruction: this is a structural repaint of ${source}, not a newly staged scene inspired by it. Exact temporal fidelity to the source has higher priority than novelty or visual embellishment.`;
}
