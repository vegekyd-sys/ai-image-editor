import { streamAgent } from '@/lib/agentStream'
import type { KidsImageRequest } from '@/lib/kids-live-contract'

export type KidsOperatorPhase = 'idle' | 'queued' | 'working' | 'done' | 'error'

export interface KidsOperatorPicture {
  data: string
  mimeType: string
}

interface OperatorCallbacks {
  onImage: (url: string) => void
  onPhase: (phase: KidsOperatorPhase) => void
}

interface ProjectResponse {
  projectId?: string
}

function buildOperatorPrompt(request: KidsImageRequest) {
  const verb = request.action === 'edit' ? 'Edit the current image' : 'Create one new image'
  return `[Makaron Kids Operator] ${verb} from this child-safe visual instruction: ${request.instruction}. Use the existing generate_image tool and finish with one image. Do not add personal data, purchases, fear, unsafe activity, or manipulative companion language.`
}

export class KidsOperatorHandoff {
  private projectId: string | null = null
  private sourceVersion = 0
  private active = false

  constructor(private readonly callbacks: OperatorCallbacks) {}

  resetSource() {
    this.sourceVersion += 1
    this.projectId = null
  }

  queue(request: KidsImageRequest, picture: KidsOperatorPicture | null) {
    if (this.active) return false
    this.active = true
    this.callbacks.onPhase('queued')
    const sourceVersion = this.sourceVersion
    queueMicrotask(() => {
      void this.run(request, picture, sourceVersion).finally(() => {
        this.active = false
      })
    })
    return true
  }

  private async ensureProject(picture: KidsOperatorPicture | null, sourceVersion: number) {
    if (this.projectId && sourceVersion === this.sourceVersion) return this.projectId
    const response = await fetch('/api/projects/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Makaron Kids',
        ...(picture ? { imageBase64: picture.data } : {}),
      }),
    })
    if (!response.ok) throw new Error(`Project handoff failed (${response.status})`)
    const data = await response.json() as ProjectResponse
    if (!data.projectId) throw new Error('Project handoff returned no project')
    if (sourceVersion !== this.sourceVersion) throw new Error('Picture changed before handoff')
    this.projectId = data.projectId
    return data.projectId
  }

  private async run(request: KidsImageRequest, picture: KidsOperatorPicture | null, sourceVersion: number) {
    try {
      const projectId = await this.ensureProject(picture, sourceVersion)
      this.callbacks.onPhase('working')
      let deliveredImage = ''
      let failure = ''
      await streamAgent({
        prompt: buildOperatorPrompt(request),
        image: '',
        projectId,
        durable: true,
      }, {
        onImage: (_image, _model, _snapshotId, imageUrl) => {
          if (!imageUrl || sourceVersion !== this.sourceVersion) return
          deliveredImage = imageUrl
          this.callbacks.onImage(imageUrl)
        },
        onError: (message) => { failure = message },
        onInsufficientCredits: () => { failure = 'Image helper needs a grown-up' },
      })
      if (failure) throw new Error(failure)
      if (!deliveredImage) throw new Error('Image helper finished without an image')
      this.callbacks.onPhase('done')
    } catch (error) {
      if (sourceVersion !== this.sourceVersion) return
      console.error('[MakaronKids] Operator handoff failed:', error)
      this.callbacks.onPhase('error')
    }
  }
}
