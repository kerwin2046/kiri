import {useRef,type PointerEvent} from "react";
import {Focus,Shield,Pencil,Scan,Frame,SunMoon} from "lucide-react";
import {fmt,t} from "../i18n";
import {projectTimedRange,timelineDuration,type VideoSegment,type ProjectedRange} from "./video-trim.js";
import {validVideoEffect,effectLabels,type VideoEffect} from "./video-effects";
type Props={effects:VideoEffect[];segments:VideoSegment[];sourceDuration:number;labels:Record<string,string>;selectedId:string|null;disabled:boolean;onSelect(id:string):void;onSeek(sourceTime:number):void;onChange(effects:VideoEffect[],transient?:boolean):void};
type Mode="move"|"start"|"end";
export function VideoOutputEffectTracks(props:Props){
  const total=timelineDuration(props.segments);
  const gesture=useRef(false);
  const label=(effect:VideoEffect)=>props.labels[effect.id]??t(effectLabels[effect.kind]);
  function begin(event:PointerEvent<HTMLElement>,effect:VideoEffect,range:ProjectedRange,mode:Mode){
    if(props.disabled||event.button!==0)return;
    const row=event.currentTarget.closest(".kiri-video-effect-track")?.getBoundingClientRect();if(!row?.width)return;
    event.preventDefault();event.stopPropagation();const target=event.currentTarget,origin=event.clientX,original=props.effects;
    let latest=original;gesture.current=true;target.focus();target.setPointerCapture(event.pointerId);props.onSelect(effect.id);props.onSeek(Math.min(range.sourceEnd-.001,range.sourceStart+Math.min(effect.transition??0,(effect.end-effect.start)/2)));
    const move=(e:globalThis.PointerEvent)=>{
      let delta=(e.clientX-origin)/row.width*total*range.speed;
      if(mode==="move")delta=Math.max(-effect.start,Math.min(props.sourceDuration-effect.end,delta));
      const next={...effect,start:mode==="end"?effect.start:effect.start+delta,end:mode==="start"?effect.end:effect.end+delta};
      const clip=props.segments[range.index];
      if(!clip||next.end<=clip.start+.001||next.start>=clip.end-.001||!validVideoEffect(next,original,props.sourceDuration))return;
      latest=original.map(item=>item.id===effect.id?next:item);props.onChange(latest,true);props.onSeek(mode==="end"?next.end-.001:next.start+Math.min(next.transition??0,(next.end-next.start)/2));
    };
    const cleanup=()=>{target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",finish);target.removeEventListener("pointercancel",cancel);window.removeEventListener("keydown",key,true);gesture.current=false;};
    const finish=()=>{cleanup();props.onChange(latest,false);};
    const cancel=()=>{cleanup();props.onChange(original,false);};
    const key=(e:globalThis.KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();cancel();}};
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",finish);target.addEventListener("pointercancel",cancel);window.addEventListener("keydown",key,true);
  }
  function adjust(effect:VideoEffect,range:ProjectedRange,mode:Mode,delta:number){
    const next={...effect,start:mode==="end"?effect.start:effect.start+delta*range.speed,end:mode==="start"?effect.end:effect.end+delta*range.speed};
    if(validVideoEffect(next,props.effects,props.sourceDuration)){props.onSelect(effect.id);props.onChange(props.effects.map(item=>item.id===effect.id?next:item));}
  }
  const rows=props.effects.map(effect=>({effect,ranges:projectTimedRange(props.segments,effect.start,effect.end)}));
  return <><div className="kiri-video-effect-tracks" aria-label={t("Effect tracks")}>
    {rows.filter(row=>row.ranges.length).map(({effect,ranges})=><div key={effect.id} className="kiri-video-effect-track" data-effect-id={effect.id}>
      <span className="kiri-video-lane-label">{props.labels[effect.id]?<Pencil size={12}/>:effect.kind==="zoom"?<Focus size={12}/>:effect.kind==="frame"?<Frame size={12}/>:effect.kind==="fade"?<SunMoon size={12}/>:effect.kind==="spotlight"?<Scan size={12}/>:<Shield size={12}/>}<span>{label(effect)}</span></span>
      {ranges.map(range=><div key={range.index} className="kiri-video-effect-bar" data-selected={effect.id===props.selectedId} style={{left:`${range.start/total*100}%`,width:`${(range.end-range.start)/total*100}%`}}>
        <button type="button" className="kiri-video-effect-bar-body" disabled={props.disabled} aria-pressed={effect.id===props.selectedId} aria-label={`${label(effect)} · ${range.start.toFixed(1)}–${range.end.toFixed(1)} s`}
          onPointerDown={event=>begin(event,effect,range,"move")} onClick={event=>{if(event.detail===0){props.onSelect(effect.id);props.onSeek(Math.min(range.sourceEnd-.001,range.sourceStart+Math.min(effect.transition??0,(effect.end-effect.start)/2)));}}}
          onKeyDown={event=>{if(["ArrowLeft","ArrowRight"].includes(event.key)){event.preventDefault();event.stopPropagation();adjust(effect,range,"move",(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?1:.1));}}}><span>{label(effect)}</span></button>
        {(["start","end"] as const).map(edge=><div key={edge} role="slider" tabIndex={props.disabled?-1:0} className={`kiri-video-effect-time-handle kiri-video-effect-time-handle--${edge}`} aria-label={`${label(effect)} · ${t(edge==="start"?"Effect start":"Effect end")}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={range[edge]}
          onPointerDown={event=>begin(event,effect,range,edge)} onKeyDown={event=>{if(props.disabled)return;if(["ArrowLeft","ArrowRight"].includes(event.key)){event.preventDefault();event.stopPropagation();adjust(effect,range,edge,(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?1:.1));}}}/>)}
      </div>)}
    </div>)}
  </div>{rows.some(row=>!row.ranges.length)&&<details className="kiri-video-unused-effects"><summary>{fmt("%d effects outside the edit",rows.filter(row=>!row.ranges.length).length)}</summary><p>{t("These effects stay saved but do not appear in this export.")}</p>{rows.filter(row=>!row.ranges.length).map(({effect})=><button type="button" className="kiri-video-unused-effect" disabled={props.disabled} key={effect.id} onClick={()=>{props.onSelect(effect.id);props.onSeek(effect.start);}}>{label(effect)} · {effect.start.toFixed(1)}–{effect.end.toFixed(1)} s</button>)}</details>}</>;
}
