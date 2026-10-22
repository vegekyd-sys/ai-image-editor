import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isMakaronVideoComponent, withVideoFit } from '@/lib/remotion-video-fit';
import { compileDynamicDesignComponent } from '@/remotion/DynamicDesign';

// Reproduce the installed @remotion/media behavior: its canvas ignores CSS fit
// and uses the component prop, defaulting to contain.
function MediaDecoder({ objectFit = 'contain', style }: any) {
  return <div data-fit={objectFit} style={{ ...style, objectFit }} />;
}
const Media = withVideoFit(MediaDecoder, true);
const Native = withVideoFit('video', false);

describe('authored video fit across decoders', () => {
  it('keeps wrapped video recognizable to Player readiness and trim discovery', () => {
    expect(isMakaronVideoComponent(Media)).toBe(true);
    expect(isMakaronVideoComponent(Native)).toBe(true);
    expect(isMakaronVideoComponent(() => null)).toBe(false);
  });
  it.each(['cover', 'contain', 'fill', 'none', 'scale-down'])('preserves legacy CSS %s in the media decoder', fit => {
    const Component = compileDynamicDesignComponent(`function Composition(props) {
      return <Video src={props.src} data-editable-ignore style={{width:1080,height:608,objectFit:'${fit}'}} />;
    }`, { React, Video: Media });
    expect(Component).not.toBeNull();
    const html = renderToStaticMarkup(React.createElement(Component!, { src: 'source.mp4' }));
    expect(html).toContain(`data-fit="${fit}"`);
    expect(html).toContain(`object-fit:${fit}`);
    expect(html).toContain('height:608px');
  });
  it('gives the explicit fit precedence and keeps native CSS in sync', () => {
    for (const Component of [Media, Native]) {
      const html = renderToStaticMarkup(<Component objectFit="cover" style={{objectFit:'contain',width:1080}} />);
      expect(html).toContain('object-fit:cover');
      expect(html).not.toContain('objectFit=');
    }
  });
  it('retains the decoder default when no fit was authored', () => {
    expect(renderToStaticMarkup(<Media style={{width:1080}} />)).toContain('data-fit="contain"');
  });
  it('does not mutate a shared style object', () => {
    const style = Object.freeze({ objectFit: 'contain', width: 1080 });
    renderToStaticMarkup(<Media objectFit="cover" style={style} />);
    expect(style.objectFit).toBe('contain');
  });
});
