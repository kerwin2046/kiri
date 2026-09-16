import {useRef, type PointerEvent} from "react";
import {Focus, Shield, Pencil} from "lucide-react";
import {fmt,t} from "../i18n";
import {clamp,validVideoEffect,type VideoEffect} from "./video-effects";
import {videoTimeLabel} from "./video-trim.js";

type Props={labels?:Record<string,string>;effects:VideoEffect[];duration:number;selectedId:string|null;disabled:boolean;onSelect(id:string):void;onChange(effects:VideoEffect[],transient?:boolean):void;onSeek(time:number):void};
type Gesture={id:string;origin:number;width:number;mode:"move"|"start"|"end";original:VideoEffect[];latest:VideoEffect[]};
export function VideoEffectTracks(props:Props){
  const gesture=useRef<Gesture|null>(null);
  const label=(effect:VideoEffect)=>props.labels?.[effect.id]??t(effect.kind==="zoom"?"Zoom":effect.maskStyle==="blur"?"Blur":effect.maskStyle==="pixelate"?"Pixel":"Privacy mask");
  function shifted(effect:VideoEffect,delta:number,mode:Gesture["mode"]){
    if(mode==="move") {const start=clamp(effect.start+delta,0,props.duration-(effect.end-effect.start));return {...effect,start,end:start+effect.end-effect.start};}
    if(mode==="start")return {...effect,start:clamp(effect.start+delta,0,effect.end-.05)};
    return {...effect,end:clamp(effect.end+delta,effect.start+.05,props.duration)};
  }
  function begin(event:PointerEvent<HTMLElement>,effect:VideoEffect,mode:Gesture["mode"]){
    if(props.disabled||event.button!==0)return;
    const row=event.currentTarget.closest(".kiri-video-effect-track")?.getBoundingClientRect();if(!row?.width)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);
    props.onSelect(effect.id);props.onSeek(effect.start);
    gesture.current={id:effect.id,origin:event.clientX,width:row.width,mode,original:props.effects,latest:props.effects};
  }
  function move(event:PointerEvent<HTMLElement>){
    const state=gesture.current;if(!state)return;
    const effect=state.original.find(e=>e.id===state.id)!;
    const next=shifted(effect,(event.clientX-state.origin)/state.width*props.duration,state.mode);
    if(!validVideoEffect(next,state.original,props.duration))return;
    state.latest=state.original.map(e=>e.id===next.id?next:e);props.onChange(state.latest,true);
  }
  function finish(cancel=false){const state=gesture.current;if(!state)return;gesture.current=null;props.onChange(cancel?state.original:state.latest,false);}
  return <div className="kiri-video-effect-tracks" aria-label={t("Effect tracks")}>
    {props.effects.map((effect,index)=><div key={effect.id} className="kiri-video-effect-track">
      <span className="kiri-video-lane-label">{props.labels?.[effect.id]?<Pencil size={12}/>:effect.kind==="zoom"?<Focus size={12}/>:<Shield size={12}/>}<span>{label(effect)} {index+1}</span></span>
      <div className="kiri-video-effect-bar" data-selected={effect.id===props.selectedId} style={{left:`${effect.start/props.duration*100}%`,width:`${(effect.end-effect.start)/props.duration*100}%`}}>
        <button type="button" disabled={props.disabled} className="kiri-video-effect-bar-body" aria-pressed={effect.id===props.selectedId}
          aria-label={fmt("Effect %d: %@ to %@",index+1,videoTimeLabel(effect.start),videoTimeLabel(effect.end))}
          onClick={event=>{if(event.detail===0){props.onSelect(effect.id);props.onSeek(effect.start);}}}
          onPointerDown={event=>begin(event,effect,"move")} onPointerMove={move} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)}
          onKeyDown={event=>{if(props.disabled||!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();const next=shifted(effect,(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?1:.1),"move");if(validVideoEffect(next,props.effects,props.duration))props.onChange(props.effects.map(e=>e.id===next.id?next:e));}}>
          {effect.kind==="zoom"&&(effect.transition??0)>0&&<svg className="kiri-video-effect-envelope" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d={(()=>{const ramp=Math.min(50,(effect.transition??0)/(effect.end-effect.start)*100);return `M0 22 C${ramp/2} 22 ${ramp/2} 2 ${ramp} 2 H${100-ramp} C${100-ramp/2} 2 ${100-ramp/2} 22 100 22`;})()}/></svg>}
          <span>{label(effect)}</span>
        </button>
        {(["start","end"] as const).map(edge=><div key={edge} role="slider" tabIndex={props.disabled?-1:0} aria-label={fmt(edge==="start"?"Effect %d start":"Effect %d end",index+1)} aria-valuemin={0} aria-valuemax={props.duration} aria-valuenow={effect[edge]}
          className={`kiri-video-effect-time-handle kiri-video-effect-time-handle--${edge}`}
          onPointerDown={event=>begin(event,effect,edge)} onPointerMove={move} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)}
          onKeyDown={event=>{if(props.disabled||!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();props.onSelect(effect.id);const next=shifted(effect,(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?1:.1),edge);if(validVideoEffect(next,props.effects,props.duration))props.onChange(props.effects.map(e=>e.id===next.id?next:e));}}/>)}
      </div>
    </div>)}
  </div>;
}
