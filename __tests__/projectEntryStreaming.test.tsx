import { describe, expect, it, vi } from 'vitest'
import { renderToReadableStream } from 'react-dom/server.edge'
import ProjectLayout from '@/app/projects/[id]/layout'

const { single } = vi.hoisted(() => ({ single: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, single }
    return { from: () => query }
  },
}))

describe('project entry response streaming', () => {
  it('sends the editor shell while the permission-scoped media query is still pending', async () => {
    let release!: (value: { data: null }) => void
    single.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const layout = await ProjectLayout({ params: Promise.resolve({ id: 'project' }), children: <div>project-editor-shell</div> })
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
