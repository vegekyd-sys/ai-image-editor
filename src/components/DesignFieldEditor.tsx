'use client';

import type { DesignPayload, EditableField } from '@/types';
import DesignTextEditor from '@/components/DesignTextEditor';
import DesignVideoTrimEditor from '@/components/DesignVideoTrimEditor';
import { getVideoTrimPropKeys } from '@/lib/editor/video-trim';

interface DesignFieldEditorProps {
  field: EditableField;
  design: DesignPayload;
  posterImage?: string;
  onUpdateProp: (key: string, value: unknown) => void;
  onClose: () => void;
  isDesktop: boolean;
}

export default function DesignFieldEditor({
  field,
  design,
  posterImage,
  onUpdateProp,
  onClose,
  isDesktop,
}: DesignFieldEditorProps) {
  const props = (design.props || {}) as Record<string, unknown>;

  if (field.type === 'video') {
    const fps = design.animation?.fps || 30;
    const { endKey } = getVideoTrimPropKeys(field);
    const rawEnd = endKey ? Number(props[endKey]) : 0;
    const fallbackDurationInFrames = Number.isFinite(rawEnd) && rawEnd > 0
      ? Math.round(rawEnd)
      : Math.max(6, Math.round(fps * 10));

    return (
      <DesignVideoTrimEditor
        field={field}
        props={props}
        fps={fps}
        durationInFrames={fallbackDurationInFrames}
        posterImage={posterImage}
        onUpdateProp={onUpdateProp}
        onClose={onClose}
        isDesktop={isDesktop}
      />
    );
  }

  return (
    <DesignTextEditor
      field={field}
      value={String(props[field.propKey] ?? '')}
      onChangeValue={(value) => onUpdateProp(field.propKey, value)}
      onClose={onClose}
      isDesktop={isDesktop}
    />
  );
}
