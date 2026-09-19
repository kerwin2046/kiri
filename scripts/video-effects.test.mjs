import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../src/windows/video-effects.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.ESNext}}).outputText;
const {defaultOverlayRange, activeVideoEffects, createVideoEffect, moveVideoEffect, resizeVideoEffect, resizeVideoEffectFromHandle, videoZoomViewport, validVideoEffect, cropVideoFrame, videoFrameRect, videoPreviewTransform} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("new zoom clips at the next zoom and refuses overlapping placement", () => {
  const existing = {...createVideoEffect("zoom", 4, 10, []), id:"first"};
  const next = createVideoEffect("zoom", 2, 10, [existing]);
  assert.equal(next.end, 4);
  assert.equal(createVideoEffect("zoom", 5, 10, [existing]), null);
  assert.ok(validVideoEffect(next, [existing], 10));
  assert.equal(validVideoEffect({...next,end:5}, [existing], 10), false);
});

test("mask overlap and half-open active boundaries preserve source timing", () => {
  const a = createVideoEffect("mask", 2, 10, []);
  const b = createVideoEffect("mask", 3, 10, [a]);
  assert.ok(validVideoEffect(b, [a], 10));
  assert.equal(activeVideoEffects([a,b],3).length, 2);
  assert.deepEqual(activeVideoEffects([a,b],5), [b]);
});

test("zoom moving and resizing near source edges preserve aspect and stay in frame", () => {
  const a = createVideoEffect("zoom", 0, 10, []);
  const moved = moveVideoEffect(a, 4, -4);
  assert.equal(moved.x, 0.5);
  assert.equal(moved.y, 0);
  const resized = resizeVideoEffect(moved, 4, 0);
  assert.equal(resized.width, resized.height);
  assert.equal(resized.width, 1/1.5);
  assert.ok(validVideoEffect(resized, [], 10));
  assert.equal(resizeVideoEffect(a, -4, 0).width, 0.25);
});

test("invalid time and geometry are rejected; minimum end interval handles floating point", () => {
  assert.equal(createVideoEffect("mask", NaN, 10, []), null);
  assert.equal(createVideoEffect("mask", 0, 0, []), null);
  const effect = createVideoEffect("mask", 10, 10, []);
  assert.ok(effect);
  assert.ok(validVideoEffect(effect, [], 10));
  for (const patch of [{x:NaN}, {width:-1}, {end:11}, {start:-1}, {x:0.99}]) assert.equal(validVideoEffect({...effect,...patch},[],10), false);
});

test("mask size and movement keep opaque rectangle within source bounds", () => {
  const mask = createVideoEffect("mask", 0, 2, []);
  const resized = resizeVideoEffect(mask, 5, -5);
  assert.equal(resized.height, 0.02);
  assert.equal(resized.x + resized.width, 1);
  assert.ok(validVideoEffect(resized,[],2));
});

test("effect creation caps the document at the native export limit", () => {
  const effects = Array.from({length:128}, (_, index) => ({id:String(index),kind:"mask",start:0,end:1,x:0,y:0,width:0.2,height:0.2}));
  assert.equal(createVideoEffect("mask", 0, 2, effects), null);
  assert.equal(createVideoEffect("zoom", 0, 2, effects), null);
  assert.ok(createVideoEffect("mask", 0, 2, effects.slice(1)));
});


test("all eight mask handles preserve the opposite edges and stay in bounds",()=>{
 const mask={...createVideoEffect("mask",0,5,[]),x:.25,y:.25,width:.5,height:.5};
 for(const handle of ["nw","n","ne","e","se","s","sw","w"]){
  for(const [dx,dy] of [[.1,.08],[-2,-2],[2,2]]){
   const next=resizeVideoEffectFromHandle(mask,dx,dy,handle);
   assert.ok(validVideoEffect(next,[],5),handle);
   if(handle.includes("w"))assert.ok(Math.abs(next.x+next.width-.75)<1e-9);
   if(handle.includes("n"))assert.ok(Math.abs(next.y+next.height-.75)<1e-9);
  }
 }
});

test("zoom handle resizing anchors opposite edges and preserves aspect",()=>{
 const zoom=createVideoEffect("zoom",0,5,[]);
 for(const handle of ["nw","n","ne","e","se","s","sw","w"]){
  const next=resizeVideoEffectFromHandle(zoom,.12,-.09,handle);
  assert.ok(validVideoEffect(next,[],5),handle);
  assert.equal(next.width,next.height);
 }
 const northWest=resizeVideoEffectFromHandle(zoom,.1,.1,"nw");
 assert.ok(Math.abs(northWest.x+northWest.width-(zoom.x+zoom.width))<1e-9);
 assert.ok(Math.abs(northWest.y+northWest.height-(zoom.y+zoom.height))<1e-9);
});

test("smooth zoom eases from full frame, holds and returns without a jump",()=>{
 const zoom={...createVideoEffect("zoom",1,6,[]),end:4,transition:.5};
 assert.deepEqual(videoZoomViewport(zoom,1),{x:0,y:0,width:1,height:1});
 assert.deepEqual(videoZoomViewport(zoom,2),{x:zoom.x,y:zoom.y,width:zoom.width,height:zoom.height});
 assert.deepEqual(videoZoomViewport(zoom,1.25),videoZoomViewport(zoom,3.75));
 assert.deepEqual(videoZoomViewport(zoom,4),{x:0,y:0,width:1,height:1});
 assert.equal(videoZoomViewport({...zoom,end:1.1,transition:2},1.05).width,zoom.width);
 assert.equal(videoZoomViewport({...zoom,transition:0},1).width,zoom.width);
});

test("effect styles reject invalid parameters and preserve old payload defaults",()=>{
 const mask=createVideoEffect("mask",0,5,[]);
 assert.equal(mask.maskStyle,"blur");
 for(const patch of [{strength:NaN},{strength:1.1},{color:-1},{color:0x1000000},{color:1.2},{transition:3},{maskStyle:"unknown"}])assert.equal(validVideoEffect({...mask,...patch},[],5),false);
 const {maskStyle,strength,color,...legacy}=mask;
 assert.ok(validVideoEffect(legacy,[],5));
});

test("new overlays at the end remain visible for one second or the whole short clip", () => {
  assert.deepEqual(defaultOverlayRange(10, 10), {start:9, end:10});
  assert.deepEqual(defaultOverlayRange(9.95, 10), {start:9, end:10});
  assert.deepEqual(defaultOverlayRange(.2, .2), {start:0, end:.2});
  assert.deepEqual(defaultOverlayRange(2, 10), {start:2, end:5});
});

test("crop, fade and zoom each have a single camera interval but can combine",()=>{
 const zoom=createVideoEffect("zoom",0,5,[]),frame=createVideoEffect("frame",0,5,[zoom]),fade=createVideoEffect("fade",0,5,[zoom,frame]);
 assert.ok(validVideoEffect(frame,[zoom],5));assert.ok(validVideoEffect(fade,[zoom,frame],5));
 assert.equal(createVideoEffect("frame",1,5,[frame]),null);
 assert.equal(createVideoEffect("fade",1,5,[fade]),null);
 assert.deepEqual([frame.start,frame.end,frame.width,frame.height],[0,5,1,1]);
});

test("spotlight supports free resizing, source bounds and timed overlap",()=>{
 const spotlight=createVideoEffect("spotlight",0,5,[]);
 const next=resizeVideoEffectFromHandle(spotlight,.1,.05,"se");
 assert.notEqual(next.width,next.height);assert.ok(validVideoEffect(next,[spotlight],5));
});

test("portrait crop and background preserve aspect, and pointer transform follows zoom then frame",()=>{
 const source={width:1600,height:900};
 const frame=cropVideoFrame(createVideoEffect("frame",0,5,[]),9/16,source);
 assert.ok(Math.abs(frame.width/frame.height*1600/900-9/16)<1e-10);
 const fitted=videoFrameRect(frame);
 assert.ok(Math.abs(fitted.width/fitted.height-frame.width/frame.height)<1e-10);
 const zoom={...createVideoEffect("zoom",0,5,[]),transition:0};
 const tr=videoPreviewTransform([zoom,frame],1);
 // The center source point remains centered after both camera operations.
 assert.ok(Math.abs(tr.x+.5*tr.sx-.5)<1e-10);
 assert.ok(Math.abs(tr.y+.5*tr.sy-.5)<1e-10);
 // A preview drag maps back to the same source displacement.
 assert.ok(Math.abs((.1/tr.sx)*tr.sx-.1)<1e-10);
});
