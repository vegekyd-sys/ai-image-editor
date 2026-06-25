import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageRefChip from '@/components/ImageRefChip';

vi.mock('@/lib/supabase/storage', () => ({
  getThumbnailUrl: (url: string, width: number) => `${url}?w=${width}`,
}));

describe('ImageRefChip', () => {
  const snapshot = {
    id: 'snap-1',
    image: '',
    imageUrl: 'https://example.com/original.jpg',
    tips: [],
    messageId: 'msg-1',
  };

  it('keeps preview open after touchend followed by synthetic click', async () => {
    render(<ImageRefChip index={0} snapshot={snapshot} />);

    const chip = screen.getByRole('button');

    fireEvent.touchStart(chip, {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    fireEvent.touchEnd(chip, {
      changedTouches: [{ clientX: 10, clientY: 10 }],
    });
    fireEvent.click(chip);

    await waitFor(() => {
      const previewImg = Array.from(document.querySelectorAll('img'))
        .find(img => img.getAttribute('src') === 'https://example.com/original.jpg?w=400');
      expect(previewImg).toBeTruthy();
    });
  });

  it('keeps chip touches out of parent pan handlers', () => {
    const onParentTouchStart = vi.fn();
    const onParentTouchEnd = vi.fn();

    render(
      <div onTouchStart={onParentTouchStart} onTouchEnd={onParentTouchEnd}>
        <ImageRefChip index={0} snapshot={snapshot} />
      </div>,
    );

    const chip = screen.getByRole('button');

    fireEvent.touchStart(chip, {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    fireEvent.touchEnd(chip, {
      changedTouches: [{ clientX: 10, clientY: 10 }],
    });

    expect(onParentTouchStart).not.toHaveBeenCalled();
    expect(onParentTouchEnd).not.toHaveBeenCalled();
    expect(screen.getByTestId('image-ref-preview-1')).toBeTruthy();
  });

  it('closes the previous preview when another image ref opens', () => {
    render(
      <>
        <ImageRefChip index={0} snapshot={snapshot} />
        <ImageRefChip index={1} snapshot={{ ...snapshot, id: 'snap-2', imageUrl: 'https://example.com/second.jpg' }} />
      </>,
    );

    fireEvent.click(screen.getByTestId('image-ref-chip-1'));
    expect(screen.getByTestId('image-ref-preview-1')).toBeTruthy();

    fireEvent.click(screen.getByTestId('image-ref-chip-2'));
    expect(screen.queryByTestId('image-ref-preview-1')).toBeNull();
    expect(screen.getByTestId('image-ref-preview-2')).toBeTruthy();
  });

  it('keeps desktop navigation behavior when onNavigate is provided', () => {
    const onNavigate = vi.fn();
    render(<ImageRefChip index={0} snapshot={snapshot} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId('image-ref-chip-1'));

    expect(onNavigate).toHaveBeenCalledWith(0);
    expect(screen.queryByTestId('image-ref-preview-1')).toBeNull();
  });

  it('prevents the native image context menu inside previews', () => {
    render(<ImageRefChip index={0} snapshot={snapshot} />);

    fireEvent.click(screen.getByTestId('image-ref-chip-1'));
    const previewImg = Array.from(document.querySelectorAll('img'))
      .find(img => img.getAttribute('src') === 'https://example.com/original.jpg?w=400') as HTMLImageElement;
    const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    previewImg.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });
});
