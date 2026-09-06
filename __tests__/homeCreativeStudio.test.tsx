import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zh from '@/lib/locales/zh'

vi.mock('@/lib/i18n', () => ({
  useLocale: () => ({
    t: (key: keyof typeof zh, ...args: unknown[]) => {
      const value = zh[key]
      return typeof value === 'function' ? (value as (...values: unknown[]) => string)(...args) : value
    },
  }),
}))
vi.mock('@/components/HomeSkillMedia', () => ({
  LazyVideo: ({ suspended }: { suspended: boolean }) => <video data-suspended={suspended} />,
}))

import HomeCreativeStudio from '@/components/HomeCreativeStudio'

let visibility: IntersectionObserverCallback
const disconnect = vi.fn()
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { visibility = callback }
    observe() {}
    disconnect = disconnect
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); disconnect.mockClear() })

const skills = [{ id: 'aef03797-9d32-46f9-ba90-88b4afe9981b', image: '/example.mp4', labels: {}, prompt: '', sort_order: 1 }]

describe('homepage creative studio', () => {
  it('carries the selected palette and musical mood into the draft without submitting work', () => {
    const onUseIdea = vi.fn()
    const view = render(<HomeCreativeStudio skills={skills} paused={false} suspended={false} onUseIdea={onUseIdea} />)
    fireEvent.click(view.getByRole('tab', { name: '设计' }))
    fireEvent.click(view.getByRole('button', { name: '一笔微光' }))
    expect(onUseIdea).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '用这个想法开始' }))
    expect(onUseIdea).toHaveBeenLastCalledWith(expect.stringContaining('一笔微光'))
    fireEvent.click(view.getByRole('tab', { name: '音乐' }))
    fireEvent.click(view.getByRole('button', { name: '夜航' }))
    fireEvent.click(view.getByRole('button', { name: '用这个想法开始' }))
    expect(onUseIdea).toHaveBeenLastCalledWith(expect.stringContaining('复古电子 · 律动贝斯 · 霓虹夜色'))
    expect(onUseIdea).toHaveBeenCalledTimes(2)
  })

  it('supports keyboard mode navigation and an accessible comparison control', () => {
    const view = render(<HomeCreativeStudio skills={skills} paused={false} suspended={false} onUseIdea={vi.fn()} />)
    const slider = view.getByRole('slider')
    fireEvent.change(slider, { target: { value: '72' } })
    expect(slider.getAttribute('aria-valuetext')).toBe('72% 原片，28% 作品')
    fireEvent.keyDown(view.getByRole('tab', { name: '图片' }), { key: 'ArrowLeft' })
    const music = view.getByRole('tab', { name: '音乐' })
    expect(music.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(music)
    fireEvent.keyDown(music, { key: 'Home' })
    expect(view.getByRole('slider').getAttribute('aria-valuenow') || (view.getByRole('slider') as HTMLInputElement).value).toBe('72')
  })

  it('suspends hidden video and removes its player when another medium is selected', () => {
    const view = render(<HomeCreativeStudio skills={skills} paused={false} suspended={false} onUseIdea={vi.fn()} />)
    fireEvent.click(view.getByRole('tab', { name: '视频' }))
    expect(view.container.querySelector('video')?.getAttribute('data-suspended')).toBe('true')
    act(() => visibility([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(view.container.querySelector('video')?.getAttribute('data-suspended')).toBe('false')
    act(() => visibility([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(view.container.querySelector('video')?.getAttribute('data-suspended')).toBe('true')
    fireEvent.click(view.getByRole('tab', { name: '图片' }))
    expect(view.container.querySelector('video')).toBeNull()
    view.unmount()
    expect(disconnect).toHaveBeenCalled()
  })
  it('plays only on request, switches the real source, and stops when hidden', () => {
    const view = render(<HomeCreativeStudio skills={skills} paused={false} suspended={false} onUseIdea={vi.fn()} />)
    act(() => visibility([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    fireEvent.click(view.getByRole('tab', { name: '音乐' }))
    const audio = view.container.querySelector('audio')!
    expect(audio.play).not.toHaveBeenCalled()
    expect(view.container.querySelector('.studio-music')?.getAttribute('data-playing')).toBe('false')
    fireEvent.click(view.getByRole('button', { name: '播放配乐' }))
    expect(audio.getAttribute('src')).toBe('/home-studio/dream.mp3')
    fireEvent.playing(audio)
    expect(view.container.querySelector('.studio-music')?.getAttribute('data-playing')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: '夜航' }))
    expect(audio.getAttribute('src')).toBe('/home-studio/night.mp3')
    expect(audio.play).toHaveBeenCalledTimes(2)
    fireEvent.playing(audio)
    act(() => visibility([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(audio.pause).toHaveBeenCalled()
    expect(view.getByRole('button', { name: '播放配乐' })).toBeTruthy()
    act(() => visibility([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

})
