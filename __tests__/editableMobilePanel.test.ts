import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const editorSource = readFileSync(join(process.cwd(), 'src/components/Editor.tsx'), 'utf8');
const frameSource = readFileSync(join(process.cwd(), 'src/components/DesignEditorFrame.tsx'), 'utf8');
const floatingPanelSource = readFileSync(join(process.cwd(), 'src/components/FloatingPanel.tsx'), 'utf8');
const pillCarouselSource = readFileSync(join(process.cwd(), 'src/components/PillCarousel.tsx'), 'utf8');
const imageCanvasSource = readFileSync(join(process.cwd(), 'src/components/ImageCanvas.tsx'), 'utf8');

describe('mobile editable editor placement', () => {
  it('keeps the floating editable editor desktop-only', () => {
    expect(editorSource).toContain('{isDesktop && editingDesignField && currentDesignSnap?.design');
  });

  it('replaces the mobile editable carousel with the active editor', () => {
    expect(editorSource).toContain('!isDesktop && editingDesignField && currentDesignSnap?.design ? (');
    expect(editorSource).toContain('data-design-editor-slot="mobile-inline"');
  });

  it('uses a stable inline slot with an overlaying editor on mobile', () => {
    expect(frameSource).toContain("data-design-editor-layout={isDesktop ? 'floating' : 'inline'}");
    expect(frameSource).not.toContain("position: 'fixed'");
    expect(frameSource).toContain('height: MOBILE_EDITOR_SLOT_HEIGHT');
    expect(pillCarouselSource).toContain('height: MOBILE_EDITOR_SLOT_HEIGHT');
    expect(frameSource).toContain("position: 'relative'");
    expect(frameSource).toContain('data-design-editor-overlay="mobile"');
    expect(frameSource).toContain("position: 'absolute'");
    expect(frameSource).toContain('zIndex: 60');
  });

  it('floats the mobile close control above the panel without affecting layout height', () => {
    expect(floatingPanelSource).toContain("data-floating-panel-close={isDesktop ? 'external' : 'internal'}");
    expect(floatingPanelSource).toContain("isDesktop ? 'mb-1.5' : 'absolute left-5 z-20'");
    expect(floatingPanelSource).toContain("position: isDesktop ? undefined : 'absolute'");
    expect(floatingPanelSource).toContain('top: isDesktop ? undefined : -18');
    expect(floatingPanelSource).toContain('left: isDesktop ? undefined : 20');
    expect(floatingPanelSource).toContain('className="relative px-3 pb-3 pt-1 animate-pop-in"');
    expect(floatingPanelSource).toContain('{!isDesktop && closeButton}');
  });

  it('hides canvas playback controls while an editable editor is open', () => {
    expect(editorSource).toContain('hidePlaybackControls={Boolean(editingDesignFieldId)}');
    expect(imageCanvasSource).toContain('hidePlaybackControls?: boolean;');
    expect(imageCanvasSource).toContain('!hidePlaybackControls && !isSeeking');
  });
});
