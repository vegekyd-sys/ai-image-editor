import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

describe('media list persistence and startup performance', () => {
  it('never uses Safari content-visibility auto on home or project media cards', () => {
    const homePage = fs.readFileSync(path.join(root, 'src/app/home/page.tsx'), 'utf8')
    const projectsPage = fs.readFileSync(path.join(root, 'src/app/projects/page.tsx'), 'utf8')

    expect(homePage).not.toContain("contentVisibility: 'auto'")
    expect(homePage).toContain('fallbackSrc: template.before_images?.[0]')
    expect(projectsPage).not.toContain("contentVisibility: shouldDeferRender ? 'auto'")
    expect(projectsPage).not.toContain('containIntrinsicSize: shouldDeferRender')
  })

  it('appends project cards without unmounting previously-loaded images', () => {
    const projectsPage = fs.readFileSync(path.join(root, 'src/app/projects/page.tsx'), 'utf8')

    expect(projectsPage).toContain('INITIAL_PROJECT_CARD_COUNT = 24')
    expect(projectsPage).toContain('PROJECT_CARD_BATCH_SIZE = 24')
    expect(projectsPage).toContain('projects.slice(0, visibleProjectCount)')
    expect(projectsPage).toContain("rootMargin: '900px 0px'")
    expect(projectsPage).toContain('const coverUrl = lastSnap?.image_url')
    expect(projectsPage).toContain('id: `cover:${project.id}`')
    expect(projectsPage).toContain("!snapshot.id.startsWith('cover:')")
  })

  it('keeps homepage project warmup thin so media work cannot delay primary controls', () => {
    const warmSource = fs.readFileSync(path.join(root, 'src/lib/projects-list-warm.ts'), 'utf8')

    expect(warmSource).toContain(".select('id, title, cover_url, updated_at, created_at')")
    expect(warmSource).toContain('getCachedProjectsListSync')
    expect(warmSource).not.toContain(".from('snapshots')")
    expect(warmSource).not.toContain(".from('project_animations')")
    expect(warmSource).not.toContain('.limit(3000)')
  })
})
