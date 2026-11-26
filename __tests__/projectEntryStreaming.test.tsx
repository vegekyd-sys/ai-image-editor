import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToReadableStream } from 'react-dom/server.edge'
import { restoreDesignPoster, restoreProjectSnapshot } from '@/lib/editor/project-snapshot'
import type { DbSnapshot } from '@/types'
import ProjectPage from '@/app/projects/[id]/page'

vi.mock('@/components/ProjectEditorContainer', () => ({ default: () => <div>project-editor-shell</div> }))

const { single } = vi.hoisted(() => ({ single: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, abortSignal: () => query, maybeSingle: single }
    return { from: () => query }
  },
}))

describe('project entry response streaming', () => {
  beforeEach(() => single.mockReset())
  it('omits legacy review posters from the opening HTML, project rows and cached designs', async () => {
    const sheet = 'https://cdn.example/project/drafts/design-contact-sheet-123.jpg'
    const row = { id: 's', design_path: 'code/s.json', image_url: sheet } as DbSnapshot
    single.mockResolvedValueOnce({ data: row })
    const layout = await ProjectPage({ params: Promise.resolve({ id: 'project' }), searchParams: Promise.resolve({ snapshot: 's' }) })
    const stream = await renderToReadableStream(<html><body>{layout}</body></html>)
    expect(await new Response(stream).text()).not.toContain(sheet)
    expect(restoreProjectSnapshot(row)).toMatchObject({ image: '', legacyContactSheetPoster: true })
    expect(restoreDesignPoster({ id: 's', designPath: row.design_path, imageUrl: sheet, image: 'data:image/jpeg;base64,old', tips: [], messageId: '' }).image).toBe('')
    expect(restoreProjectSnapshot({ ...row, design_path: undefined }).image).toBe(sheet)
  })

  it('sends the editor shell while the permission-scoped media query is still pending', async () => {
    let release!: (value: { data: null }) => void
    single.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const layout = await ProjectPage({ params: Promise.resolve({ id: 'project' }), searchParams: Promise.resolve({}) })
    const stream = await renderToReadableStream(<html><body>{layout}</body></html>, { bootstrapScripts: ['/editor.js'] })
    const reader = stream.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('project-editor-shell')
    expect(single).toHaveBeenCalledOnce()
    release({ data: null })
    await stream.allReady
    await reader.cancel()
  })
})
