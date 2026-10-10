import {describe,it,expect,vi} from 'vitest';
import type {DesignPayload} from '@/types';

vi.mock('@/lib/remotion-font-resolver',()=>({resolveRemotionFontManifestUrlForDesign:async()=>''}));
const state=vi.hoisted(()=>({created:[] as string[],release:undefined as undefined|(()=>void)}));
vi.mock('@vercel/sandbox',()=>({Sandbox:{create:async()=>{
  const id=String(state.created.length);state.created.push(id);
  return {status:'running',writeFiles:async()=>undefined,readFileToBuffer:async()=>Buffer.from('jpeg'),
    runCommand:async({args}:{args:string[]})=>({
      kill:async()=>undefined,
      wait:async()=>{if(id==='0'&&args[0].includes('prefetch'))await new Promise<void>(resolve=>{state.release=resolve;});return {exitCode:0};},
    }),
  };
}}}));

describe('preview source-set isolation',()=>{
  it('finishes project B while project A is waiting on its source cache',async()=>{
    process.env.REMOTION_SNAPSHOT_ID='test-snapshot';
    const {renderDesignFrame}=await import('@/lib/remotion-server');
    const make=(source:string)=>({code:`function Design(){return React.createElement(Video,{src:'${source}'})}`,props:{},width:1080,height:1920,animation:{fps:30,durationInSeconds:10}} as DesignPayload);
    const a=renderDesignFrame(make('https://example.com/a.mp4'),0);
    await vi.waitFor(()=>expect(state.release).toBeTypeOf('function'));
    try {
      const b=await renderDesignFrame(make('https://example.com/b.mp4'),0);
      expect(b.toString()).toBe('jpeg');expect(state.created).toHaveLength(2);
    } finally {state.release?.();await a;delete process.env.REMOTION_SNAPSHOT_ID;}
  });
});
