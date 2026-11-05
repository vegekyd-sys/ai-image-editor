// Bridge between a TimelineDoc and the existing DesignPayload contract.
import type { DesignPayload } from '@/types';
import { parseTimelineDoc, timelineDuration } from './reducer';
import { TIMELINE_RUNTIME_CODE, TIMELINE_RUNTIME_MARKER } from './runtime-code';
import type { TimelineDoc } from './types';

/** A timeline video is a design whose code is the timeline runtime and whose props carry the doc. */
export function isTimelineDesign(design: Pick<DesignPayload, 'code' | 'props'> | null | undefined): boolean {
  return !!design
    && typeof design.code === 'string'
    && design.code.startsWith('// makaron-timeline-runtime')
    && !!design.props
    && typeof design.props.timeline === 'object'
    && design.props.timeline !== null;
}

export function getTimelineDoc(design: Pick<DesignPayload, 'code' | 'props'> | null | undefined): TimelineDoc | null {
  if (!isTimelineDesign(design)) return null;
  return parseTimelineDoc(design!.props!.timeline);
}

/** Build (or rebuild) the DesignPayload for a doc. Keeps the snapshot's runtime version if one is supplied. */
export function timelineToDesign(doc: TimelineDoc, previous?: { code?: unknown; fontSubstitutions?: Record<string, string> }): DesignPayload {
  const keepCode = typeof previous?.code === 'string' && previous.code.startsWith('// makaron-timeline-runtime') ? previous.code : undefined;
  return {
    code: keepCode ?? TIMELINE_RUNTIME_CODE,
    width: doc.width,
    height: doc.height,
    props: { timeline: doc },
    animation: { fps: doc.fps, durationInSeconds: timelineDuration(doc) },
    editables: [],
    ...(previous?.fontSubstitutions ? { fontSubstitutions: previous.fontSubstitutions } : {}),
  };
}

export { TIMELINE_RUNTIME_MARKER };
