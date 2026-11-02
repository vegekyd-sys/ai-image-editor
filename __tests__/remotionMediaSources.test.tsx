import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {render} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {useMediaSources} from '../src/lib/remotion-media-sources';
import {withVideoFit} from '../src/lib/remotion-video-fit';
import {withMediaTrim} from '../src/lib/remotion-media-props';
import {compileDynamicDesignComponent} from '../src/remotion/DynamicDesign';

describe('media source transport overrides', () => {
  it('keeps the decoder mounted when Remotion deserializes equal source maps on successive frames', () => {
    let mounts = 0;
    function Decoder(props: {src?: string}) {
      React.useEffect(() => {mounts++;}, []);
      return <video src={props.src}/>;
    }
    function Frame({input}: {input: unknown}) {
      const sources = useMediaSources(input);
      const Video = React.useMemo(() => withVideoFit(Decoder, true, undefined, sources), [sources]);
      return <Video src="original.mp4"/>;
    }
    const input = { 'original.mp4': 'delivery.mp4' };
    const view = render(<Frame input={input}/>);
    view.rerender(<Frame input={{...input}}/>);
    view.rerender(<Frame input={JSON.stringify(input)}/>);
    expect(mounts).toBe(1);
    expect(view.container.querySelector('video')?.getAttribute('src')).toBe('delivery.mp4');
    view.unmount();
  });
  it('routes a media src without changing authored visible text, source props or trims', () => {
    const url = 'https://cdn.makaron.app/storage/v1/object/public/images/owner/clip.mp4';
    const destination = 'https://media-cache.makaron.app/clip.mp4?__mk_render=scoped';
    const Video = withVideoFit((props: Record<string, unknown>) => React.createElement('video', {
      src: props.src as string, 'data-trim-before': props.trimBefore as number, 'data-volume': props.volume as number,
    }), true, undefined, {[url]: destination});
    const code = 'function Design(props) { return <div><p>{props.url}</p><Video src={props.url} trimBefore={45} volume={0.7}/></div> }';
    const Component = compileDynamicDesignComponent(code, {React, Video})!;
    const props = {url};
    const markup = renderToStaticMarkup(React.createElement(Component, props));
    expect(markup).toContain(`<p>${url}</p>`);
    expect(markup).toContain(`src="${destination}"`);
    expect(markup).toContain('data-trim-before="45" data-volume="0.7"');
    expect(props.url).toBe(url);
  });
  it('preserves audio trims and volume while routing only a listed src', () => {
    const Audio = withMediaTrim((props: Record<string, unknown>) => <audio src={props.src as string}
      data-trim={props.trimBefore as number} data-volume={props.volume as number}/>, {'original.wav': 'delivery.wav'});
    expect(renderToStaticMarkup(<Audio src="original.wav" startFrom={45} volume={0.7}/>)).toContain('src="delivery.wav" data-trim="45" data-volume="0.7"');
    expect(renderToStaticMarkup(<Audio src="other.wav"/>)).toContain('src="other.wav"');
  });
});
