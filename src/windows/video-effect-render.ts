import {videoEffectEnvelope,videoFrameRect,videoZoomViewport,type VideoEffect} from "./video-effects";
import {orderedVideoLayers} from "./video-layers";
import {blurCanvas} from "../annotation/canvas-blur";

/** Masks cover annotations too, matching native composition before zoom. */
export function paintVideoMasks(ctx:CanvasRenderingContext2D,effects:VideoEffect[],scratch:HTMLCanvasElement) {
  const {width,height}=ctx.canvas;
  const sample=scratch.getContext("2d");
  if(!sample)return;
  for(const effect of effects) {
    if(effect.kind!=="mask")continue;
    const x=Math.floor(effect.x*width),y=Math.floor(effect.y*height);
    const w=Math.ceil((effect.x+effect.width)*width)-x,h=Math.ceil((effect.y+effect.height)*height)-y;
    const style=effect.maskStyle??"solid",strength=effect.strength??.5;
    ctx.save();
    if(style==="solid") {
      ctx.fillStyle=`#${(effect.color??0).toString(16).padStart(6,"0")}`;
      ctx.fillRect(x,y,w,h);
    } else if(style==="pixelate") {
      const block=Math.max(2,width*(.005+.045*strength));
      scratch.width=Math.max(1,Math.ceil(w/block));scratch.height=Math.max(1,Math.ceil(h/block));
      sample.drawImage(ctx.canvas,x,y,w,h,0,0,scratch.width,scratch.height);
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(scratch,0,0,scratch.width,scratch.height,x,y,w,h);
    } else {
      const radius=Math.max(1,width*(.003+.027*strength)),pad=Math.ceil(radius*3);
      const sx=Math.max(0,x-pad),sy=Math.max(0,y-pad),sw=Math.min(width,x+w+pad)-sx,sh=Math.min(height,y+h+pad)-sy;
      scratch.width=sw;scratch.height=sh;
      sample.drawImage(ctx.canvas,sx,sy,sw,sh,0,0,sw,sh);
      blurCanvas(scratch,radius);
      ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
      ctx.drawImage(scratch,sx,sy);
    }
    ctx.restore();
  }
}

/** Each stack uses the same explicit order as the platform encoders. */
export function paintVideoEffects(ctx:CanvasRenderingContext2D,effects:VideoEffect[],time:number,scratch:HTMLCanvasElement) {
  for(const effect of orderedVideoLayers(effects))paintVideoEffect(ctx,effect,time,scratch);
}
export function paintVideoEffect(ctx:CanvasRenderingContext2D,effect:VideoEffect,time:number,scratch:HTMLCanvasElement) {
  const effects=[effect];
  paintVideoMasks(ctx,effects,scratch);
  const {width,height}=ctx.canvas,sample=scratch.getContext("2d");if(!sample)return;
  for(const effect of effects.filter(e=>e.kind==="spotlight")){
    const x=Math.floor(effect.x*width),y=Math.floor(effect.y*height),right=Math.ceil((effect.x+effect.width)*width),bottom=Math.ceil((effect.y+effect.height)*height);
    ctx.save();ctx.fillStyle=`rgba(0,0,0,${effect.strength??.65})`;
    ctx.beginPath();ctx.rect(0,0,width,height);ctx.rect(x,y,right-x,bottom-y);ctx.fill("evenodd");ctx.restore();
  }
  const zoom=effects.find(e=>e.kind==="zoom");
  if(zoom){const v=videoZoomViewport(zoom,time);scratch.width=width;scratch.height=height;sample.drawImage(ctx.canvas,0,0);ctx.clearRect(0,0,width,height);ctx.drawImage(scratch,v.x*width,v.y*height,v.width*width,v.height*height,0,0,width,height);}
  const frame=effects.find(e=>e.kind==="frame");
  if(frame){
    scratch.width=width;scratch.height=height;sample.drawImage(ctx.canvas,0,0);
    const r=videoFrameRect(frame);ctx.fillStyle=`#${(frame.color??0).toString(16).padStart(6,"0")}`;ctx.fillRect(0,0,width,height);
    ctx.drawImage(scratch,frame.x*width,frame.y*height,frame.width*width,frame.height*height,r.x*width,r.y*height,r.width*width,r.height*height);
  }
  const fade=effects.find(e=>e.kind==="fade");
  if(fade){ctx.save();ctx.globalAlpha=1-videoEffectEnvelope(fade,time);ctx.fillStyle=`#${(fade.color??0).toString(16).padStart(6,"0")}`;ctx.fillRect(0,0,width,height);ctx.restore();}
}
