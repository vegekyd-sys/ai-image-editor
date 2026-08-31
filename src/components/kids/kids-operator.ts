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

async function loadAgentStream() {
  return (await import('@/lib/agentStream')).streamAgent
}

function buildOperatorPrompt(request: KidsImageRequest) {
  const verb = request.action === 'edit' ? 'Edit the current image' : 'Create one new image'
  return `[Makaron Kids Operator] ${verb} from this child-safe visual instruction: ${request.instruction}. Use the existing generate_image tool and finish with one image. Do not add personal data, purchases, fear, unsafe activity, or manipulative companion language.`
}

function buildVoiceTurnPrompt(text: string) {
  return `[Makaron Kids voice turn] A young child said: ${JSON.stringify(text)}

Reply in the same language with one or two very short, warm sentences suitable for speaking aloud. Do not use markdown. Do not ask for personal details, secrets, contact information, location, purchases, or actions away from a trusted adult. For danger, health, privacy, or money, ask the child to get a trusted grown-up. If the child clearly asks to create or change a picture, use the existing generate_image tool, then briefly say the picture is ready. Otherwise just respond naturally and do not call a tool.`
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

  async respond(text: string, picture: KidsOperatorPicture | null) {
    if (this.active) return null
    this.active = true
    this.callbacks.onPhase('queued')
    const sourceVersion = this.sourceVersion
    try {
      const projectId = await this.ensureProject(picture, sourceVersion)
      this.callbacks.onPhase('working')
      const streamAgent = await loadAgentStream()
      let reply = ''
      let deliveredImage = ''
      let failure = ''
      await streamAgent({
        prompt: buildVoiceTurnPrompt(text.slice(0, 600)),
        image: '',
        projectId,
        durable: true,
      }, {
        onContent: (content) => { reply += content },
        onImage: (_image, _model, _snapshotId, imageUrl) => {
          if (!imageUrl || sourceVersion !== this.sourceVersion) return
          deliveredImage = imageUrl
          this.callbacks.onImage(imageUrl)
        },
        onError: (message) => { failure = message },
        onInsufficientCredits: () => { failure = 'Image helper needs a grown-up' },
      })
      if (failure) throw new Error(failure)
      if (sourceVersion !== this.sourceVersion) return null
      const spokenReply = reply.replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300)
        || (deliveredImage ? '画面做好啦，我们一起看看！' : '')
      if (!spokenReply) throw new Error('Picture helper returned no spoken reply')
      this.callbacks.onPhase('done')
      return spokenReply
    } catch (error) {
      if (sourceVersion === this.sourceVersion) {
        console.error('[MakaronKids] Voice turn handoff failed:', error)
        this.callbacks.onPhase('error')
      }
      return null
    } finally {
      this.active = false
    }
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
      const streamAgent = await loadAgentStream()
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
