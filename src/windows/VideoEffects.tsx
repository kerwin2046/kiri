import {useRef,useState} from "react";
import type {KeyboardEvent,PointerEvent} from "react";
import {Focus,Shield,Trash2,Plus,Scan,Frame,SunMoon} from "lucide-react";
import {t,fmt} from "../i18n";
import {activeVideoEffects,clamp,createVideoEffect,moveVideoEffect,resizeVideoEffectFromHandle,validVideoEffect,cropVideoFrame,effectLabels,videoFrameRect} from "./video-effects";
import type {VideoEffect,EffectHandle} from "./video-effects";
import {VideoTimeInput} from "./VideoTimeInput";
import "./video-effects.css";
import {ChoiceSelect} from "../components/ChoiceSelect";
import {VideoEffectSlider as EffectSlider} from "./VideoEffectSlider";
import {VideoMaskSample} from "./VideoMaskSample";
export type VideoEffectsProps={frameSource?:{current:HTMLCanvasElement|null};video?:HTMLVideoElement|null;regionLabel?:string;effects:VideoEffect[];onChange(effects:VideoEffect[],transient?:boolean):void;selectedId:string|null;onSelect(id:string|null):void;time:number;duration:number;disabled?:boolean;onSeek?(time:number):void;sourceSize?:{width:number;height:number};transform?:{x:number;y:number;sx:number;sy:number;clip:{x:number;y:number;width:number;height:number}};};

const effectIcons={zoom:Focus,mask:Shield,spotlight:Scan,frame:Frame,fade:SunMoon};
const addLabels={zoom:"Add zoom",mask:"Add privacy mask",spotlight:"Add spotlight",frame:"Add crop & background",fade:"Add fade in & out"} as const;
export function VideoEffectsControls(props:VideoEffectsProps){
  const [error,setError]=useState(false);
  const picker=useRef<HTMLDetailsElement>(null);
  const selected=props.effects.find(effect=>effect.id===props.selectedId);
  function add(kind:VideoEffect["kind"]){const effect=createVideoEffect(kind,props.time,props.duration,props.effects);if(!effect){setError(true);return;}setError(false);props.onChange([...props.effects,effect]);props.onSelect(effect.id);props.onSeek?.(effect.start+Math.min(effect.transition??0,(effect.end-effect.start)/2));if(picker.current)picker.current.open=false;}
  function update(next:VideoEffect,transient=false){if(!validVideoEffect(next,props.effects,props.duration)){setError(true);return;}setError(false);props.onChange(props.effects.map(effect=>effect.id===next.id?next:effect),transient);}
  const transition=selected?Math.min(selected.transition??0,(selected.end-selected.start)/2):0;
  const blocked=props.disabled||props.duration<.05||props.effects.length>=128;
  const choices=(Object.keys(effectIcons) as VideoEffect["kind"][]).map(kind=>{const Icon=effectIcons[kind];return <button type="button" key={kind} className="kiri-effect-add" disabled={blocked} onClick={()=>add(kind)}><Icon size={16}/><span>{t(addLabels[kind])}</span><Plus size={12}/></button>;});
  function colors(label:string){if(!selected)return null;return <div className="kiri-effect-colors"><span>{label}</span>{[0,0xffffff].map(color=><button type="button" key={color} className="kiri-effect-color" aria-label={t(color?"White":"Black")} aria-pressed={(selected.color??0)===color} style={{background:color?"#fff":"#000"}} onClick={()=>update({...selected,color})}/>)}<label className="kiri-effect-custom-color" title={t("Custom color")}><input type="color" aria-label={t("Custom color")} value={`#${(selected.color??0).toString(16).padStart(6,"0")}`} onChange={event=>update({...selected,color:parseInt(event.target.value.slice(1),16)})}/></label></div>;}
  const source=props.sourceSize??{width:16,height:9};
  const cropRatio=selected?selected.width*source.width/(selected.height*source.height):1;
  const cropPreset=selected?.width===1&&selected.height===1?"source":Math.abs(cropRatio-1)<.001?"square":Math.abs(cropRatio-16/9)<.001?"wide":"portrait";
  return <section className="kiri-video-effects" aria-label={t("Video effects")}>
    <div className="kiri-video-effects-heading"><strong>{t("Video effects")}</strong>{selected&&<details ref={picker} className="kiri-effect-picker" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;}} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector("summary")?.focus();}}}><summary aria-label={t("Add effect")}><Plus size={15}/>{t("Add effect")}</summary><div>{choices}</div></details>}</div>
    {!selected?<><div className="kiri-video-effects-actions">{choices}</div><p className="kiri-effect-empty">{t("Choose a track below to adjust its appearance and timing.")}</p></>:<fieldset className="kiri-video-effect-fields" disabled={props.disabled}>
      <div className="kiri-effect-section-title"><span>{t(effectLabels[selected.kind])}</span><button type="button" className="kiri-effect-delete" aria-label={t("Delete effect")} title={t("Delete effect")} onClick={()=>{props.onChange(props.effects.filter(effect=>effect.id!==selected.id));props.onSelect(null);}}><Trash2 size={14}/></button></div>
      {selected.kind==="mask"&&<><div className="kiri-effect-styles" role="group" aria-label={t("Mask style")}>
        {(["solid","blur","pixelate"] as const).map(style=><button type="button" key={style} className="kiri-effect-style" aria-pressed={(selected.maskStyle??"solid")===style} onClick={()=>update({...selected,maskStyle:style})}><VideoMaskSample frameSource={props.frameSource} video={props.video??null} effect={{...selected,maskStyle:style}}/><span>{t(style==="solid"?"Solid":style==="blur"?"Blur":"Pixel")}</span></button>)}
      </div>{(selected.maskStyle??"solid")==="solid"?colors(t("Color")):<EffectSlider label={t("Intensity")} min={0} max={1} step={.01} value={selected.strength??.5} text={`${Math.round((selected.strength??.5)*100)}%`} onChange={(strength,transient)=>update({...selected,strength},transient)}/>}</>}
      {selected.kind==="zoom"&&<EffectSlider label={t("Zoom scale")} min={1.5} max={4} step={.05} value={1/selected.width} text={`${(1/selected.width).toFixed(2)}×`} onChange={(value,transient)=>{const size=1/value;update({...selected,width:size,height:size,x:clamp(selected.x+(selected.width-size)/2,0,1-size),y:clamp(selected.y+(selected.height-size)/2,0,1-size)},transient);}}/>}
      {selected.kind==="spotlight"&&<EffectSlider label={t("Dim surroundings")} min={0} max={1} step={.01} value={selected.strength??.65} text={`${Math.round((selected.strength??.65)*100)}%`} onChange={(strength,transient)=>update({...selected,strength},transient)}/>}
      {selected.kind==="frame"&&<><ChoiceSelect label={t("Crop ratio")} value={cropPreset} onChange={value=>update(cropVideoFrame(selected,value==="source"?null:value==="square"?1:value==="wide"?16/9:9/16,source))} options={[{value:"source",label:t("Full image")},{value:"square",label:"1:1"},{value:"wide",label:"16:9"},{value:"portrait",label:"9:16"}]}/><EffectSlider label={t("Padding")} min={0} max={1} step={.01} value={selected.strength??.32} text={`${Math.round((selected.strength??.32)*25)}%`} onChange={(strength,transient)=>update({...selected,strength},transient)}/>{colors(t("Background"))}<p className="kiri-effect-note">{t("The crop fits inside the output canvas without stretching.")}</p></>}
      {(selected.kind==="zoom"||selected.kind==="fade")&&<EffectSlider label={t(selected.kind==="fade"?"Fade duration":"Smooth transition")} min={selected.kind==="fade"?Math.min(.05,(selected.end-selected.start)/2):0} max={Math.min(2,(selected.end-selected.start)/2)} step={.01} value={transition} text={`${transition.toFixed(2)} s`} onChange={(transition,transient)=>update({...selected,transition},transient)}/>}
      {selected.kind==="fade"&&colors(t("Fade color"))}
      {(selected.kind==="zoom"||selected.kind==="frame")&&<p className="kiri-effect-note">{t("Drag the image to reframe. Changes appear immediately.")}</p>}
      <div className="kiri-effect-time-heading"><span>{t("Timing")}</span><output>{fmt("%@ seconds",(selected.end-selected.start).toFixed(2))}</output></div>
      <div className="kiri-effect-times"><label>{t("Effect start")}<VideoTimeInput key={`${selected.id}-start`} min={0} max={selected.end-.05} step={.1} value={selected.start} onCommit={start=>update({...selected,start})}/></label><label>{t("Effect end")}<VideoTimeInput key={`${selected.id}-end`} min={selected.start+.05} max={props.duration} step={.1} value={selected.end} onCommit={end=>update({...selected,end})}/></label></div>
    </fieldset>}
    {error&&<p className="kiri-video-effects-error" role="alert">{t("Choose a valid range. Two zoom, crop or fade effects of the same kind cannot overlap.")}</p>}
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

type Gesture = {id: string; x: number; y: number; width: number; height: number; mode: "move" | EffectHandle; pan:boolean; original: VideoEffect[]; latest: VideoEffect[]};

export function VideoEffectsOverlay(props: VideoEffectsProps) {
  const layer = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);

  const visible = activeVideoEffects(props.effects, props.time).filter(effect=>effect.kind!=="fade"&&(props.regionLabel||effect.id===props.selectedId));
  function begin(event: PointerEvent<HTMLElement>, effect: VideoEffect, mode: "move" | EffectHandle) {
    if (props.disabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const rect = layer.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    props.onSelect(effect.id);
    const camera=effect.kind==="zoom"||effect.kind==="frame";
    const transform=props.transform??{x:0,y:0,sx:1,sy:1};
    const frame=effect.kind==="frame"?videoFrameRect(effect):null;
    gesture.current = {id: effect.id, x: event.clientX, y: event.clientY, width: rect.width*(frame?frame.width/effect.width:transform.sx), height: rect.height*(frame?frame.height/effect.height:transform.sy), mode, pan:camera, original: props.effects, latest: props.effects};
  }
  function move(event: PointerEvent<HTMLElement>) {
    const state = gesture.current;
    if (!state) return;
    const effect = state.original.find(item => item.id === state.id)!;
    const dx = (event.clientX - state.x) / state.width, dy = (event.clientY - state.y) / state.height;
    const next = state.mode === "move" ? moveVideoEffect(effect, state.pan?-dx:dx, state.pan?-dy:dy) : (props.regionLabel?resizeSticker(effect,dx,dy,state.mode):resizeVideoEffectFromHandle(effect, dx, dy, state.mode));
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
  const clip=props.transform?.clip;
  return <div ref={layer} className="kiri-video-effects-overlay" style={clip?{clipPath:`inset(${clip.y*100}% ${(1-clip.x-clip.width)*100}% ${(1-clip.y-clip.height)*100}% ${clip.x*100}%)`}:undefined}>
    {visible.map(effect => {const transform=props.transform??{x:0,y:0,sx:1,sy:1},camera=effect.kind==="zoom"||effect.kind==="frame";return <div key={effect.id} role="button" tabIndex={props.disabled ? -1 : 0}
      aria-label={props.regionLabel??t(effect.kind === "zoom"||effect.kind==="frame" ? "Drag to reframe" : effect.kind==="spotlight"?"Move spotlight":"Move privacy mask")}
      aria-pressed={effect.id === props.selectedId}
      className={`kiri-video-effect-region${props.regionLabel?" kiri-video-effect-region--sticker":""} kiri-video-effect-region--${effect.kind}${effect.id === props.selectedId ? " is-selected" : ""}`}
      style={camera?{inset:0}:{left: `${(transform.x+effect.x*transform.sx)*100}%`, top: `${(transform.y+effect.y*transform.sy)*100}%`, width: `${effect.width*transform.sx*100}%`, height: `${effect.height*transform.sy*100}%`}}
      onPointerDown={event => begin(event, effect, "move")} onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)}
      onKeyDown={event => keyboard(event, effect, null)} onFocus={() => {if (!props.disabled) props.onSelect(effect.id);}}>
      {(!props.regionLabel||effect.id===props.selectedId)&&<span className="kiri-video-effect-tag">{props.regionLabel??t(effectLabels[effect.kind])}</span>}

      {!camera&&effect.id === props.selectedId && ((props.regionLabel?["nw","ne","se","sw"]:["nw","n","ne","e","se","s","sw","w"]) as EffectHandle[]).map(handle=><button key={handle} type="button" className={`kiri-video-effect-resize kiri-video-effect-resize--${handle}`} disabled={props.disabled}
        aria-label={t(({nw:"Resize top-left",n:"Resize top",ne:"Resize top-right",e:"Resize right",se:"Resize bottom-right",s:"Resize bottom",sw:"Resize bottom-left",w:"Resize left"} as const)[handle])} onPointerDown={event => begin(event, effect, handle)} onPointerMove={event => {event.stopPropagation(); move(event);}} onPointerUp={event => {event.stopPropagation(); finish();}} onPointerCancel={event => {event.stopPropagation(); finish(true);}} onKeyDown={event => keyboard(event, effect, handle)}/>)}
    </div>;})}
  </div>;
}
