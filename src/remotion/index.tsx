/**
 * Remotion entry point for server-side rendering.
 * Registers a single dynamic composition that can render any Agent-generated design.
 */

import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicDesign } from './DynamicDesign';

const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="dynamic-design"
      component={DynamicDesign}
      width={1080}
      height={1350}
      fps={30}
      durationInFrames={1}
      defaultProps={{
        code: 'function Design() { return null; }',
        designProps: {},
        fps: 30,
        durationInFrames: 1,
        width: 1080,
        height: 1350,
      }}
      calculateMetadata={({ props }) => ({
        fps: (props as Record<string, unknown>).fps as number || 30,
        durationInFrames: (props as Record<string, unknown>).durationInFrames as number || 1,
        width: (props as Record<string, unknown>).width as number || 1080,
        height: (props as Record<string, unknown>).height as number || 1350,
      })}
    />
  );
};

registerRoot(RemotionRoot);
