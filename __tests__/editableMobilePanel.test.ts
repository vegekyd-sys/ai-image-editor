import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const editorSource = readFileSync(join(process.cwd(), 'src/components/Editor.tsx'), 'utf8');
const frameSource = readFileSync(join(process.cwd(), 'src/components/DesignEditorFrame.tsx'), 'utf8');

describe('mobile editable editor placement', () => {
  it('keeps the floating editable editor desktop-only', () => {
    expect(editorSource).toContain('{isDesktop && editingDesignField && currentDesignSnap?.design');
  });

  it('replaces the mobile editable carousel with the active editor', () => {
    expect(editorSource).toContain('!isDesktop && editingDesignField && currentDesignSnap?.design ? (');
    expect(editorSource).toContain('data-design-editor-slot="mobile-inline"');
  });

  it('uses an inline frame on mobile instead of another fixed overlay', () => {
    expect(frameSource).toContain("data-design-editor-layout={isDesktop ? 'floating' : 'inline'}");
    expect(frameSource).not.toContain("position: 'fixed'");
  });
});
