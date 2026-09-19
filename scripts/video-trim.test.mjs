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

import {segmentSpeed,moveSegment,sourceAtOutput,timelineSegments,projectTimedRange} from '../src/windows/video-trim.js';
test('reordered clips validate source non-overlap while output follows array and individual speeds',()=>{
 const clips=[{start:8,end:12,speed:2},{start:0,end:4,speed:.5},{start:5,end:7}];
 assert.equal(validSegments(clips,12),true);assert.equal(timelineDuration(clips),12);
 assert.deepEqual(timelineSegments(clips).map(c=>[c.start,c.end]),[[0,2],[2,10],[10,12]]);
 assert.deepEqual(sourceAtOutput(clips,2),{index:1,time:0});
 assert.deepEqual(sourceAtOutput(clips,6),{index:1,time:2});
 assert.deepEqual(sourceAtOutput(clips,12),{index:2,time:7});
 assert.equal(outputTime(clips,10),1);assert.equal(outputTime(clips,2),6);
 for(const speed of [0,.2,4.1,NaN])assert.equal(validSegments([{start:0,end:1,speed}],1),false);
});
test('source adjacency uses index hints and trim bounds use source order after reordering',()=>{
 const clips=[{start:4,end:8,speed:2},{start:0,end:4}];
 assert.equal(outputTime(clips,4,0),0);assert.equal(outputTime(clips,4,1),6);
 assert.equal(trimSegment(clips,0,'start',1,10)[0].start,4);
 assert.equal(trimSegment(clips,1,'end',7,10)[1].end,4);
 assert.equal(trimSegment(clips,0,'end',20,10)[0].end,10);
});
test('split and reorder preserve speed and undo can restore original document without mutation',()=>{
 const original=[{start:0,end:8,speed:2},{start:9,end:12,speed:.5}];
 const split=splitSegment(original,4),reordered=moveSegment(split,2,0);
 assert.deepEqual(reordered,[original[1],{start:0,end:4,speed:2},{start:4,end:8,speed:2}]);
 assert.equal(timelineDuration(reordered),timelineDuration(original));assert.equal(original.length,2);
 assert.equal(segmentSpeed({start:0,end:1}),1);
 assert.strictEqual(moveSegment(original,0,0),original);
});
test('timed effects project onto output order and speed without changing source times',()=>{
 const clips=[{start:8,end:12,speed:2},{start:0,end:4,speed:.5}];
 const result=projectTimedRange(clips,2,10);
 assert.deepEqual(result.map(r=>[r.index,r.start,r.end,r.sourceStart,r.sourceEnd]),[[0,0,1,8,10],[1,6,10,2,4]]);
 assert.deepEqual(projectTimedRange(clips,4,8),[]);
 assert.deepEqual(clips,[{start:8,end:12,speed:2},{start:0,end:4,speed:.5}]);
});
