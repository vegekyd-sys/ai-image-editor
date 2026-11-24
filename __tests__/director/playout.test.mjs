import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayoutCues } from '../../services/director/player/playout.mjs';

test('captions wait for a presented frame after previous footage and server buffering', () => {
  const cues=createPlayoutCues();
  cues.expect(1,'开场');cues.expect(2,'三分');cues.expect(3,'欢呼');
  const chunk=(index,version,buffer=0)=>({chunk_index:index,prompt_version:version,playback_seconds:5,buffer_depth_seconds:buffer});
  assert.equal(cues.frame(100),undefined);
  cues.chunk(chunk(0,1));
  assert.deepEqual(cues.frame(100.1),{version:1,text:'开场'});
  cues.chunk(chunk(2,3));
  cues.chunk(chunk(1,2,13));
  assert.equal(cues.frame(105),undefined);
  assert.equal(cues.frame(105),undefined);
  assert.deepEqual(cues.frame(108.2),{version:2,text:'三分'});
  cues.chunk(chunk(1,2));
  assert.deepEqual(cues.frame(110),{version:3,text:'欢呼'});
  assert.equal(cues.frame(111),undefined);
});
