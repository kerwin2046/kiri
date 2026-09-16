import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../src/windows/video-effects.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.ESNext}}).outputText;
const {activeVideoEffects, createVideoEffect, moveVideoEffect, resizeVideoEffect, validVideoEffect} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

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
