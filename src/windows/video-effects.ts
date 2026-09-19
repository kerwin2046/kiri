export type VideoEffect = {
  id: string;
  kind: "zoom" | "mask" | "spotlight" | "frame" | "fade";
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  maskStyle?: "solid" | "blur" | "pixelate";
  strength?: number;
  color?: number;
  transition?: number;
};

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const effectLabels = {zoom:"Zoom",mask:"Privacy mask",spotlight:"Spotlight",frame:"Crop & background",fade:"Fade in & out"} as const;

const exclusive = (kind:VideoEffect["kind"]) => kind==="zoom"||kind==="frame"||kind==="fade";

export function activeVideoEffects(effects: VideoEffect[], time: number): VideoEffect[] {
  return effects.filter(effect => time >= effect.start && time < effect.end);
}

export function validVideoEffect(effect: VideoEffect, effects: VideoEffect[], duration: number): boolean {
  if (![effect.start, effect.end, effect.x, effect.y, effect.width, effect.height, duration].every(Number.isFinite)) return false;
  if (![effect.strength ?? .5, effect.transition ?? 0, effect.color ?? 0].every(Number.isFinite)) return false;
  if ((effect.strength ?? .5)<0 || (effect.strength ?? .5)>1 || (effect.transition ?? 0)<0 || (effect.transition ?? 0)>2 || !Number.isInteger(effect.color ?? 0) || (effect.color ?? 0)<0 || (effect.color ?? 0)>0xffffff) return false;
  if (!["solid","blur","pixelate"].includes(effect.maskStyle ?? "solid")) return false;
  if (effect.start < 0 || effect.end > duration || effect.end - effect.start < 0.05 - 1e-9) return false;
  if (effect.x < 0 || effect.y < 0 || effect.width < 0.02 || effect.height < 0.02 || effect.x + effect.width > 1.000001 || effect.y + effect.height > 1.000001) return false;
  if (effect.kind === "zoom") {
    if (Math.abs(effect.width - effect.height) > 0.000001 || effect.width < 0.25 || effect.width > 1 / 1.5) return false;
  }
  if (exclusive(effect.kind)&&effects.some(other => other.id !== effect.id && other.kind === effect.kind && effect.start < other.end && effect.end > other.start)) return false;
  return true;
}

export function defaultOverlayRange(time: number, duration: number): {start: number; end: number} {
  const start = clamp(time, 0, Math.max(0, duration - Math.min(1, duration)));
  return {start, end: Math.min(duration, start + 3)};
}

export function createVideoEffect(kind: VideoEffect["kind"], time: number, duration: number, effects: VideoEffect[]): VideoEffect | null {
  if (effects.length >= 128) return null;
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration < 0.05) return null;
  const range = kind==="frame"||kind==="fade"?{start:0,end:duration}:defaultOverlayRange(time, duration);
  const start = range.start;
  let end = range.end;
  if (exclusive(kind)) {
    if (effects.some(effect => effect.kind === kind && effect.start <= start && effect.end > start)) return null;
    for (const effect of effects) if (effect.kind === kind && effect.start > start) end = Math.min(end, effect.start);
  }
  if (end - start < 0.05 - 1e-9) return null;
  const size = kind === "frame"||kind === "fade"?1:kind === "mask"?.25:.5;
  return {id: crypto.randomUUID(), kind, start, end, x: (1 - size) / 2, y: (1 - size) / 2, width: size, height: size,
    maskStyle:"blur",strength:kind==="frame"?.32:.65,color:kind==="frame"?0xf2f1ee:0,transition:kind==="fade"?.5:kind==="zoom"?.35:0};
}

export function moveVideoEffect(effect: VideoEffect, dx: number, dy: number): VideoEffect {
  return {...effect, x: clamp(effect.x + dx, 0, 1 - effect.width), y: clamp(effect.y + dy, 0, 1 - effect.height)};
}

export function resizeVideoEffect(effect: VideoEffect, dx: number, dy: number): VideoEffect {
  if (effect.kind === "zoom") {
    const size = clamp(effect.width + (Math.abs(dx) > Math.abs(dy) ? dx : dy), 0.25, 1 / 1.5);
    return {...effect, width: size, height: size, x: Math.min(effect.x, 1 - size), y: Math.min(effect.y, 1 - size)};
  }
  return {...effect, width: clamp(effect.width + dx, 0.02, 1 - effect.x), height: clamp(effect.height + dy, 0.02, 1 - effect.y)};
}


export type EffectHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Resize from the opposite edge/corner; zoom rectangles retain source aspect. */
export function resizeVideoEffectFromHandle(effect:VideoEffect,dx:number,dy:number,handle:EffectHandle):VideoEffect {
  const west=handle.includes("w"),east=handle.includes("e"),north=handle.includes("n"),south=handle.includes("s");
  const right=effect.x+effect.width,bottom=effect.y+effect.height;
  if(effect.kind!=="zoom") {
    const x=west?clamp(effect.x+dx,0,right-.02):effect.x;
    const y=north?clamp(effect.y+dy,0,bottom-.02):effect.y;
    const endX=east?clamp(right+dx,x+.02,1):right;
    const endY=south?clamp(bottom+dy,y+.02,1):bottom;
    return {...effect,x,y,width:endX-x,height:endY-y};
  }
  const horizontal=west||east,vertical=north||south;
  const delta=horizontal&&(!vertical||Math.abs(dx)>Math.abs(dy))?dx*(west?-1:1):dy*(north?-1:1);
  const cx=effect.x+effect.width/2,cy=effect.y+effect.height/2;
  const limitX=west?right:east?1-effect.x:2*Math.min(cx,1-cx);
  const limitY=north?bottom:south?1-effect.y:2*Math.min(cy,1-cy);
  const size=clamp(effect.width+delta,.25,Math.min(1/1.5,limitX,limitY));
  return {...effect,x:west?right-size:east?effect.x:cx-size/2,y:north?bottom-size:south?effect.y:cy-size/2,width:size,height:size};
}

/** Smoothstep entry/exit, shared mathematically with native frame compositors. */
export function videoZoomViewport(effect:VideoEffect,time:number) {
  const eased=videoEffectEnvelope(effect,time);
  return {x:effect.x*eased,y:effect.y*eased,width:1+(effect.width-1)*eased,height:1+(effect.height-1)*eased};
}

export function videoEffectEnvelope(effect:VideoEffect,time:number) {
  const ramp=Math.min(effect.transition??0,(effect.end-effect.start)/2);
  const progress=ramp>0?Math.min(clamp((time-effect.start)/ramp,0,1),clamp((effect.end-time)/ramp,0,1)):1;
  return progress*progress*(3-2*progress);
}

/** Fit the selected crop without stretching, inside a fixed output canvas. */
export function videoFrameRect(effect:VideoEffect) {
  const padding=(effect.strength??.32)*.25;
  const scale=Math.min((1-2*padding)/effect.width,(1-2*padding)/effect.height);
  // Normalized width/height have the same source and destination aspect ratio.
  const width=effect.width*scale,height=effect.height*scale;
  return {x:(1-width)/2,y:(1-height)/2,width,height};
}

export function cropVideoFrame(effect:VideoEffect,ratio:number|null,source:{width:number;height:number}):VideoEffect {
  const relative=ratio===null?1:ratio/(source.width/source.height);
  const width=Math.min(1,relative),height=Math.min(1,1/relative);
  return {...effect,x:clamp(effect.x+(effect.width-width)/2,0,1-width),y:clamp(effect.y+(effect.height-height)/2,0,1-height),width,height};
}

/** Source-to-preview transform, also used to keep drag coordinates on the image. */
export function videoPreviewTransform(effects:VideoEffect[],time:number) {
  let x=0,y=0,sx=1,sy=1;
  let clip={x:0,y:0,width:1,height:1};
  const active=activeVideoEffects(effects,time),zoom=active.find(e=>e.kind==="zoom"),frame=active.find(e=>e.kind==="frame");
  if(zoom){const v=videoZoomViewport(zoom,time);sx=1/v.width;sy=1/v.height;x=-v.x*sx;y=-v.y*sy;}
  if(frame){const r=videoFrameRect(frame),fx=r.width/frame.width,fy=r.height/frame.height;clip=r;x=r.x+(x-frame.x)*fx;y=r.y+(y-frame.y)*fy;sx*=fx;sy*=fy;}
  return {x,y,sx,sy,clip};
}
