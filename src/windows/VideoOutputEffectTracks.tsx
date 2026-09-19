import {useEffect,useRef,useState,type PointerEvent} from "react";
import {Focus,Shield,Pencil,Scan,Frame,SunMoon,GripVertical} from "lucide-react";
import {fmt,t} from "../i18n";
import {projectTimedRange,timelineDuration,sourceAtOutput,type VideoSegment,type ProjectedRange} from "./video-trim.js";
import {effectLabels,type VideoEffect} from "./video-effects";
import {isVideoAdjustment,moveVideoLayer,orderedVideoLayers,retimeVideoLayer} from "./video-layers";

type Props={effects:VideoEffect[];segments:VideoSegment[];sourceDuration:number;playhead:number;labels:Record<string,string>;selectedId:string|null;disabled:boolean;onSelect(id:string):void;onSeek(sourceTime:number):void;onChange(effects:VideoEffect[],transient?:boolean):void};
type Mode="move"|"start"|"end";
const effectIcons={zoom:Focus,mask:Shield,spotlight:Scan,frame:Frame,fade:SunMoon};

export function VideoOutputEffectTracks(props:Props){
  const total=timelineDuration(props.segments);
  const root=useRef<HTMLDivElement>(null),cleanupGesture=useRef<(()=>void)|null>(null);
  const [drag,setDrag]=useState<{id:string;before:string|null;group:boolean}|null>(null);
  useEffect(()=>()=>cleanupGesture.current?.(),[]);
  const label=(effect:VideoEffect)=>props.labels[effect.id]??t(effectLabels[effect.kind]);
  const rows=orderedVideoLayers(props.effects).reverse().map(effect=>({effect,ranges:projectTimedRange(props.segments,effect.start,effect.end)}));
  const visible=rows.filter(row=>row.ranges.length),hidden=rows.filter(row=>!row.ranges.length);
  function select(effect:VideoEffect,range=projectTimedRange(props.segments,effect.start,effect.end)[0]){
    props.onSelect(effect.id);
    if(range)props.onSeek(Math.min(range.sourceEnd-.001,range.sourceStart+Math.min(effect.transition??0,(effect.end-effect.start)/2)));
  }
  function begin(event:PointerEvent<HTMLElement>,effect:VideoEffect,range:ProjectedRange,mode:Mode){
    if(props.disabled||event.button!==0)return;
    const rect=event.currentTarget.closest(".kiri-video-effect-track")?.getBoundingClientRect();if(!rect?.width||!total)return;
    event.preventDefault();event.stopPropagation();cleanupGesture.current?.();
    const target=event.currentTarget,origin=event.clientX,original=props.effects;
    const startOutput=(origin-rect.left)/rect.width*total;
    const startSource=sourceAtOutput(props.segments,Math.max(0,Math.min(total,startOutput)))?.time??range.sourceStart;
    let latest=original,moved=false;
    target.focus();target.setPointerCapture(event.pointerId);select(effect,range);
    const move=(e:globalThis.PointerEvent)=>{
      if(!moved&&Math.abs(e.clientX-origin)<3)return;
      moved=true;
      const output=startOutput+(e.clientX-origin)/rect.width*total;
      const destination=sourceAtOutput(props.segments,Math.max(0,Math.min(total,output)));
      if(!destination)return;
      // Follow the destination clip across cuts and speed changes, including reordered clips.
      const delta=destination.index===range.index?(e.clientX-origin)/rect.width*total*range.speed:destination.time-startSource;
      const next=retimeVideoLayer(effect,mode,delta,original,props.sourceDuration);
      latest=original.map(item=>item.id===effect.id?next:item);
      props.onChange(latest,true);
      props.onSeek(mode==="end"?next.end-.001:next.start+Math.min(next.transition??0,(next.end-next.start)/2));
    };
    const cleanup=()=>{target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",finish);target.removeEventListener("pointercancel",cancel);target.removeEventListener("lostpointercapture",cancel);window.removeEventListener("keydown",key,true);cleanupGesture.current=null;};
    const finish=()=>{cleanup();if(moved)props.onChange(latest,false);};
    const cancel=()=>{cleanup();if(moved)props.onChange(original,false);};
    const key=(e:globalThis.KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();cancel();}};
    cleanupGesture.current=cancel;
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",finish);target.addEventListener("pointercancel",cancel);target.addEventListener("lostpointercapture",cancel);window.addEventListener("keydown",key,true);
  }
  function reorder(event:PointerEvent<HTMLButtonElement>,effect:VideoEffect){
    if(props.disabled||event.button!==0)return;
    event.preventDefault();event.stopPropagation();cleanupGesture.current?.();
    const target=event.currentTarget,origin=event.clientY,group=isVideoAdjustment(effect);
    const peers=visible.filter(row=>isVideoAdjustment(row.effect)===group&&row.effect.id!==effect.id);
    const viewport=root.current?.closest<HTMLElement>(".kiri-video-lanes-scroll");
    let y=origin,before:string|null=null,moved=false,frame=0;
    target.focus();target.setPointerCapture(event.pointerId);select(effect);
    const update=()=>{
      if(!moved)return;
      if(viewport){const rect=viewport.getBoundingClientRect(),zone=28;const delta=y<rect.top+zone?-Math.min(10,(rect.top+zone-y)/3):y>rect.bottom-zone?Math.min(10,(y-rect.bottom+zone)/3):0;viewport.scrollTop+=delta;}
      before=peers.find(row=>{const rect=root.current?.querySelector<HTMLElement>(`[data-effect-id="${CSS.escape(row.effect.id)}"]`)?.getBoundingClientRect();return rect&&y<rect.top+rect.height/2;})?.effect.id??null;
      setDrag(previous=>previous?.id===effect.id&&previous.before===before?previous:{id:effect.id,before,group});
      frame=requestAnimationFrame(update);
    };
    const move=(e:globalThis.PointerEvent)=>{y=e.clientY;if(!moved&&Math.abs(y-origin)>=4){moved=true;update();}};
    const cleanup=()=>{cancelAnimationFrame(frame);target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",finish);target.removeEventListener("pointercancel",cancel);target.removeEventListener("lostpointercapture",cancel);window.removeEventListener("keydown",key,true);cleanupGesture.current=null;setDrag(null);};
    const finish=()=>{cleanup();if(moved)props.onChange(moveVideoLayer(props.effects,effect.id,before));};
    const cancel=()=>cleanup();
    const key=(e:globalThis.KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();cancel();}};
    cleanupGesture.current=cancel;
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",finish);target.addEventListener("pointercancel",cancel);target.addEventListener("lostpointercapture",cancel);window.addEventListener("keydown",key,true);
  }
  function adjust(effect:VideoEffect,range:ProjectedRange,mode:Mode,delta:number){
    const next=retimeVideoLayer(effect,mode,delta*range.speed,props.effects,props.sourceDuration);
    props.onSelect(effect.id);props.onChange(props.effects.map(item=>item.id===effect.id?next:item));props.onSeek(mode==="end"?next.end-.001:next.start);
  }
  function stepLayer(effect:VideoEffect,direction:number){
    const peers=rows.filter(row=>isVideoAdjustment(row.effect)===isVideoAdjustment(effect));
    const from=peers.findIndex(row=>row.effect.id===effect.id),to=Math.max(0,Math.min(peers.length-1,from+direction));
    if(to===from)return;
    const rest=peers.filter(row=>row.effect.id!==effect.id);
    props.onChange(moveVideoLayer(props.effects,effect.id,rest[to]?.effect.id??null));
  }
  return <div ref={root} className="kiri-video-effect-tracks" aria-label={t("Effect tracks")}>
    {[true,false].map(group=>{const items=visible.filter(row=>isVideoAdjustment(row.effect)===group);if(!items.length)return null;return <div className="kiri-video-track-group" key={String(group)}>
      <div className="kiri-video-track-group-heading"><span>{t(group?"Picture adjustments":"Overlays")}</span><small>{t(group?"Applies to the whole picture":"Upper layers cover lower layers")}</small></div>
      {items.map(({effect,ranges})=>{const Icon=props.labels[effect.id]?Pencil:effectIcons[effect.kind];return <div key={effect.id} className="kiri-video-effect-track" data-effect-id={effect.id} data-selected={effect.id===props.selectedId} data-dragging={drag?.id===effect.id} data-drop-before={drag?.before===effect.id}>
        <button type="button" className="kiri-video-layer-label" disabled={props.disabled} aria-label={`${label(effect)} · ${t("Drag up or down to reorder")}`} title={t("Drag up or down to reorder. Alt + arrow keys also works.")} onPointerDown={event=>reorder(event,effect)} onClick={event=>{if(event.detail===0)select(effect);}} onKeyDown={event=>{if(event.altKey&&["ArrowUp","ArrowDown"].includes(event.key)){event.preventDefault();event.stopPropagation();stepLayer(effect,event.key==="ArrowUp"?-1:1);}}}><GripVertical size={12}/><Icon size={13}/><span>{label(effect)}</span></button>
        {ranges.map(range=><div key={range.index} className="kiri-video-effect-bar" data-selected={effect.id===props.selectedId} style={{left:`${range.start/total*100}%`,width:`${(range.end-range.start)/total*100}%`}}>
          <button type="button" className="kiri-video-effect-bar-body" disabled={props.disabled} aria-pressed={effect.id===props.selectedId} aria-label={`${label(effect)} · ${range.start.toFixed(1)}–${range.end.toFixed(1)} s`} title={t("Drag the middle to move; drag either edge to change the duration.")} onPointerDown={event=>begin(event,effect,range,"move")} onClick={event=>{if(event.detail===0)select(effect,range);}} onKeyDown={event=>{if(["ArrowLeft","ArrowRight"].includes(event.key)){event.preventDefault();event.stopPropagation();adjust(effect,range,"move",(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?1:.1));}}}><span>{label(effect)}</span><small>{(range.end-range.start).toFixed(1)} s</small></button>
          {(["start","end"] as const).map(edge=><div key={edge} role="slider" tabIndex={props.disabled?-1:0} className={`kiri-video-effect-time-handle kiri-video-effect-time-handle--${edge}`} aria-label={`${label(effect)} · ${t(edge==="start"?"Effect start":"Effect end")}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={range[edge]} aria-valuetext={`${range[edge].toFixed(2)} s`} title={t(edge==="start"?"Drag to change the start":"Drag to change the end")} onPointerDown={event=>begin(event,effect,range,edge)} onKeyDown={event=>{if(props.disabled)return;if(["ArrowLeft","ArrowRight"].includes(event.key)){event.preventDefault();event.stopPropagation();adjust(effect,range,edge,(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?1:.1));}}}/>)}
        </div>)}
        <i className="kiri-video-layer-playhead" style={{left:`${total?Math.min(total,props.playhead)/total*100:0}%`}}/>
      </div>;})}
      {drag?.group===group&&drag.before===null&&<div className="kiri-video-layer-drop-end"/>}
    </div>;})}
    {hidden.length>0&&<details className="kiri-video-unused-effects"><summary>{fmt("%d effects outside the edit",hidden.length)}</summary><p>{t("These effects stay saved but do not appear in this export.")}</p>{hidden.map(({effect})=><button type="button" className="kiri-video-unused-effect" disabled={props.disabled} key={effect.id} onClick={()=>{props.onSelect(effect.id);props.onSeek(effect.start);}}>{label(effect)} · {effect.start.toFixed(1)}–{effect.end.toFixed(1)} s</button>)}</details>}
  </div>;
}
