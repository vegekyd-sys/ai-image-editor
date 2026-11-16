import { describe, expect, it, vi } from 'vitest'
import { renderToReadableStream } from 'react-dom/server.edge'
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
