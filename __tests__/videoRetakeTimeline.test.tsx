import { useState } from 'react';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import VideoResultCard from '@/components/VideoResultCard';
import VideoRetakeTimeline from '@/components/VideoRetakeTimeline';
import AgentStatusBar from '@/components/AgentStatusBar';
import { LocaleProvider } from '@/lib/i18n';
import type { ProjectAnimation } from '@/types';

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  Element.prototype.setPointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function RangeHarness({seek = vi.fn(), initial = {start:10,end:14}}) {
  const [range,setRange] = useState(initial);
  return <LocaleProvider><VideoRetakeTimeline url="https://example.com/v.mp4" duration={30} range={range} onSeek={seek} onChange={setRange} /></LocaleProvider>;
}
const values = () => screen.getAllByRole('slider').map(e => Number(e.getAttribute('aria-valuenow')));
function trackRect() {
  vi.spyOn(screen.getByTestId('video-retake-track'),'getBoundingClientRect').mockReturnValue({left:0,width:300} as DOMRect);
}
describe('Retake playback timeline', () => {
  it('finishes sampling while collapsed and reuses the same thumbnails across reopening and remounting', async () => {
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation((()=>({drawImage:vi.fn()})) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    let frame=0;
    const encode=vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockImplementation(()=>`data:image/jpeg;base64,frame${frame++}`);
    const timeline=(active:boolean, offset=0)=><LocaleProvider><VideoRetakeTimeline url="https://example.com/cache-toggle.mp4" duration={30} sourceOffset={offset} range={active ? {start:10,end:14} : null} onSeek={vi.fn()} /></LocaleProvider>;
    const view=render(timeline(true));
    const sampler=view.container.querySelector('video')!;
    Object.defineProperty(sampler,'duration',{value:30,configurable:true});
    fireEvent.loadedData(sampler);
    for(let i=0;i<3;i++) await act(async()=>{fireEvent.seeked(sampler);});
    view.rerender(timeline(false));
    expect(view.container.querySelector('video')).toBe(sampler);
    for(let i=3;i<8;i++) await act(async()=>{fireEvent.seeked(sampler);});
    const sources=Array.from(view.container.querySelectorAll('img'),img=>img.src);
    expect(sources).toHaveLength(8);
    expect(view.container.querySelector('video')).toBeNull();
    const loads=vi.mocked(HTMLMediaElement.prototype.load).mock.calls.length;
    view.rerender(timeline(true));
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(loads);
    expect(Array.from(view.container.querySelectorAll('img'),img=>img.src)).toEqual(sources);
    view.unmount();
    const cached=render(timeline(true));
    expect(cached.container.querySelector('video')).toBeNull();
    expect(Array.from(cached.container.querySelectorAll('img'),img=>img.src)).toEqual(sources);
    expect(encode).toHaveBeenCalledTimes(8);
    cached.rerender(timeline(true,10));
    expect(cached.container.querySelectorAll('img')).toHaveLength(0);
    expect(cached.container.querySelector('video')).not.toBeNull();
  });
  it('tracks playback independently of the selected interval and clamps to the video', () => {
    const change=vi.fn();
    const timeline=(time:number)=><LocaleProvider><VideoRetakeTimeline url="https://example.com/v.mp4" duration={30} range={{start:10,end:14}} currentTime={time} onSeek={vi.fn()} onChange={change} /></LocaleProvider>;
    const {rerender}=render(timeline(7.5));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('7.5');
    expect(screen.getByTestId('video-retake-playhead').style.left).toBe('25%');
    rerender(timeline(22.5));
    expect(screen.getByTestId('video-retake-playhead').style.left).toBe('75%');
    expect(values()).toEqual([10,14]); expect(change).not.toHaveBeenCalled();
    rerender(timeline(40)); expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('30');
    rerender(timeline(-1)); expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
  it('moves the entire interval without resizing, clamps both video boundaries, and seeks the start', () => {
    const seek = vi.fn(); render(<RangeHarness seek={seek} />); trackRect();
    fireEvent.pointerDown(screen.getByRole('button',{name:/移动整个选区|Move the selected interval/}),{button:0,clientX:120,pointerId:1});
    fireEvent.pointerMove(screen.getByTestId('video-retake-track'),{clientX:170,pointerId:1});
    expect(values()).toEqual([15,19]); expect(seek).toHaveBeenLastCalledWith(15);
    fireEvent.pointerMove(screen.getByTestId('video-retake-track'),{clientX:500,pointerId:1});
    expect(values()).toEqual([26,30]);
    fireEvent.pointerMove(screen.getByTestId('video-retake-track'),{clientX:-100,pointerId:1});
    expect(values()).toEqual([0,4]);
    fireEvent.pointerUp(screen.getByTestId('video-retake-track'));
  });
  it('seeks inside the selected interval on a tap, while small pointer jitter does not move the interval', () => {
    const seek=vi.fn(); render(<RangeHarness seek={seek} />); trackRect();
    fireEvent.pointerDown(screen.getByTestId('video-retake-selection'),{button:0,clientX:120,pointerId:1});
    fireEvent.pointerMove(screen.getByTestId('video-retake-track'),{clientX:122,pointerId:1});
    fireEvent.pointerUp(screen.getByTestId('video-retake-track'),{clientX:122,pointerId:1});
    expect(seek).toHaveBeenLastCalledWith(12.2); expect(values()).toEqual([10,14]);
  });
  it('resizes one ear while keeping the other fixed and enforces 0.1–15 seconds', () => {
    render(<RangeHarness />); trackRect();
    fireEvent.pointerDown(screen.getAllByRole('slider')[1],{button:0,clientX:140,pointerId:1});
    fireEvent.pointerMove(screen.getByTestId('video-retake-track'),{clientX:300,pointerId:1});
    expect(values()).toEqual([10,25]);
    fireEvent.pointerMove(screen.getByTestId('video-retake-track'),{clientX:50,pointerId:1});
    expect(values()).toEqual([10,10.1]);
    fireEvent.pointerUp(screen.getByTestId('video-retake-track'));
  });
  it('supports keyboard translation and resizing at video boundaries', () => {
    render(<RangeHarness />);
    fireEvent.keyDown(screen.getByRole('button',{name:/移动整个选区|Move the selected interval/}),{key:'ArrowRight',shiftKey:true});
    expect(values()).toEqual([11,15]);
    fireEvent.keyDown(screen.getByRole('button',{name:/移动整个选区|Move the selected interval/}),{key:'End'});
    expect(values()).toEqual([26,30]);
    fireEvent.keyDown(screen.getAllByRole('slider')[0],{key:'Home'});
    expect(values()).toEqual([15,30]);
  });
  it('opens selection on the existing timeline while keeping the Retake pill in place', () => {
    const anim = {id:'v',projectId:'p',taskId:'',videoUrl:'https://example.com/v.mp4',prompt:'',snapshotUrls:[],status:'completed',duration:12,createdAt:new Date().toISOString()} as ProjectAnimation;
    const begin=vi.fn();
    render(<LocaleProvider><VideoResultCard animations={[anim]} selectedVideoId="v" onSelectVideo={vi.fn()} onCreateNew={vi.fn()} onAbandon={vi.fn()} onViewDetail={vi.fn()} onRetake={begin} currentTime={3} currentDuration={12} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('video-frame-edit-pill').querySelector('button')!);
    expect(begin).toHaveBeenCalledWith(anim,3);
    fireEvent.click(screen.getByTestId('video-retake-pill-edit'));
    expect(begin).toHaveBeenCalledTimes(2); expect(begin).toHaveBeenLastCalledWith(anim,3);
    expect(screen.queryByTestId('video-retake-timeline')).toBeNull();
    expect(screen.getByTestId('video-frame-edit-pill')).toBeTruthy();
  });
  it('uses the Statusbar Edit action to navigate with the selection', () => {
    const open=vi.fn();
    render(<LocaleProvider><AgentStatusBar statusText="" isActive={false} onOpenChat={open} chatActionLabel="Edit" selectionText="重做 10–14 秒，其余保持不变" /></LocaleProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Edit'}));
    expect(open).toHaveBeenCalledTimes(1); expect(screen.getByText('重做 10–14 秒，其余保持不变')).toBeTruthy();
  });
});
