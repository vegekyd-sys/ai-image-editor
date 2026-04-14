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
      }}
    />
  );
};

registerRoot(RemotionRoot);
