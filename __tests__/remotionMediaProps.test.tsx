import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { withMediaTrim, normalizeMediaTrimProps } from '@/lib/remotion-media-props';
import { withVideoFit } from '@/lib/remotion-video-fit';
import { compileDynamicDesignComponent } from '@/remotion/DynamicDesign';
import { previewCacheStyle } from '@/lib/remotion-preview-cache-style';

function Decoder(props: any) {
  return <div data-before={props.trimBefore} data-after={props.trimAfter} data-old-start={props.startFrom} data-old-end={props.endAt} data-fit={props.objectFit} className={props.className} style={props.style} />;
}

describe('shared media contract', () => {
  it('normalizes video and audio legacy trims while modern GUI overrides win, including zero', () => {
    expect(normalizeMediaTrimProps({startFrom:30,endAt:90,trimBefore:0,trimAfter:60})).toEqual({trimBefore:0,trimAfter:60});
    for (const Component of [withMediaTrim(Decoder), withVideoFit(Decoder,true), withVideoFit(Decoder,false)]) {
      const html=renderToStaticMarkup(<Component startFrom={30} endAt={90} playbackRate={1.5}/>);
      expect(html).toContain('data-before="30"');expect(html).toContain('data-after="90"');
      expect(html).not.toContain('data-old-start');expect(html).not.toContain('data-old-end');
    }
  });
  it.each([{effects:[{}]}, {effects:()=>[]}, {toneFrequency:1.5}, {audioStreamIndex:1}, {requestInit:{headers:{'X-Test':'value'}}}])('uses media semantics in preview for features native video cannot apply: %j', extra => {
    const Native=()=> <div data-decoder="native"/>;
    const Media=(props:any)=> <div data-decoder="media" data-fit={props.objectFit}/>;
    const Component=withVideoFit(Native,false,Media);
    expect(renderToStaticMarkup(<Component {...extra} style={{objectFit:'cover'}}/>)).toContain('data-decoder="media"');
    expect(renderToStaticMarkup(<Component {...extra} style={{objectFit:'cover'}}/>)).toContain('data-fit="cover"');
    expect(renderToStaticMarkup(<Component effects={[]} toneFrequency={1} audioStreamIndex={0}/>)).toContain('data-decoder="native"');
  });
  it.each(['Video','OffthreadVideo','Html5Video'])('applies GUI trims and transforms to %s in the export evaluator', name => {
    const Alias=Decoder;
    const Component=compileDynamicDesignComponent(`function Composition(props){return <${name} data-editable="clip" src={props.clip} trimBefore={15} trimAfter={90} style={{width:200,height:120,objectPosition:'left top'}}/>;}`,{React,Video:()=>null,OffthreadVideo:()=>null,Html5Video:()=>null,[name]:Alias});
    const html=renderToStaticMarkup(React.createElement(Component!,{clip:'source.mp4',_trimBefore_clip:45,_trimAfter_clip:75,_pos_clip:{x:30,y:20},_scale_clip:{w:1.2,h:0.8}}));
    expect(html).toContain('data-before="45"');expect(html).toContain('data-after="75"');
    expect(html).toContain('translate:30px 20px');expect(html).toContain('scale:1.2 0.8');expect(html).toContain('object-position:left top');
    expect(html).toContain('makaron-editable-id-clip');
  });
  it('places the cached frame over the actual video box while preserving authored visual properties', () => {
    const authored=Object.freeze({position:'relative' as const,left:10,top:20,margin:30,opacity:0.5,filter:'blur(2px)',objectFit:'cover' as const,objectPosition:'right bottom',borderRadius:12,transform:'rotate(12deg)',transformOrigin:'top left',clipPath:'inset(2px)'});
    const result=previewCacheStyle(authored,{left:85,top:115,width:'200px',height:'120px',position:'absolute'},true);
    expect(result).toMatchObject({...authored,position:'absolute',left:85,top:115,margin:0,inset:'auto',width:'200px',height:'120px',display:'block'});
    expect(previewCacheStyle(authored,null,true).display).toBe('none');expect(authored.opacity).toBe(0.5);
  });
});
