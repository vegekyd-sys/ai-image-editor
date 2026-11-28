import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ImageCanvas from '@/components/ImageCanvas';
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

it('renders an empty loading timeline, its first decoded image, and an empty timeline again', async () => {
  const props = { projectId: 'loading-project', currentIndex: 0, onIndexChange: vi.fn(), isEditing: false };
  const view = render(<ImageCanvas {...props} timeline={[]} />);
  expect(view.container.querySelector('[data-project-canvas]')).toBeTruthy();
  view.rerender(<ImageCanvas {...props} timeline={['data:image/jpeg;base64,YQ==']} />);
  const image = view.container.querySelector<HTMLImageElement>('img[alt="preview"]')!;
  Object.defineProperties(image, { naturalWidth: { value: 100 }, naturalHeight: { value: 100 } });
  vi.spyOn(image, 'decode').mockResolvedValue(undefined);
  fireEvent.load(image);
  await waitFor(() => expect(view.container.querySelector('[data-canvas-ready="true"]')).toBeTruthy());
  view.rerender(<ImageCanvas {...props} timeline={[]} />);
  expect(view.container.querySelector('[data-project-canvas]')).toBeTruthy();
});

it('keeps video rendering and failure status above the placeholder image', () => {
  const props = {
    timeline: [VIDEO_PLACEHOLDER_IMAGE],
    currentIndex: 0,
    onIndexChange: vi.fn(),
    isEditing: false,
    isVideoEntry: true,
    videoModel: 'magi-2',
    videoPosterImage: VIDEO_PLACEHOLDER_IMAGE,
  };
  const view = render(<ImageCanvas {...props} videoProcessing />);
  expect(screen.getByText('canvas.videoRendering')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'preview' }).getAttribute('src')).toBe(VIDEO_PLACEHOLDER_IMAGE);
  expect(view.container.querySelector('[data-canvas-ready="true"]')).toBeTruthy();
  expect(view.container.querySelector('[data-canvas-preview-bridge]')).toBeNull();

  view.rerender(<ImageCanvas {...props} videoFailed />);
  expect(screen.getByText('canvas.videoFailed')).toBeTruthy();
  expect(view.container.querySelector('[data-canvas-preview-bridge]')).toBeNull();
});
