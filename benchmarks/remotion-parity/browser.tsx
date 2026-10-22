import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, type PlayerRef } from '@remotion/player';
import { evalRemotionJSX } from '../../src/lib/evalRemotionJSX';
import { prepareRemotionFontCode, loadPreparedRemotionFonts } from '../../src/remotion/font-catalog';
import { fixtures } from './fixtures';

async function main(){
 const manifest=await (await fetch('/fonts.json')).json();
 const components=new Map<string,React.ComponentType<any>>();
 for(const fixture of fixtures){
   const prepared=prepareRemotionFontCode({...fixture,manifest});
   await loadPreparedRemotionFonts({manifest,prepared,text:JSON.stringify(fixture)});
   const Component=evalRemotionJSX(prepared.code,{videoRuntime:'preview'});
   if(!Component)throw new Error('Could not compile '+fixture.id);
   components.set(fixture.id,Component);
 }
 function App(){
   const [id,setId]=useState(fixtures[0].id),[frame,setFrame]=useState(fixtures[0].frame);
   const ref=useRef<PlayerRef>(null);const fixture=fixtures.find(f=>f.id===id)!;
   const Component=useMemo(()=>components.get(id)!,[id]);
   const select=(f:typeof fixture)=>{setId(f.id);setFrame(f.frame);};
   return <><h1>Preview / Export property parity</h1><nav>{fixtures.map(f=><button key={f.id} id={f.id} onClick={()=>select(f)}>{f.id}</button>)}</nav><p id="status">{id} · frame {frame} · ready</p><div className="comparison"><div id="stage" style={{width:600,height:337.5,flexShrink:0}}><Player key={id} ref={ref} component={Component} inputProps={fixture.props} compositionWidth={640} compositionHeight={360} durationInFrames={240} fps={30} initialFrame={fixture.frame} controls={false} acknowledgeRemotionLicense style={{width:600,height:337.5}}/></div><img id="reference" style={{width:600,height:337.5}} src={`/${id}-media.png`} alt="Media export reference"/></div><button id="seek" onClick={()=>ref.current?.seekTo(fixture.frame)}>Seek test frame</button><button id="play" onClick={()=>ref.current?.play()}>Play</button><button id="pause" onClick={()=>ref.current?.pause()}>Pause</button></>;
 }
 createRoot(document.getElementById('root')!).render(<App/>);
}
main().catch(error=>{document.getElementById('root')!.textContent=String(error);console.error(error);});
