import test from 'node:test';
import assert from 'node:assert/strict';
import { validVideoRange, videoTimeLabel } from '../src/windows/video-trim.js';
test('export rejects invalid metadata and empty, inverted or out-of-bounds selections', () => {
  for (const range of [[0,0,5],[3,2,5],[-1,2,5],[0,6,5],[0,1,Infinity],[NaN,2,5],[0,Infinity,5]]) {
    assert.equal(validVideoRange(...range), false);
  }
  assert.equal(validVideoRange(0, 0.02, 0.02), true);
  assert.equal(validVideoRange(1.125, 5, 5), true);
});
test('time labels carry rounded tenths into the next minute', () => {
  assert.equal(videoTimeLabel(59.99), '1:00.0');
  assert.equal(videoTimeLabel(3600), '60:00.0');
  assert.equal(videoTimeLabel(NaN), '—');
});
import {splitSegment,trimSegment,validSegments,nextPlayableTime,outputTime,timelineDuration,deletedRanges} from '../src/windows/video-trim.js';
test('split then delete the middle preserves chronological source ranges',()=>{
  let clips=splitSegment([{start:0,end:10}],2);
  clips=splitSegment(clips,6);
  clips=clips.filter((_,i)=>i!==1);
  assert.deepEqual(clips,[{start:0,end:2},{start:6,end:10}]);
  assert.equal(timelineDuration(clips),6);
  assert.equal(nextPlayableTime(clips,2.1),6);
  assert.equal(outputTime(clips,7),3);
  assert.deepEqual(deletedRanges(clips,10),[{start:2,end:6}]);
  assert.equal(nextPlayableTime(clips,10),null);
});
test('dragging handles cannot cross neighbors or collapse a clip',()=>{
  const clips=[{start:1,end:3},{start:5,end:8}];
  assert.equal(trimSegment(clips,0,'end',9,10)[0].end,5);
  assert.equal(trimSegment(clips,1,'start',0,10)[1].start,3);
  assert.ok(trimSegment(clips,1,'end',0,10)[1].end>5);
  assert.strictEqual(trimSegment(clips,0,'start',NaN,10),clips);
});
test('split boundaries and exhausted timeline remain safe',()=>{
  const clips=[{start:0,end:1}];
  assert.strictEqual(splitSegment(clips,0),clips);
  assert.strictEqual(splitSegment(clips,1),clips);
  assert.equal(validSegments([],1),false);
  assert.equal(validSegments([{start:0,end:.6},{start:.5,end:1}],1),false);
  assert.equal(nextPlayableTime([],0),null);
});
