import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('anonymous project continuation contract', () => {
  it('claims the continuation before the first async draft read', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/home/page.tsx'), 'utf8')
    const continuationLookup = source.indexOf('const continuationId = getCreateDraftContinuationId()')
    const claim = source.indexOf('consumeDraftRef.current = true', continuationLookup)
    const draftRead = source.indexOf('const draft = await getCreateDraft()', continuationLookup)

    expect(continuationLookup).toBeGreaterThan(-1)
    expect(claim).toBeGreaterThan(continuationLookup)
    expect(draftRead).toBeGreaterThan(claim)
  })

  it('passes stable project and continuation IDs into staged project creation', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/home/page.tsx'), 'utf8')
    expect(source).toContain('projectId: draft.projectId')
    expect(source).toContain('continuationId: draft.continuationId')
  })
})
