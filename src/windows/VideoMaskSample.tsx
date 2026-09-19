import {useEffect,useRef} from "react";
import type {VideoEffect} from "./video-effects";
import {paintVideoMasks} from "./video-effect-render";

/** Use the current source frame and the same mask renderer as the main preview. */
export function VideoMaskSample({video,effect,frameSource}:{video:HTMLVideoElement|null;effect:VideoEffect;frameSource?:{current:HTMLCanvasElement|null}}){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    if(!video)return;
    const source=document.createElement("canvas"),scratch=document.createElement("canvas");
    let frame=0;
    const draw=()=>{
      cancelAnimationFrame(frame);
      const output=canvas.current;
      if(output&&video.readyState>=2&&!video.seeking){
        const scale=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));
        source.width=Math.max(1,Math.round(video.videoWidth*scale));source.height=Math.max(1,Math.round(video.videoHeight*scale));
        const context=source.getContext("2d"),target=output.getContext("2d");
        if(context&&target){
          context.drawImage(frameSource?.current??video,0,0,source.width,source.height);paintVideoMasks(context,[effect],scratch);
          output.width=160;output.height=90;
          const x=effect.x*source.width,y=effect.y*source.height,w=effect.width*source.width,h=effect.height*source.height;
          const fit=Math.min(output.width/w,output.height/h);
          target.drawImage(source,x,y,w,h,(output.width-w*fit)/2,(output.height-h*fit)/2,w*fit,h*fit);
        }
      }
      if(!video.paused)frame=requestAnimationFrame(draw);
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);};
    // WebKit may present a seeked frame later; wait for the compositor's fresh sample too.
    const events=["loadeddata","seeked","play","pause","kiri-mask-preview-frame"];
    events.forEach(event=>video.addEventListener(event,schedule));schedule();
    return()=>{cancelAnimationFrame(frame);events.forEach(event=>video.removeEventListener(event,schedule));};
  },[video,effect,frameSource]);
  return <canvas ref={canvas} className="kiri-effect-style-sample" aria-hidden="true"/>;
}
