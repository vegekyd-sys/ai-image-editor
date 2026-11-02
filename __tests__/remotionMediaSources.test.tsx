import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {withMediaSource} from '../src/lib/remotion-media-sources';
import {compileDynamicDesignComponent} from '../src/remotion/DynamicDesign';

describe('media source transport overrides', () => {
  it('routes a media src without changing authored visible text, source props or trims', () => {
    const url = 'https://cdn.makaron.app/storage/v1/object/public/images/owner/clip.mp4';
    const destination = 'https://media-cache.makaron.app/clip.mp4?__mk_render=scoped';
    const Video = withMediaSource((props: Record<string, unknown>) => React.createElement('video', {
      src: props.src as string, 'data-trim-before': props.trimBefore as number, 'data-volume': props.volume as number,
    }), {[url]: destination});
    const code = 'function Design(props) { return <div><p>{props.url}</p><Video src={props.url} trimBefore={45} volume={0.7}/></div> }';
    const Component = compileDynamicDesignComponent(code, {React, Video})!;
    const props = {url};
    const markup = renderToStaticMarkup(React.createElement(Component, props));
    expect(markup).toContain(`<p>${url}</p>`);
    expect(markup).toContain(`src="${destination}"`);
    expect(markup).toContain('data-trim-before="45" data-volume="0.7"');
    expect(props.url).toBe(url);
  });
  it('keeps the existing component identity when the optional contract is absent', () => {
    const Video = () => null;
    expect(withMediaSource(Video)).toBe(Video);
    expect(withMediaSource(Video, {})).toBe(Video);
  });
});
