import type { FunctionDeclaration } from '@google/genai'

export const KIDS_IMAGE_FUNCTION = 'queue_image_request'

export const KIDS_IMAGE_FUNCTION_DECLARATION: FunctionDeclaration = {
  name: KIDS_IMAGE_FUNCTION,
  description: 'Queue an image creation or edit only when the child clearly asks to make or change a picture. Return immediately after queueing. Never include names, contact details, location, secrets, health, money, or other personal information in the instruction.',
  parametersJsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'edit'],
        description: 'Use edit when changing the picture on screen; use create for a new picture.',
      },
      instruction: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
        description: 'A concise visual instruction containing no personal information.',
      },
    },
    required: ['action', 'instruction'],
  },
}

export const KIDS_LIVE_TOOLS = [{ functionDeclarations: [KIDS_IMAGE_FUNCTION_DECLARATION] }]

export type KidsImageRequest = {
  action: 'create' | 'edit'
  instruction: string
}

const SENSITIVE_TEXT = /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s().-]{7,}\d)/gi

export function parseKidsImageRequest(args: Record<string, unknown> | undefined): KidsImageRequest | null {
  if (args?.action !== 'create' && args?.action !== 'edit') return null
  if (typeof args.instruction !== 'string') return null
  const instruction = args.instruction.replace(SENSITIVE_TEXT, '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!instruction) return null
  return { action: args.action, instruction }
}
