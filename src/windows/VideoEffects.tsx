import {useRef,useState} from "react";
import type {KeyboardEvent,PointerEvent} from "react";
import {Focus,Shield,Trash2,Play,Plus} from "lucide-react";
import {t,fmt} from "../i18n";
import {activeVideoEffects,clamp,createVideoEffect,moveVideoEffect,resizeVideoEffectFromHandle,validVideoEffect} from "./video-effects";
import type {VideoEffect,EffectHandle} from "./video-effects";
import {VideoTimeInput} from "./VideoTimeInput";
import "./video-effects.css";
import {VideoMaskSample} from "./VideoMaskSample";
export type VideoEffectsProps={frameSource?:{current:HTMLCanvasElement|null};video?:HTMLVideoElement|null;regionLabel?:string;effects:VideoEffect[];onChange(effects:VideoEffect[],transient?:boolean):void;selectedId:string|null;onSelect(id:string|null):void;time:number;duration:number;disabled?:boolean;onSeek?(time:number):void;onPreview?(effectId:string):void;};

function EffectSlider(props:{label:string;value:number;min:number;max:number;step:number;text:string;disabled?:boolean;onChange(value:number,transient:boolean):void}){
  const dragging=useRef(false),latest=useRef(props.value);
  function finish(){if(!dragging.current)return;dragging.current=false;props.onChange(latest.current,false);}
  return <label className="kiri-effect-slider"><span>{props.label}<output>{props.text}</output></span><input type="range" className="kiri-range" value={props.value} min={props.min} max={props.max} step={props.step} disabled={props.disabled}
    onPointerDown={event=>{dragging.current=true;latest.current=props.value;event.currentTarget.setPointerCapture(event.pointerId);}}
    onChange={event=>{latest.current=Number(event.target.value);props.onChange(latest.current,dragging.current);}}
    onPointerUp={finish} onPointerCancel={finish} onBlur={finish}/></label>;
}
export function VideoEffectsControls(props:VideoEffectsProps){
  const [error,setError]=useState(false);
  const selected=props.effects.find(effect=>effect.id===props.selectedId);
  function add(kind:VideoEffect["kind"]){const effect=createVideoEffect(kind,props.time,props.duration,props.effects);if(!effect){setError(true);return;}setError(false);props.onChange([...props.effects,effect]);props.onSelect(effect.id);props.onSeek?.(effect.start);}
  function update(next:VideoEffect,transient=false){if(!validVideoEffect(next,props.effects,props.duration)){setError(true);return;}setError(false);props.onChange(props.effects.map(effect=>effect.id===next.id?next:effect),transient);}
  const transition=selected?Math.min(selected.transition??0,(selected.end-selected.start)/2):0;
  const hold=selected?Math.max(0,selected.end-selected.start-2*transition):0;
  const rampX=selected?220*transition/(selected.end-selected.start):0;
  const blocked=props.disabled||props.duration<.05||props.effects.length>=128;
  return <section className="kiri-video-effects" aria-label={t("Video effects")}>
    <div className="kiri-video-effects-heading"><strong>{t("Video effects")}</strong><span>{t("Local edits")}</span></div>
    <div className="kiri-video-effects-actions"><button type="button" className="kiri-effect-add" disabled={blocked} onClick={()=>add("zoom")}><Focus size={17}/><span>{t("Add zoom")}</span><Plus size={12}/></button><button type="button" className="kiri-effect-add" disabled={blocked} onClick={()=>add("mask")}><Shield size={17}/><span>{t("Add privacy mask")}</span><Plus size={12}/></button></div>
    {!selected?<p className="kiri-effect-empty">{t("Choose a track below to adjust its appearance and timing.")}</p>:<fieldset className="kiri-video-effect-fields" disabled={props.disabled}>
      <div className="kiri-effect-section-title"><span>{t(selected.kind==="zoom"?"Zoom":"Privacy mask")}</span><button type="button" className="kiri-effect-delete" disabled={props.disabled} aria-label={t("Delete effect")} title={t("Delete effect")} onClick={()=>{props.onChange(props.effects.filter(effect=>effect.id!==selected.id));props.onSelect(null);}}><Trash2 size={14}/></button></div>
      <button type="button" className="kiri-effect-preview" disabled={props.disabled} onClick={()=>{if(props.onPreview)props.onPreview(selected.id);else props.onSelect(null);}}><Play size={14}/>{t("Preview this effect")}</button>
      {selected.kind==="mask"?<><div className="kiri-effect-styles" role="group" aria-label={t("Mask style")}>
        {(["solid","blur","pixelate"] as const).map(style=><button type="button" key={style} className="kiri-effect-style" disabled={props.disabled} aria-pressed={(selected.maskStyle??"solid")===style} onClick={()=>update({...selected,maskStyle:style})}><VideoMaskSample frameSource={props.frameSource} video={props.video??null} effect={{...selected,maskStyle:style}}/><span>{t(style==="solid"?"Solid":style==="blur"?"Blur":"Pixel")}</span></button>)}
      </div>{(selected.maskStyle??"solid")==="solid"?<div className="kiri-effect-colors"><span>{t("Color")}</span>{[0,0xffffff].map(color=><button type="button" key={color} className="kiri-effect-color" disabled={props.disabled} aria-label={t(color?"White":"Black")} aria-pressed={(selected.color??0)===color} style={{background:color?"#fff":"#000"}} onClick={()=>update({...selected,color})}/>)}<label className="kiri-effect-custom-color" title={t("Custom color")}><input type="color" aria-label={t("Custom color")} value={`#${(selected.color??0).toString(16).padStart(6,"0")}`} onChange={event=>update({...selected,color:parseInt(event.target.value.slice(1),16)})}/><span>{t("Custom color")}</span></label></div>:<EffectSlider label={t("Intensity")} min={0} max={1} step={.01} value={selected.strength??.5} text={`${Math.round((selected.strength??.5)*100)}%`} onChange={(strength,transient)=>update({...selected,strength},transient)}/>}
      <p className="kiri-effect-note">{t("The mask follows the original image before zoom is applied.")}</p></>:<>
        <EffectSlider label={t("Zoom scale")} min={1.5} max={4} step={.05} value={1/selected.width} text={`${(1/selected.width).toFixed(2)}×`} onChange={(value,transient)=>{const size=1/value;update({...selected,width:size,height:size,x:clamp(selected.x+(selected.width-size)/2,0,1-size),y:clamp(selected.y+(selected.height-size)/2,0,1-size)},transient);}}/>
        <EffectSlider label={t("Smooth transition")} min={0} max={Math.min(2,(selected.end-selected.start)/2)} step={.01} value={transition} text={`${transition.toFixed(2)} s`} onChange={(transition,transient)=>update({...selected,transition},transient)}/>
        <div className="kiri-effect-easing" aria-hidden="true"><svg viewBox="0 0 220 36" preserveAspectRatio="none"><path d={transition>0?`M0 32 C${rampX/2} 32 ${rampX/2} 5 ${rampX} 5 H${220-rampX} C${220-rampX/2} 5 ${220-rampX/2} 32 220 32`:"M0 32 V5 H220 V32"}/></svg><span>{t("Zoom in")}<small>{transition.toFixed(2)} s</small></span><span>{t("Hold")}<small>{hold.toFixed(2)} s</small></span><span>{t("Zoom out")}<small>{transition.toFixed(2)} s</small></span></div>
        <p className="kiri-effect-note">{t("The frame keeps the source aspect ratio. Drag its center to reframe.")}</p>
      </>}
      <div className="kiri-effect-time-heading"><span>{t("Timing")}</span><output>{fmt("%@ seconds",(selected.end-selected.start).toFixed(2))}</output></div>
      <div className="kiri-effect-times"><label>{t("Effect start")}<VideoTimeInput key={`${selected.id}-start`} min={0} max={selected.end-.05} step={.1} value={selected.start} onCommit={start=>update({...selected,start})}/></label><label>{t("Effect end")}<VideoTimeInput key={`${selected.id}-end`} min={selected.start+.05} max={props.duration} step={.1} value={selected.end} onCommit={end=>update({...selected,end})}/></label></div>
    </fieldset>}
    {error&&<p className="kiri-video-effects-error" role="alert">{t("Use a valid time range. Zoom effects cannot overlap.")}</p>}
  </section>;
}

function resizeSticker(effect:VideoEffect,dx:number,dy:number,handle:EffectHandle):VideoEffect{
  const west=handle.includes("w"),north=handle.includes("n");
  const horizontal=(west?-dx:dx)/effect.width,vertical=(north?-dy:dy)/effect.height;
  const change=Math.abs(horizontal)>Math.abs(vertical)?horizontal:vertical;
  const anchorX=west?effect.x+effect.width:effect.x,anchorY=north?effect.y+effect.height:effect.y;
  const limit=Math.min((west?anchorX:1-anchorX)/effect.width,(north?anchorY:1-anchorY)/effect.height);
  const scale=Math.min(limit,Math.max(.01/effect.width,.01/effect.height,1+change));
  const width=effect.width*scale,height=effect.height*scale;
  return {...effect,x:west?anchorX-width:anchorX,y:north?anchorY-height:anchorY,width,height};
}

type Gesture = {id: string; x: number; y: number; width: number; height: number; mode: "move" | EffectHandle; original: VideoEffect[]; latest: VideoEffect[]};

export function VideoEffectsOverlay(props: VideoEffectsProps) {
  const layer = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const selected = props.effects.find(effect => effect.id === props.selectedId);

  const visible = activeVideoEffects(props.effects, props.time);
  if (selected&&!visible.some(effect => effect.id === selected.id)) visible.push(selected);
  function begin(event: PointerEvent<HTMLElement>, effect: VideoEffect, mode: "move" | EffectHandle) {
    if (props.disabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const rect = layer.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    props.onSelect(effect.id);
    gesture.current = {id: effect.id, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, mode, original: props.effects, latest: props.effects};
  }
  function move(event: PointerEvent<HTMLElement>) {
    const state = gesture.current;
    if (!state) return;
    const effect = state.original.find(item => item.id === state.id)!;
    const dx = (event.clientX - state.x) / state.width, dy = (event.clientY - state.y) / state.height;
    const next = state.mode === "move" ? moveVideoEffect(effect, dx, dy) : (props.regionLabel?resizeSticker(effect,dx,dy,state.mode):resizeVideoEffectFromHandle(effect, dx, dy, state.mode));
    state.latest = state.original.map(item => item.id === next.id ? next : item);
    props.onChange(state.latest, true);
  }
  function finish(cancel = false) {
    if (!gesture.current) return;
    props.onChange(cancel ? gesture.current.original : gesture.current.latest, false);
    gesture.current = null;
  }
  function keyboard(event: KeyboardEvent<HTMLElement>, effect: VideoEffect, handle: EffectHandle | null) {
    if (props.disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 0.02 : 0.002;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    const next = handle ? (props.regionLabel?resizeSticker(effect,dx,dy,handle):resizeVideoEffectFromHandle(effect, dx, dy, handle)) : moveVideoEffect(effect, dx, dy);
    props.onChange(props.effects.map(item => item.id === next.id ? next : item));
  }
  return <div ref={layer} className="kiri-video-effects-overlay">
    {visible.map(effect => <div key={effect.id} role="button" tabIndex={props.disabled ? -1 : 0}
      aria-label={props.regionLabel??t(effect.kind === "zoom" ? "Move zoom region" : "Move privacy mask")}
      aria-pressed={effect.id === props.selectedId}
      className={`kiri-video-effect-region${props.regionLabel?" kiri-video-effect-region--sticker":""} kiri-video-effect-region--${effect.kind}${effect.id === props.selectedId ? " is-selected" : ""}`}
      style={{left: `${effect.x * 100}%`, top: `${effect.y * 100}%`, width: `${effect.width * 100}%`, height: `${effect.height * 100}%`}}
      onPointerDown={event => begin(event, effect, "move")} onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)}
      onKeyDown={event => keyboard(event, effect, null)} onFocus={() => {if (!props.disabled) props.onSelect(effect.id);}}>
      {(!props.regionLabel||effect.id===props.selectedId)&&<span className="kiri-video-effect-tag">{props.regionLabel??t(effect.kind === "zoom" ? "Zoom" : "Privacy mask")}</span>}
      {effect.kind === "zoom" && <span className="kiri-video-effect-center" aria-hidden="true">+</span>}
      {effect.id === props.selectedId && ((props.regionLabel?["nw","ne","se","sw"]:["nw","n","ne","e","se","s","sw","w"]) as EffectHandle[]).map(handle=><button key={handle} type="button" className={`kiri-video-effect-resize kiri-video-effect-resize--${handle}`} disabled={props.disabled}
        aria-label={t(({nw:"Resize top-left",n:"Resize top",ne:"Resize top-right",e:"Resize right",se:"Resize bottom-right",s:"Resize bottom",sw:"Resize bottom-left",w:"Resize left"} as const)[handle])} onPointerDown={event => begin(event, effect, handle)} onPointerMove={event => {event.stopPropagation(); move(event);}} onPointerUp={event => {event.stopPropagation(); finish();}} onPointerCancel={event => {event.stopPropagation(); finish(true);}} onKeyDown={event => keyboard(event, effect, handle)}/>)}
    </div>)}
  </div>;
}
