export interface VideoReplicationCharacterRole {
  replacementMediaIndex: number;
  sourceActorAnchor: string;
  replacementIdentity: string;
}

export interface VideoReplicationEnvironmentRole {
  replacementMediaIndex: number;
  sourceEnvironmentAnchor: string;
  replacementEnvironment: string;
}

export interface VideoReplicationContract {
  referenceVideoMediaIndex: number;
  sourceDurationSeconds: number;
  characters: VideoReplicationCharacterRole[];
  environment?: VideoReplicationEnvironmentRole;
  styleDirection?: string;
  additionalExclusions?: string[];
}

function mediaMarker(index: number) {
  return `<<<media_${index}>>>`;
}

/**
 * Compile the invariant-heavy provider prompt for exact source-led replication.
 * The Agent supplies semantic observations; runtime owns the fragile wording.
 */
export function compileVideoReplicationPrompt(
  request: string,
  contract: VideoReplicationContract,
) {
  const source = mediaMarker(contract.referenceVideoMediaIndex);
  const duration = contract.sourceDurationSeconds.toFixed(2).replace(/\.00$/, '');
  const characterMappings = contract.characters.map((character, index) => [
    `ROLE ${index + 1}: In ${source}, the source performer is identified by this stable evidence: ${character.sourceActorAnchor}.`,
    `Replace that performer with the exact character identity, face, hair, body, clothing, colors, and accessories from ${mediaMarker(character.replacementMediaIndex)}: ${character.replacementIdentity}.`,
    'Follow the performer through their actions and choreography. Never identify or remap this role only by left/right screen position, because performers can cross, turn, occlude one another, or reverse screen direction.',
  ].join(' ')).join('\n');

  const environment = contract.environment
    ? [
        `ENVIRONMENT: In ${source}, the source environment is: ${contract.environment.sourceEnvironmentAnchor}.`,
        `Replace the entire visible environment with ${mediaMarker(contract.environment.replacementMediaIndex)}: ${contract.environment.replacementEnvironment}.`,
        'Remove all source-background architecture, decoration, signage, props, lighting motifs, and scenery that conflict with the replacement, while preserving the reference camera geometry, performer spacing, floor contact, depth, lens perspective, and lighting continuity.',
      ].join(' ')
    : `ENVIRONMENT: Preserve the environment visible in ${source}, including its geometry, lighting continuity, and spatial relationship to the performers.`;

  const exclusions = [
    'no new shots or extra cuts',
    'no omitted shot, action, impact, reaction, or pause',
    'no different opening or ending',
    'no new camera angle, lens, zoom, pan, tilt, dolly, orbit, or handheld motion',
    'no slow motion, speed ramp, freeze frame, montage, or time remapping unless visibly present in the reference',
    'no identity morphing, blending, duplication, costume drift, role swap, or transition back to a source performer',
    'no invented props, characters, text, logos, effects, or story events',
    ...(contract.additionalExclusions || []),
  ];

  const [titleLine = '', ...requestLines] = request.trim().split(/\r?\n/);
  const cleanTitle = titleLine.trim() || 'Exact Video Replication';
  const requestDirection = requestLines.join('\n').trim();
  const requestSection = requestDirection
    ? `\n\nREQUEST DIRECTION:\n${requestDirection}`
    : '';
  return `${cleanTitle}

Use ${source} as the sole and exact temporal performance, edit, composition, and camera authority for the full ${duration}-second output. Recreate the complete reference video beat for beat from its first visible frame through its final pose. Match the exact shot count and order, cut points, shot durations, camera path, lens perspective, framing changes, horizon, subject scale, screen direction, spatial relationship, choreography, footwork, body trajectories, gestures, attacks, blocks, dodges, falls, contacts, impact timing, reactions, pauses, motion blur, and final held state. The replacement media controls identity and environment only; it must not rewrite the reference action, timing, camera, editing, or outcome.

${characterMappings}

IDENTITY LOCK: Keep every replacement identity stable from first appearance to last appearance, including during profiles, rear views, fast motion, overlap, partial occlusion, floor contact, falls, and motion blur. Preserve which source performer initiates and receives every action, who wins each exchange, every travel direction, and the exact final winner/loser poses. Track identity by source appearance plus distinctive action and choreography, never by screen side alone.

${environment}

STRUCTURE LOCK: Copy the source continuity exactly. Keep every opening pose, preparation beat, anticipation, action, impact, recoil, recovery, crossing, screen-position change, and ending hold at the same relative time. Preserve the original camera-to-subject relationship even after replacing the people and environment. Do not beautify, simplify, reinterpret, extend, shorten, or create a merely similar fight.${requestSection}

STYLE: ${contract.styleDirection?.trim() || 'Photorealistic cinematic live action with physically coherent contact, natural anatomy, stable faces, consistent wardrobe, believable weight, grounded feet, and motion blur matching the reference.'}

HARD EXCLUSIONS: ${exclusions.join('; ')}.

Final instruction: the result must be a structural repaint of ${source}, not a newly staged scene inspired by it. Exact temporal fidelity to the source has higher priority than novelty or visual embellishment.`;
}
