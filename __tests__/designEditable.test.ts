import { describe, it, expect } from 'vitest';
import { validateEditables } from '../src/lib/design-harness';
import type { EditableField, DesignPayload } from '../src/types';

// ─── validateEditables ────────────────────────────────────────────────────────

describe('validateEditables', () => {
  it('returns null for undefined editables', () => {
    expect(validateEditables(undefined)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(validateEditables([])).toBeNull();
  });

  it('returns null for valid editables', () => {
    const editables: EditableField[] = [
      { id: 'title', type: 'text', label: '标题', propKey: 'title' },
      { id: 'subtitle', type: 'text', label: '副标题', propKey: 'subtitle', positionProps: { x: 'subX', y: 'subY' } },
    ];
    expect(validateEditables(editables)).toBeNull();
  });

  it('rejects editable missing id', () => {
    const editables = [{ id: '', type: 'text', label: 'Test', propKey: 'test' }] as EditableField[];
    expect(validateEditables(editables)).toContain('missing required');
  });

  it('rejects editable missing type', () => {
    const editables = [{ id: 'test', type: '' as 'text', label: 'Test', propKey: 'test' }] as EditableField[];
    expect(validateEditables(editables)).toContain('missing required');
  });

  it('rejects editable missing propKey', () => {
    const editables = [{ id: 'test', type: 'text', label: 'Test', propKey: '' }] as EditableField[];
    expect(validateEditables(editables)).toContain('missing required');
  });
});

// ─── EditableField type contracts ─────────────────────────────────────────────

describe('EditableField type', () => {
  it('supports text-only editable (no positionProps)', () => {
    const field: EditableField = {
      id: 'title',
      type: 'text',
      label: '标题',
      propKey: 'title',
    };
    expect(field.positionProps).toBeUndefined();
  });

  it('supports draggable editable (with positionProps)', () => {
    const field: EditableField = {
      id: 'title',
      type: 'text',
      label: '标题',
      propKey: 'title',
      positionProps: { x: 'titleX', y: 'titleY' },
    };
    expect(field.positionProps?.x).toBe('titleX');
    expect(field.positionProps?.y).toBe('titleY');
  });
});

// ─── DesignPayload with editables ─────────────────────────────────────────────

describe('DesignPayload editables', () => {
  it('includes editables in design payload', () => {
    const design: DesignPayload = {
      code: 'function Design(props) { return null; }',
      width: 1080,
      height: 1350,
      props: { title: 'Hello', titleX: 0.05, titleY: 0.1 },
      editables: [
        { id: 'title', type: 'text', label: '标题', propKey: 'title', positionProps: { x: 'titleX', y: 'titleY' } },
      ],
    };
    expect(design.editables).toHaveLength(1);
    expect(design.editables![0].propKey).toBe('title');
  });

  it('supports design without editables (backward compat)', () => {
    const design: DesignPayload = {
      code: 'function Design() { return null; }',
      width: 1080,
      height: 1350,
    };
    expect(design.editables).toBeUndefined();
  });
});

// ─── Patch with editables ─────────────────────────────────────────────────────

describe('Patch preserves editables', () => {
  it('merges editables from patch result into existing design', () => {
    const lastDesign: DesignPayload = {
      code: 'function Design(props) { return <h1>{props.title}</h1>; }',
      width: 1080,
      height: 1350,
      props: { title: 'Old' },
      editables: [{ id: 'title', type: 'text', label: '标题', propKey: 'title' }],
    };

    // Simulate patch with editables update
    const patchResult = {
      editables: [
        { id: 'title', type: 'text' as const, label: '标题', propKey: 'title' },
        { id: 'subtitle', type: 'text' as const, label: '副标题', propKey: 'subtitle' },
      ],
    };

    const patched = { ...lastDesign };
    if (patchResult.editables) patched.editables = patchResult.editables;

    expect(patched.editables).toHaveLength(2);
    expect(patched.editables![1].id).toBe('subtitle');
  });

  it('keeps existing editables when patch has none', () => {
    const lastDesign: DesignPayload = {
      code: 'function Design(props) { return <h1>{props.title}</h1>; }',
      width: 1080,
      height: 1350,
      props: { title: 'Old' },
      editables: [{ id: 'title', type: 'text', label: '标题', propKey: 'title' }],
    };

    const patched = { ...lastDesign };
    // No editables in patch result → keep existing
    expect(patched.editables).toHaveLength(1);
  });
});

// ─── Prop update simulation ───────────────────────────────────────────────────

describe('Prop update flow', () => {
  it('updates text prop value', () => {
    const design: DesignPayload = {
      code: 'function Design(props) { return <h1>{props.title}</h1>; }',
      width: 1080,
      height: 1350,
      props: { title: 'Hello World', titleX: 0.05, titleY: 0.1 },
      editables: [{ id: 'title', type: 'text', label: '标题', propKey: 'title', positionProps: { x: 'titleX', y: 'titleY' } }],
    };

    // Simulate GUI text edit
    const updatedProps = { ...design.props, title: '新标题' };
    expect(updatedProps.title).toBe('新标题');
    expect(updatedProps.titleX).toBe(0.05); // position unchanged
  });

  it('updates position props after drag', () => {
    const props: Record<string, unknown> = { title: 'Hello', titleX: 0.05, titleY: 0.1 };

    // Simulate drag to new position
    const newX = 0.25;
    const newY = 0.35;
    const updatedProps = { ...props, titleX: newX, titleY: newY };

    expect(updatedProps.titleX).toBe(0.25);
    expect(updatedProps.titleY).toBe(0.35);
    expect(updatedProps.title).toBe('Hello'); // text unchanged
  });

  it('clamps position to 0-1 range', () => {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    expect(clamp(-0.1)).toBe(0);
    expect(clamp(1.2)).toBe(1);
    expect(clamp(0.5)).toBe(0.5);
  });
});
