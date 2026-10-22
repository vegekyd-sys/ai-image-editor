import { describe, expect, it } from 'vitest';
import { validatePrimaryVideoFraming as check } from '@/lib/composition-video-framing';
describe('primary footage occupancy',()=>{
  it('catches both reported strip layouts including helper component constants',()=>{
    expect(check(`function ClipLayer(){return <AbsoluteFill><div style={{top:500,width:1080,height:608}}><Video style={{width:'100%',height:'100%'}}/></div></AbsoluteFill>}`,1080,1920)).toContain('every primary video box');
    expect(check(`const W=1080; function Plate(){return <div style={{top:700,width:W,height:604}}><Video style={{width:W,height:632}}/></div>}`,1080,1920)).toContain('every primary video box');
  });
  it('allows full-frame or near-full-frame footage and multiple visual layers',()=>{
    expect(check(`function Composition(){return <AbsoluteFill><Video style={{width:'100%',height:'100%'}}/></AbsoluteFill>}`,1080,1920)).toBeNull();
    expect(check(`function Composition(){return <div style={{width:1080,height:1640}}><Video style={{width:'100%',height:'100%'}}/></div>}`,1080,1920)).toBeNull();
    expect(check(`function Composition(){return <AbsoluteFill><Video style={{width:1080,height:1920}}/><Video style={{width:200,height:200}}/></AbsoluteFill>}`,1080,1920)).toBeNull();
  });
  it('leaves unknown dynamic sizes to visual QA instead of a false hard rejection',()=>{
    for(const code of [`function Composition(props){return <Video style={props.style}/>}`,`function Composition(props){return <Video style={{width:props.w,height:props.h}}/>}`,`function Composition(props){return <div style={{...props.style}}><Video style={{width:'100%',height:'100%'}}/></div>}`])expect(check(code,1080,1920)).toBeNull();
  });
});
