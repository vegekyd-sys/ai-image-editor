import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageCanvas from '@/components/ImageCanvas';
import { LocaleProvider } from '@/lib/i18n';

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('Retake native video continuity',()=>{
  it('keeps the player and poster when toggling at the current position, but still seeks a different position',()=>{
    vi.stubGlobal('ResizeObserver',class {observe() {} disconnect() {}});
    vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));
    vi.stubGlobal('cancelAnimationFrame',vi.fn());
    vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation((()=>({drawImage:vi.fn()})) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,poster');
    const poster=vi.fn();
    const surface=(time?:number,token=0)=><LocaleProvider><ImageCanvas timeline={['__VIDEO__']} currentIndex={0} onIndexChange={vi.fn()} isEditing={false} isVideoEntry videoUrl="https://example.com/retake-continuity.mp4" onVideoPosterCapture={poster} videoSeekRequest={time === undefined ? undefined : {time,token}} /></LocaleProvider>;
    const view=render(surface());
    const video=view.container.querySelector('video')!;
    let position=2;
    const seek=vi.fn((time:number)=>{position=time;});
    Object.defineProperties(video,{duration:{value:30,configurable:true},readyState:{value:4,configurable:true},videoWidth:{value:1280,configurable:true},videoHeight:{value:720,configurable:true},currentTime:{get:()=>position,set:seek,configurable:true}});
    fireEvent.loadedData(video);
    view.rerender(surface(2,1));
    view.rerender(surface(2,2));
    fireEvent.loadedData(video);
    expect(view.container.querySelector('video')).toBe(video);
    expect(seek).not.toHaveBeenCalled();
    expect(poster).toHaveBeenCalledTimes(1);
    view.rerender(surface(5,3));
    expect(seek).toHaveBeenLastCalledWith(5);
  });
});
