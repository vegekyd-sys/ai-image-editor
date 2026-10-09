import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ImageCanvas from '@/components/ImageCanvas';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

it('renders an empty loading timeline, its first decoded image, and an empty timeline again', () => {
  const props = { projectId: 'loading-project', currentIndex: 0, onIndexChange: vi.fn(), isEditing: false };
  const view = render(<ImageCanvas {...props} timeline={[]} />);
  expect(view.container.querySelector('[data-project-canvas]')).toBeTruthy();
  view.rerender(<ImageCanvas {...props} timeline={['data:image/jpeg;base64,YQ==']} />);
  const image = view.container.querySelector('img')!;
  Object.defineProperties(image, { naturalWidth: { value: 100 }, naturalHeight: { value: 100 } });
  fireEvent.load(image);
  expect(view.container.querySelector('[data-canvas-ready="true"]')).toBeTruthy();
  view.rerender(<ImageCanvas {...props} timeline={[]} />);
  expect(view.container.querySelector('[data-project-canvas]')).toBeTruthy();
});
