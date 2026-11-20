import { z } from 'zod'

const modality = z.enum(['image', 'video', 'audio'])
const cameraPose = z.object({
  time: z.number().min(0).max(1), azimuth: z.number().finite(),
  elevation: z.number().min(-90).max(90), distance: z.number().positive(),
}).strict()

/** Types consume the next selected file of that kind. No duplicate URL lists or unmeasured assets. */
export const h3ControlsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('max-reference'), order: z.array(modality).min(1).max(12).optional(), lockAudio: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal('turbo-generation'), frames: z.enum(['first', 'first-last', 'last']).optional(), lockAudio: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal('camera'), trajectory: z.array(cameraPose).min(2).max(12) }).strict(),
  z.object({ kind: z.literal('turbo-extend') }).strict(),
  z.object({ kind: z.literal('relight') }).strict(), z.object({ kind: z.literal('reframe') }).strict(),
  z.object({ kind: z.literal('recast') }).strict(), z.object({ kind: z.literal('photo-lipsync') }).strict(),
])
export type H3Controls = z.infer<typeof h3ControlsSchema>
export const H3_CONTROLS_HELP = 'Explicit experimental H3 operation only. Select fal-h3-max or minimax-h3-max (Turbo). Supply selected images, videos and audio in their own lists. max-reference order consumes the next file of each type: [image,video,audio,image] binds Image 1, Video 1, Audio 1, Image 2. In this mode <<<media_N>>> refers to position in order. lockAudio uses the sole audio as the actual output track; exclude audio from order. Turbo frames last uses one ending image, first-last uses two. Camera trajectory uses normalized time. Relight uses one lighting sphere and one video; recast uses replacement portraits and one video; reframe requires target aspect; photo-lipsync uses one portrait and one speech track. Turbo Extend returns source plus continuation.'
