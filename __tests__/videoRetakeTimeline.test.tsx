import { useState } from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
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
    const begin=vi.fn(), frame=vi.fn();
    render(<LocaleProvider><VideoResultCard animations={[anim]} selectedVideoId="v" onSelectVideo={vi.fn()} onCreateNew={vi.fn()} onAbandon={vi.fn()} onViewDetail={vi.fn()} onRetake={begin} onFrameEdit={frame} currentTime={3} currentDuration={12} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('video-frame-edit-pill').querySelector('button')!);
    expect(begin).toHaveBeenCalledWith(anim,3); expect(frame).not.toHaveBeenCalled();
    expect(screen.queryByTestId('video-retake-timeline')).toBeNull();
    expect(screen.getByTestId('video-frame-edit-pill')).toBeTruthy();
  });
  it('uses the Statusbar Edit action to navigate with the selection', () => {
    const open=vi.fn();
    render(<LocaleProvider><AgentStatusBar statusText="" isActive={false} onOpenChat={open} chatActionLabel="Edit" selectionText="10–14s" /></LocaleProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Edit'}));
    expect(open).toHaveBeenCalledTimes(1); expect(screen.getByText('10–14s')).toBeTruthy();
  });
});
