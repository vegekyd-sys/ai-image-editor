import { render, act, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ProjectEntryPreview from '@/components/ProjectEntryPreview'

afterEach(cleanup)
describe('early project media handoff', () => {
  it('holds the actual preview through loading and retires only for the matching decoded canvas', () => {
    const { container } = render(<><div data-project-canvas="other" data-canvas-ready="true" /><ProjectEntryPreview projectId="project" imageUrl="https://media.example/poster.jpg" /></>)
    expect(container.querySelector('img')?.getAttribute('src')).toContain('poster.jpg')
    act(() => { document.dispatchEvent(new Event('makaron:canvas-ready')) })
    expect(container.querySelector('#ssr-skeleton')).not.toBeNull()
    const canvas = document.createElement('div')
    canvas.dataset.projectCanvas = 'project'; canvas.dataset.canvasReady = 'false'
    document.body.appendChild(canvas)
    act(() => { document.dispatchEvent(new Event('makaron:canvas-ready')) })
    expect(container.querySelector('#ssr-skeleton')).not.toBeNull()
    act(() => { canvas.dataset.canvasReady = 'true'; document.dispatchEvent(new Event('makaron:canvas-ready')) })
    expect(container.querySelector('#ssr-skeleton')).toBeNull()
    canvas.remove()
  })

  it('does not re-cover a ready canvas when the outer navigation boundary remounts', () => {
    const { container } = render(<><div data-project-canvas="project" data-canvas-ready="true" /><ProjectEntryPreview projectId="project" imageUrl="https://media.example/poster.jpg" /></>)
    expect(container.querySelector('#ssr-skeleton')).toBeNull()
  })

  it('loads the selected video range before the editor without placeholder imagery', () => {
    const { container } = render(<ProjectEntryPreview projectId="project" imageUrl={null} videoUrl="https://media.example/movie.mp4#t=8,15" />)
    const video = container.querySelector('video')!
    expect(video.getAttribute('src')).toContain('#t=8,15')
    expect(video.preload).toBe('auto')
    expect(video.crossOrigin).toBe('anonymous')
    expect(container.querySelector('img')).toBeNull()
  })

  it('falls back once to the same proxy as the canvas while retaining the selected range', () => {
    const { container } = render(<ProjectEntryPreview projectId="project" imageUrl={null} videoUrl="https://media.example/movie.mp4#t=8,15" />)
    const video = container.querySelector('video')!
    fireEvent.error(video)
    const fallback = video.getAttribute('src')!
    expect(fallback).toBe('/api/proxy-video?url=https%3A%2F%2Fmedia.example%2Fmovie.mp4#t=8,15')
    fireEvent.error(video)
    expect(video.getAttribute('src')).toBe(fallback)
  })
})
