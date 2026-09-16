import type {VideoEffect} from "./video-effects";

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
      scratch.width=width+2*pad;scratch.height=height+2*pad;
      sample.drawImage(ctx.canvas,pad,pad);
      // Clamp source edges before blurring; transparent margins would leak sharp pixels.
      sample.drawImage(ctx.canvas,0,0,width,1,pad,0,width,pad);
      sample.drawImage(ctx.canvas,0,height-1,width,1,pad,pad+height,width,pad);
      sample.drawImage(ctx.canvas,0,0,1,height,0,pad,pad,height);
      sample.drawImage(ctx.canvas,width-1,0,1,height,pad+width,pad,pad,height);
      for(const [sx,sy,tx,ty] of [[0,0,0,0],[width-1,0,pad+width,0],[0,height-1,0,pad+height],[width-1,height-1,pad+width,pad+height]])sample.drawImage(ctx.canvas,sx,sy,1,1,tx,ty,pad,pad);
      ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
      ctx.filter=`blur(${radius}px)`;
      ctx.drawImage(scratch,-pad,-pad);
    }
    ctx.restore();
  }
}
