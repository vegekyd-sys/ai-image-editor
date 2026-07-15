import { z } from 'zod';
import type { StudioDeliveryPromise, StudioStageId } from './contracts';

const creativeConceptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  hook: z.string().min(1),
  visualDirection: z.string().min(1),
  motionLanguage: z.string().min(1),
});

const creativeSectionSchema = z.object({
  id: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  narration: z.string(),
  onScreenText: z.array(z.string()).default([]),
}).refine(section => section.endSeconds > section.startSeconds, {
  message: 'endSeconds must be greater than startSeconds',
});

export const studioCreativePacketSchema = z.object({
  title: z.string().min(1),
  objective: z.string().min(1),
  audience: z.string().min(1),
  coreMessage: z.string().min(1),
  language: z.string().min(2),
  concepts: z.array(creativeConceptSchema).min(2),
  selectedConceptId: z.string().min(1),
  rationale: z.string().min(1),
  estimatedCostUsd: z.number().nonnegative().default(0),
  sections: z.array(creativeSectionSchema).min(1),
}).superRefine((packet, ctx) => {
  if (!packet.concepts.some(concept => concept.id === packet.selectedConceptId)) {
    ctx.addIssue({
      code: 'custom',
      path: ['selectedConceptId'],
      message: 'selectedConceptId must reference a concept',
    });
  }
});

export type StudioCreativePacket = z.infer<typeof studioCreativePacketSchema>;

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

export function canvasAspectRatio(width: number, height: number): string {
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`;
}

export function buildStudioCreativeArtifacts(input: {
  packet: StudioCreativePacket;
  deliveryPromise: StudioDeliveryPromise;
}): Array<{ stage: Extract<StudioStageId, 'brief' | 'proposal' | 'script'>; artifact: unknown }> {
  const packet = studioCreativePacketSchema.parse(input.packet);
  const durationSeconds = input.deliveryPromise.durationSeconds;

  return [
    {
      stage: 'brief',
      artifact: {
        version: '1.0',
        title: packet.title,
        objective: packet.objective,
        audience: packet.audience,
        coreMessage: packet.coreMessage,
        language: packet.language,
        durationSeconds,
        aspectRatio: canvasAspectRatio(input.deliveryPromise.width, input.deliveryPromise.height),
      },
    },
    {
      stage: 'proposal',
      artifact: {
        version: '1.0',
        concepts: packet.concepts,
        selectedConceptId: packet.selectedConceptId,
        rationale: packet.rationale,
        deliveryPromise: input.deliveryPromise,
        estimatedCostUsd: packet.estimatedCostUsd,
      },
    },
    {
      stage: 'script',
      artifact: {
        version: '1.0',
        title: packet.title,
        totalDurationSeconds: durationSeconds,
        sections: packet.sections,
      },
    },
  ];
}
