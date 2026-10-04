import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import VideoResultCard from '@/components/VideoResultCard'
import { LocaleProvider } from '@/lib/i18n'
import type { ProjectAnimation } from '@/types'

describe('VideoResultCard cancellation', () => {
  it('shows a cancel action while rendering and calls the existing abandon path', () => {
    localStorage.setItem('locale', 'en')
    const animation: ProjectAnimation = {
      id: 'video-processing',
      projectId: 'project-1',
      taskId: 'task-processing',
      videoUrl: '',
      prompt: 'Launch clip',
      snapshotUrls: [],
      imageUrl: '',
      status: 'processing',
      duration: 5,
      createdAt: new Date().toISOString(),
      videoModel: 'seedance-fast' as ProjectAnimation['videoModel'],
    }
    const onAbandon = vi.fn()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)

    render(
      <LocaleProvider initialLocale="en">
        <VideoResultCard
          animations={[animation]}
          selectedVideoId={null}
          onSelectVideo={vi.fn()}
          onCreateNew={vi.fn()}
          onAbandon={onAbandon}
          onViewDetail={vi.fn()}
        />
      </LocaleProvider>,
    )

    expect(screen.getByText(/Rendering/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(confirm).toHaveBeenCalledWith('Cancel this video render?')
    expect(onAbandon).toHaveBeenCalledWith('task-processing')
  })
})
